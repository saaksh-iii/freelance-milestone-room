# Freelance Milestone Room

A shared workspace where a client and a freelancer agree on scope, submit and review deliverable versions, and keep a visible, tamper-resistant record of every decision — built for the NamoID "freelance-milestone-room" Engineering Challenge (Future of Work track).

**This is a fictional scenario.** No real money, invoices, contracts, escrow, or legally binding agreements are involved.

## What it does

- Client and freelancer sign in via **NamoID Hosted Auth**.
- They agree on a scope snapshot, which becomes **immutable** once created.
- The freelancer submits deliverable versions; each new version must explicitly reference the version before it.
- The client can **accept** a version or **request changes** with a note — disagreements stay visible on the timeline; nothing auto-resolves.
- Once a version is **accepted, it cannot be silently replaced** — attempting to submit a "replacement" returns `409`.
- A **final acknowledgement** records the exact version id each person reviewed.
- All events (scope agreed, version submitted, changes requested, accepted, acknowledged) are recorded in an **append-only timeline** with server-assigned timestamps — the client can never backdate an event.
- Accessing a project you're not a member of returns **403**.

## Architecture

Deliberately minimal for a 6-hour scope:

- **Frontend**: vanilla JS (`index.html` + `app.js`), no framework, no build step. Served with `python3 -m http.server` (Windows: `py -m http.server`).
- **Backend**: Node.js + Express, ES modules. Data persisted to a single JSON file (`data/store.json`) — no database server to stand up for a fictional, low-volume demo.
- **Auth**: [`@namoidhq/js`](https://docs.namoid.in/sdks/javascript) Hosted Auth (OAuth 2.1 / OIDC + PKCE), loaded via CDN in the browser (no client secret in browser code, per NamoID's guidance for public SPA clients).
- **Identity on the backend**: the frontend sends the NamoID `sub` (user id) via an `x-namoid-sub` header on each API request; the server checks it against project membership before allowing reads/writes. **This is a deliberate simplification for the 6-hour timebox** — it is not cryptographically verified server-side. A production version would validate the NamoID ID token server-side (e.g. via `validateOIDCIdToken` from `@namoidhq/js/server`) instead of trusting a client-supplied header.
- **Project model**: a single fixed demo project, auto-created on first load, so the demo recording doesn't need a create/share-link flow. A real product would support many projects.

## Running locally

```bash
npm install
py -m http.server 8080      # frontend, in one terminal
node server.js               # API, in another terminal
```

Open `http://localhost:8080`, sign in with NamoID, and join as Client or Freelancer (open a second browser/profile with a different NamoID account to play both roles).

## Tests

```bash
node --test
```

Covers the two required scenarios:
1. **Version replacement after acceptance** — submitting a new version once the latest is accepted is rejected with `409`, and the original accepted version is confirmed unchanged.
2. **Cross-project access** — a user with no role on a project is rejected with `403`; a member succeeds.

Example passing output:

```
✔ an accepted deliverable version cannot be silently replaced (223.2804ms)
✔ a user outside a project cannot access it (403) (36.136ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

## Example event timeline

Real output captured from a manual end-to-end run through the UI (two NamoID test accounts, one as client, one as freelancer):

```
project_created         — actor <client sub>
member_joined            — actor <freelancer sub>
scope_agreed              — actor <client sub>
member_joined             — actor <freelancer sub>
version_submitted     — actor <freelancer sub> — version v1
changes_requested      — actor <client sub> — version v1
version_submitted      — actor <freelancer sub> — version v2 (linked to v1)
version_accepted        — actor <client sub> — version v2
final_acknowledgement — actor <client sub> — version v2
```

Every event has a server-generated `timestamp` (ISO 8601, UTC) — the client never supplies it, so events cannot be backdated.

## First paying customer

Devika, a freelance web designer, takes on a small fixed-scope project for Aditi, a solo founder who needs a 5-page marketing site. In their first attempt at a "handshake" freelance relationship over email, Aditi asked for a small tweak after Devika considered the homepage done — and neither of them could later agree on whether that request came before or after "final" delivery. Milestone Room gives them a shared, ordered record: an agreed scope neither can quietly edit, deliverable versions that explicitly chain together, and a change request that stays visible instead of getting lost in an email thread — so "final" actually means something both of them can point to.

## Future direction

- Real per-project creation and invite links, instead of one fixed demo project.
- Server-side verification of the NamoID ID token instead of a trusted header.
- File/image attachments on deliverable versions.
- Multiple concurrent projects per user, with a project list/dashboard.
- Notifications (email or in-app) when the other party acts.
- A real database once multi-project, multi-user concurrency matters — the JSON file store is intentionally a placeholder for this timebox, not a long-term design choice.

## Links

- Repo: https://github.com/saaksh-iii/freelance-milestone-room
- Challenge: https://github.com/namoidhq/namoid-challenges/blob/main/challenges/freelance-milestone-room.md
- Demo recording:
