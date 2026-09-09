'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS event (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'draft'   -- draft | live | closed
);
INSERT OR IGNORE INTO event (id, status) VALUES (1, 'draft');

CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  team_members TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL DEFAULT '',
  google_sub   TEXT UNIQUE,               -- stable Google account id; one voter per Google identity
  device_token TEXT NOT NULL UNIQUE,       -- random session token stored in the voter cookie
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  voter_id   INTEGER NOT NULL REFERENCES voters(id)   ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, voter_id)   -- one vote per voter per project (fairness lock)
);
`;

/**
 * Open (and initialize) the SQLite database.
 * @param {string} dbPath  File path, or ':memory:' for tests.
 */
function openDb(dbPath) {
  if (dbPath && dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath || ':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas/newlines, and "" escapes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // ignore
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Turn parsed CSV rows (minus header) into {name, description, members}, skipping rows with no team name.
// Columns (by position): Timestamp, Email, Team Name, Team Members, Elevator Pitch.
// Timestamp and email are intentionally ignored.
function projectsFromRows(rows) {
  return rows
    .map((r) => ({ name: (r[2] || '').trim(), description: (r[4] || '').trim(), members: (r[3] || '').trim() }))
    .filter((p) => p.name);
}

/**
 * Seed the projects table from a submissions CSV, but only when it's empty.
 * @returns {number} number of projects inserted (0 if already seeded).
 */
function seedProjects(db, csvPath) {
  if (db.prepare('SELECT COUNT(*) AS n FROM projects').get().n > 0) return 0;
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  rows.shift(); // drop header
  const projects = projectsFromRows(rows);
  const insert = db.prepare('INSERT INTO projects (name, description, team_members) VALUES (?, ?, ?)');
  const seed = db.transaction((records) => {
    for (const p of records) insert.run(p.name, p.description, p.members);
    return records.length;
  });
  return seed(projects);
}

/**
 * Replace ALL projects with the contents of a CSV string (same columns as the seed CSV).
 * Deleting the projects cascades to their votes, so this is a full reset.
 * Aborts (throws) if the CSV has no usable team rows, so a bad upload can't wipe the data.
 * @returns {number} number of projects inserted.
 */
function replaceProjectsFromCsv(db, csvText) {
  const rows = parseCsv(csvText);
  rows.shift(); // drop header
  const projects = projectsFromRows(rows);
  if (projects.length === 0) {
    throw new Error('No team rows found. Expected columns: Timestamp, Email, Team Name, Team Members, Elevator Pitch.');
  }
  const insert = db.prepare('INSERT INTO projects (name, description, team_members) VALUES (?, ?, ?)');
  const replace = db.transaction((records) => {
    db.prepare('DELETE FROM projects').run();
    for (const p of records) insert.run(p.name, p.description, p.members);
    return records.length;
  });
  return replace(projects);
}

module.exports = { openDb, parseCsv, seedProjects, replaceProjectsFromCsv };
