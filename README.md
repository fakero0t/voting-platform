# Project Vote

Internal platform for voting on favorite company projects. Coworkers score each
project **1–10**; results are the **average** of all votes. An admin sets up
projects, opens/closes voting, and watches results (and who voted what) live.

## Run locally

```
npm install
ADMIN_PASSWORD=your-password npm start
```

- Voter link: <http://localhost:3000/>
- Admin: <http://localhost:3000/admin>

## How it works

1. **Admin → Setup:** add projects (name + description) while the vote is a *draft*.
2. **Set the vote Live** and copy the voter link to send out.
3. **Voters** open the link, enter their name once, and score each project 1–10, one at a time.
4. **Admin → Results:** averages, vote counts, and who voted what — updates live.
5. **Close** the vote when you're done.

### Fairness

- One vote per person per project, enforced by the database (`UNIQUE(project_id, voter_id)`).
- Each browser is locked to the first name it registers (a cookie), so casual
  re-voting under a new name from the same device is blocked.
- Projects are frozen once the vote goes live, so nobody votes on a changing set.

## Persistence

State lives in a SQLite file at `DB_PATH` (default `./data/voting.db`). Nothing is
in localStorage — restart the server and everything is still there.

## Deploy (cloud)

Any host that runs Node and gives you a **persistent disk** works (Railway, Fly.io,
Render, a small VM). Set these in the host's environment:

- `ADMIN_PASSWORD` — your admin password
- `DB_PATH` — a path on the persistent disk (e.g. `/data/voting.db`)
- `NODE_ENV=production` — makes the auth cookies `Secure` (HTTPS only)

Then `npm install && npm start`. Point the disk mount at the folder holding `DB_PATH`.

## Test

```
npm test
```

Covers the fairness lock, status gating, admin auth, score validation, and the average calculation.
```
