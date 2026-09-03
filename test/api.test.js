import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-store.json");

// Isolate tests from the real dev data file, and pick a port unlikely to clash.
process.env.DB_PATH = TEST_DB_PATH;
process.env.PORT = "3999";

fs.writeFileSync(
  TEST_DB_PATH,
  JSON.stringify({ projects: [], scopeSnapshots: [], deliverableVersions: [], events: [] })
);

const { startServer } = await import("../server.js");

let server;
const BASE = "http://localhost:3999/api";

before(() => {
  server = startServer();
});

after(() => {
  server.close();
  fs.unlinkSync(TEST_DB_PATH);
});

function call(path, { method = "GET", user, body } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-namoid-sub": user } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

test("an accepted deliverable version cannot be silently replaced", async () => {
  const project = await call("/projects", {
    method: "POST",
    user: "client-1",
    body: { name: "Website redesign", role: "client" },
  });
  assert.equal(project.status, 201);
  const projectId = project.body.id;

  await call(`/projects/${projectId}/join`, {
    method: "POST",
    user: "freelancer-1",
    body: { role: "freelancer" },
  });

  const v1 = await call(`/projects/${projectId}/versions`, {
    method: "POST",
    user: "freelancer-1",
    body: { content: "Homepage draft" },
  });
  assert.equal(v1.status, 201);
  assert.equal(v1.body.status, "pending");

  const accept = await call(`/projects/${projectId}/versions/${v1.body.id}/accept`, {
    method: "POST",
    user: "client-1",
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.status, "accepted");

  // Attempt to submit a "replacement" version referencing the now-accepted version.
  const sneaky = await call(`/projects/${projectId}/versions`, {
    method: "POST",
    user: "freelancer-1",
    body: { content: "Silently swapped content", previousVersionId: v1.body.id },
  });

  assert.equal(sneaky.status, 409);
  assert.match(sneaky.body.error, /already accepted/i);

  // The original accepted version must still exist, unchanged.
  const versions = await call(`/projects/${projectId}/versions`, { user: "client-1" });
  const stillThere = versions.body.find((v) => v.id === v1.body.id);
  assert.ok(stillThere, "original accepted version must still exist");
  assert.equal(stillThere.content, "Homepage draft");
  assert.equal(stillThere.status, "accepted");
});

test("a user outside a project cannot access it (403)", async () => {
  const project = await call("/projects", {
    method: "POST",
    user: "client-2",
    body: { name: "Private project", role: "client" },
  });
  const projectId = project.body.id;

  const outsider = await call(`/projects/${projectId}`, {
    user: "totally-unrelated-user",
  });
  assert.equal(outsider.status, 403);

  const owner = await call(`/projects/${projectId}`, { user: "client-2" });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.id, projectId);
});