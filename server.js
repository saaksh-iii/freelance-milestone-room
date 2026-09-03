import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "store.json");

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function newId() {
  return crypto.randomUUID();
}

function logEvent(db, { projectId, type, actorId, versionId }) {
  db.events.push({
    id: newId(),
    projectId,
    type,
    actorId,
    versionId: versionId || null,
    timestamp: new Date().toISOString(),
  });
}

// Every request must identify the caller via this header.
// (Simplified for the challenge timebox: not cryptographically verified.)
function requireUser(req, res, next) {
  const userId = req.header("x-namoid-sub");
  if (!userId) {
    return res.status(401).json({ error: "Missing x-namoid-sub header" });
  }
  req.userId = userId;
  next();
}

// Ensures the caller is actually part of this project (client or freelancer).
// This is what produces the 403 for cross-project access.
function requireProjectMember(req, res, next) {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (project.clientId !== req.userId && project.freelancerId !== req.userId) {
    return res.status(403).json({ error: "Not a member of this project" });
  }
  req.project = project;
  req.db = db;
  next();
}

// --- Projects ---

// Create a project. Creator immediately claims a role.
app.post("/api/projects", requireUser, (req, res) => {
  const { name, role } = req.body;
  if (!name || !["client", "freelancer"].includes(role)) {
    return res.status(400).json({ error: "name and role ('client'|'freelancer') required" });
  }

  const db = readDB();
  const project = {
    id: newId(),
    name,
    clientId: role === "client" ? req.userId : null,
    freelancerId: role === "freelancer" ? req.userId : null,
    createdAt: new Date().toISOString(),
  };
  db.projects.push(project);
  logEvent(db, { projectId: project.id, type: "project_created", actorId: req.userId });
  writeDB(db);
  res.status(201).json(project);
});

// Join an existing project, filling the remaining role.
app.post("/api/projects/:projectId/join", requireUser, (req, res) => {
  const { role } = req.body;
  if (!["client", "freelancer"].includes(role)) {
    return res.status(400).json({ error: "role ('client'|'freelancer') required" });
  }

  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  if (role === "client") {
    if (project.clientId && project.clientId !== req.userId) {
      return res.status(409).json({ error: "Client role already taken" });
    }
    project.clientId = req.userId;
  } else {
    if (project.freelancerId && project.freelancerId !== req.userId) {
      return res.status(409).json({ error: "Freelancer role already taken" });
    }
    project.freelancerId = req.userId;
  }

  logEvent(db, { projectId: project.id, type: "member_joined", actorId: req.userId });
  writeDB(db);
  res.json(project);
});

// Get a project (member-only -> exercises the 403 check).
app.get("/api/projects/:projectId", requireUser, requireProjectMember, (req, res) => {
  res.json(req.project);
});

// --- Scope snapshot (immutable once created) ---

app.post("/api/projects/:projectId/scope", requireUser, requireProjectMember, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const db = req.db;
  const existing = db.scopeSnapshots.find((s) => s.projectId === req.project.id);
  if (existing) {
    return res.status(409).json({ error: "Scope already agreed and is immutable" });
  }

  const snapshot = {
    id: newId(),
    projectId: req.project.id,
    text,
    agreedAt: new Date().toISOString(),
  };
  db.scopeSnapshots.push(snapshot);
  logEvent(db, { projectId: req.project.id, type: "scope_agreed", actorId: req.userId });
  writeDB(db);
  res.status(201).json(snapshot);
});

app.get("/api/projects/:projectId/scope", requireUser, requireProjectMember, (req, res) => {
  const snapshot = req.db.scopeSnapshots.find((s) => s.projectId === req.project.id);
  if (!snapshot) return res.status(404).json({ error: "No scope agreed yet" });
  res.json(snapshot);
});

// --- Deliverable versions ---

// Submit a new version (freelancer). Must link to previous version if one exists.
app.post("/api/projects/:projectId/versions", requireUser, requireProjectMember, (req, res) => {
  const { content, previousVersionId } = req.body;
  if (!content) return res.status(400).json({ error: "content required" });

  const db = req.db;
  const projectVersions = db.deliverableVersions.filter((v) => v.projectId === req.project.id);

  // Cannot submit a new version if the latest is already accepted, UNLESS this is v1.
  const latest = projectVersions[projectVersions.length - 1];
  if (latest && latest.status === "accepted") {
    return res.status(409).json({ error: "Latest version already accepted; cannot silently replace it" });
  }
  if (latest && previousVersionId !== latest.id) {
    return res.status(400).json({ error: "previousVersionId must reference the current latest version" });
  }

  const version = {
    id: newId(),
    projectId: req.project.id,
    versionNumber: projectVersions.length + 1,
    content,
    submittedBy: req.userId,
    submittedAt: new Date().toISOString(),
    status: "pending",
    previousVersionId: latest ? latest.id : null,
  };
  db.deliverableVersions.push(version);
  logEvent(db, {
    projectId: req.project.id,
    type: "version_submitted",
    actorId: req.userId,
    versionId: version.id,
  });
  writeDB(db);
  res.status(201).json(version);
});

// Client accepts a version.
app.post("/api/projects/:projectId/versions/:versionId/accept", requireUser, requireProjectMember, (req, res) => {
  const db = req.db;
  const version = db.deliverableVersions.find(
    (v) => v.id === req.params.versionId && v.projectId === req.project.id
  );
  if (!version) return res.status(404).json({ error: "Version not found" });
  if (version.status === "accepted") {
    return res.status(409).json({ error: "Version already accepted" });
  }

  version.status = "accepted";
  logEvent(db, {
    projectId: req.project.id,
    type: "version_accepted",
    actorId: req.userId,
    versionId: version.id,
  });
  writeDB(db);
  res.json(version);
});

// Client requests changes against a version (disagreement stays visible, no auto-adjudication).
app.post("/api/projects/:projectId/versions/:versionId/request-changes", requireUser, requireProjectMember, (req, res) => {
  const { note } = req.body;
  if (!note) return res.status(400).json({ error: "note required describing requested changes" });

  const db = req.db;
  const version = db.deliverableVersions.find(
    (v) => v.id === req.params.versionId && v.projectId === req.project.id
  );
  if (!version) return res.status(404).json({ error: "Version not found" });
  if (version.status === "accepted") {
    return res.status(409).json({ error: "Cannot request changes on an already-accepted version" });
  }

  version.status = "changes_requested";
  db.events.push({
    id: newId(),
    projectId: req.project.id,
    type: "changes_requested",
    actorId: req.userId,
    versionId: version.id,
    note,
    timestamp: new Date().toISOString(),
  });
  writeDB(db);
  res.json(version);
});

// --- Final acknowledgement (records exact version each person saw) ---

app.post("/api/projects/:projectId/acknowledge", requireUser, requireProjectMember, (req, res) => {
  const { versionId } = req.body;
  if (!versionId) return res.status(400).json({ error: "versionId required" });

  const db = req.db;
  const version = db.deliverableVersions.find(
    (v) => v.id === versionId && v.projectId === req.project.id
  );
  if (!version) return res.status(404).json({ error: "Version not found" });

  logEvent(db, {
    projectId: req.project.id,
    type: "final_acknowledgement",
    actorId: req.userId,
    versionId: version.id,
  });
  writeDB(db);
  res.json({ acknowledged: true, versionId, by: req.userId });
});

// --- Timeline ---

app.get("/api/projects/:projectId/events", requireUser, requireProjectMember, (req, res) => {
  const events = req.db.events
    .filter((e) => e.projectId === req.project.id)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json(events);
});

app.get("/api/projects/:projectId/versions", requireUser, requireProjectMember, (req, res) => {
  const versions = req.db.deliverableVersions.filter((v) => v.projectId === req.project.id);
  res.json(versions);
});

const PORT = process.env.PORT || 3000;

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`Milestone Room API listening on http://localhost:${PORT}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export { app };