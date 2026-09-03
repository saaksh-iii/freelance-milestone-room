import { createNamoIDClient } from "https://cdn.jsdelivr.net/npm/@namoidhq/js@3.2.0/+esm";

const NAMOID_CLIENT_ID = "namoid_client_test_8ZUDOa51-d7xkdBn3hij66M2xDCWG_83";

const namoid = createNamoIDClient({
  clientId: NAMOID_CLIENT_ID,
});

const API_BASE = "http://localhost:3000/api";

const loginButton = document.querySelector("#login-button");
const status = document.querySelector("#auth-status");
const appPanel = document.querySelector("#app-panel");
const rolePicker = document.querySelector("#role-picker");
const projectView = document.querySelector("#project-view");
const roleLabel = document.querySelector("#role-label");

const scopeDisplay = document.querySelector("#scope-display");
const scopeForm = document.querySelector("#scope-form");
const scopeText = document.querySelector("#scope-text");

const versionList = document.querySelector("#version-list");
const versionForm = document.querySelector("#version-form");
const versionContent = document.querySelector("#version-content");
const reviewForm = document.querySelector("#review-form");
const changesNote = document.querySelector("#changes-note");
const acceptLatestBtn = document.querySelector("#accept-latest");
const requestChangesBtn = document.querySelector("#request-changes");
const acknowledgeBtn = document.querySelector("#acknowledge-btn");

const timelineList = document.querySelector("#timeline-list");

// App-level state, populated after sign-in.
let currentUserId = null; // NamoID sub
let currentProject = null;

// --- Auth (unchanged, verified working) ---

async function login() {
  try {
    status.textContent = "Opening NamoID...";

    const started = await namoid.hostedAuth.start({
      redirectUri: window.location.origin + "/",
    });

    sessionStorage.setItem(
      "namoid_transaction",
      JSON.stringify(started.transaction)
    );

    window.location.assign(started.authorizationUrl);
  } catch (error) {
    console.error(error);
    status.textContent = "Unable to start sign-in.";
  }
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const error = params.get("error");

  if (error) {
    status.textContent = `Sign-in failed: ${error}`;
    return;
  }

  if (!code) {
    return;
  }

  const rawTransaction = sessionStorage.getItem("namoid_transaction");

  if (!rawTransaction) {
    status.textContent = "Sign-in session expired. Please try again.";
    return;
  }

  const transaction = JSON.parse(rawTransaction);

  if (returnedState !== transaction.state) {
    status.textContent = "Invalid authorization state.";
    sessionStorage.removeItem("namoid_transaction");
    return;
  }

  try {
    status.textContent = "Completing sign-in...";

    const tokens = await namoid.hostedAuth.exchangeCode({
      code,
      redirectUri: transaction.redirectUri,
      codeVerifier: transaction.codeVerifier,
    });

    const identity = await namoid.hostedAuth.userInfo(tokens.access_token);

    sessionStorage.removeItem("namoid_transaction");

    history.replaceState({}, document.title, "/");

    status.textContent = `Signed in as ${
      identity.name || identity.email || identity.sub
    }`;

    loginButton.textContent = "Signed in";
    loginButton.disabled = true;

    currentUserId = identity.sub;
    await enterApp();

    console.log("NamoID identity:", identity);
  } catch (error) {
    console.error(error);

    sessionStorage.removeItem("namoid_transaction");

    status.textContent = "Unable to complete sign-in.";
  }
}

// --- App logic ---

function api(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-namoid-sub": currentUserId,
      ...(options.headers || {}),
    },
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return body;
  });
}

async function enterApp() {
  appPanel.hidden = false;
  currentProject = await api("/demo-project");
  renderRoleState();
}

function myRole() {
  if (!currentProject) return null;
  if (currentProject.clientId === currentUserId) return "client";
  if (currentProject.freelancerId === currentUserId) return "freelancer";
  return null;
}

function renderRoleState() {
  const role = myRole();
  if (!role) {
    rolePicker.hidden = false;
    projectView.hidden = true;
    return;
  }
  rolePicker.hidden = true;
  projectView.hidden = false;
  roleLabel.textContent = `You are the ${role} on "${currentProject.name}".`;
  versionForm.hidden = role !== "freelancer";
  reviewForm.hidden = role !== "client";
  refreshProjectData();
}

async function joinAs(role) {
  currentProject = await api(`/projects/${currentProject.id}/join`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
  renderRoleState();
}

async function refreshProjectData() {
  await Promise.all([loadScope(), loadVersions(), loadTimeline()]);
}

async function loadScope() {
  try {
    const snapshot = await api(`/projects/${currentProject.id}/scope`, {
      method: "GET",
    });
    scopeDisplay.textContent = `Agreed scope: "${snapshot.text}"`;
    scopeForm.hidden = true;
  } catch (err) {
    // No scope agreed yet — show the form.
    scopeDisplay.textContent = "No scope agreed yet.";
    scopeForm.hidden = false;
  }
}

scopeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const snapshot = await api(`/projects/${currentProject.id}/scope`, {
      method: "POST",
      body: JSON.stringify({ text: scopeText.value }),
    });
    scopeDisplay.textContent = `Agreed scope: "${snapshot.text}"`;
    scopeDisplay.dataset.agreed = "true";
    scopeForm.hidden = true;
    await loadTimeline();
  } catch (err) {
    scopeDisplay.textContent = `Could not agree scope: ${err.message}`;
  }
});

let latestVersionId = null;

async function loadVersions() {
  const versions = await api(`/projects/${currentProject.id}/versions`);
  versionList.innerHTML = "";
  versions.forEach((v) => {
    const item = document.createElement("p");
    item.textContent = `v${v.versionNumber} (${v.status}): ${v.content}`;
    versionList.appendChild(item);
  });
  latestVersionId = versions.length ? versions[versions.length - 1].id : null;
}

versionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api(`/projects/${currentProject.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        content: versionContent.value,
        previousVersionId: latestVersionId,
      }),
    });
    versionContent.value = "";
    await loadVersions();
    await loadTimeline();
  } catch (err) {
    alert(`Could not submit version: ${err.message}`);
  }
});

acceptLatestBtn.addEventListener("click", async () => {
  if (!latestVersionId) return;
  try {
    await api(`/projects/${currentProject.id}/versions/${latestVersionId}/accept`, {
      method: "POST",
    });
    await loadVersions();
    await loadTimeline();
  } catch (err) {
    alert(`Could not accept: ${err.message}`);
  }
});

requestChangesBtn.addEventListener("click", async () => {
  if (!latestVersionId) return;
  try {
    await api(`/projects/${currentProject.id}/versions/${latestVersionId}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ note: changesNote.value }),
    });
    changesNote.value = "";
    await loadVersions();
    await loadTimeline();
  } catch (err) {
    alert(`Could not request changes: ${err.message}`);
  }
});

acknowledgeBtn.addEventListener("click", async () => {
  if (!latestVersionId) return;
  try {
    await api(`/projects/${currentProject.id}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ versionId: latestVersionId }),
    });
    await loadTimeline();
  } catch (err) {
    alert(`Could not acknowledge: ${err.message}`);
  }
});

async function loadTimeline() {
  const events = await api(`/projects/${currentProject.id}/events`);
  timelineList.innerHTML = "";
  events.forEach((e) => {
    const li = document.createElement("li");
    li.textContent = `[${e.timestamp}] ${e.type} — actor ${e.actorId}${
      e.versionId ? ` — version ${e.versionId}` : ""
    }`;
    timelineList.appendChild(li);
  });
}

document.querySelector("#join-client").addEventListener("click", () => joinAs("client"));
document.querySelector("#join-freelancer").addEventListener("click", () => joinAs("freelancer"));

loginButton.addEventListener("click", login);
handleCallback();