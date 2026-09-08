'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { openDb } = require('./db');

const VALID_STATUSES = ['draft', 'live', 'closed'];

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Build the Express app.
 * @param {object} opts
 * @param {string} opts.dbPath        SQLite path (or ':memory:')
 * @param {string} opts.adminPassword Shared admin password
 */
function createApp(opts = {}) {
  const db = openDb(opts.dbPath || ':memory:');
  const adminPassword = opts.adminPassword || 'admin';
  const adminToken = sha256('admin:' + adminPassword);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // ---- prepared statements ----
  const q = {
    getStatus: db.prepare('SELECT status FROM event WHERE id = 1'),
    setStatus: db.prepare('UPDATE event SET status = ? WHERE id = 1'),

    listProjects: db.prepare('SELECT id, name, description FROM projects ORDER BY id'),
    getProject: db.prepare('SELECT id, name, description FROM projects WHERE id = ?'),
    insertProject: db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)'),
    updateProject: db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?'),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
    countProjects: db.prepare('SELECT COUNT(*) AS n FROM projects'),

    getVoterByToken: db.prepare('SELECT id, name FROM voters WHERE device_token = ?'),
    insertVoter: db.prepare('INSERT INTO voters (name, device_token) VALUES (?, ?)'),
    listVoters: db.prepare('SELECT id, name, created_at FROM voters ORDER BY id'),

    votesByVoter: db.prepare('SELECT project_id, score FROM votes WHERE voter_id = ?'),
    // one row per (project, voter); re-voting updates the existing score while voting is open
    upsertVote: db.prepare(`
      INSERT INTO votes (project_id, voter_id, score) VALUES (?, ?, ?)
      ON CONFLICT (project_id, voter_id)
      DO UPDATE SET score = excluded.score, created_at = datetime('now')
    `),
    resultsByProject: db.prepare(`
      SELECT p.id, p.name, p.description,
             COUNT(v.id)                    AS vote_count,
             ROUND(AVG(v.score), 2)         AS average
        FROM projects p
        LEFT JOIN votes v ON v.project_id = p.id
       GROUP BY p.id
       ORDER BY p.id
    `),
    detailedVotes: db.prepare(`
      SELECT v.project_id, vo.name AS voter_name, v.score, v.created_at
        FROM votes v
        JOIN voters vo ON vo.id = v.voter_id
       ORDER BY v.created_at
    `),
  };

  const getStatus = () => q.getStatus.get().status;

  // ---- helpers ----
  function requireAdmin(req, res, next) {
    if (safeEqual(req.cookies.admin || '', adminToken)) return next();
    return res.status(401).json({ error: 'Not authorized. Log in as admin first.' });
  }

  function currentVoter(req) {
    const token = req.cookies.voter;
    if (!token) return null;
    return q.getVoterByToken.get(token) || null;
  }

  const isProd = process.env.NODE_ENV === 'production';
  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 7 };

  // =========================================================
  // Public / voter API
  // =========================================================

  // Voting event status (so the UI knows what to show).
  app.get('/api/state', (req, res) => {
    const voter = currentVoter(req);
    res.json({
      status: getStatus(),
      voter: voter ? { name: voter.name } : null,
    });
  });

  // Register a voter (locks the browser to this identity).
  app.post('/api/voter/register', (req, res) => {
    if (getStatus() !== 'live') {
      return res.status(409).json({ error: 'Voting is not open right now.' });
    }
    const existing = currentVoter(req);
    if (existing) return res.json({ name: existing.name }); // already locked to this device

    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (name.length > 80) return res.status(400).json({ error: 'That name is too long.' });

    const token = crypto.randomBytes(24).toString('hex');
    q.insertVoter.run(name, token);
    res.cookie('voter', token, cookieOpts);
    res.json({ name });
  });

  // Projects to vote on + which ones this voter has already scored.
  app.get('/api/projects', (req, res) => {
    if (getStatus() !== 'live') {
      return res.status(409).json({ error: 'Voting is not open right now.' });
    }
    const voter = currentVoter(req);
    if (!voter) return res.status(401).json({ error: 'Enter your name to start voting.' });

    const voted = {};
    for (const v of q.votesByVoter.all(voter.id)) voted[v.project_id] = v.score;

    const projects = q.listProjects.all().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      myScore: voted[p.id] ?? null,
    }));
    res.json({ voter: { name: voter.name }, projects });
  });

  // Cast one vote.
  app.post('/api/votes', (req, res) => {
    if (getStatus() !== 'live') {
      return res.status(409).json({ error: 'Voting is not open right now.' });
    }
    const voter = currentVoter(req);
    if (!voter) return res.status(401).json({ error: 'Enter your name to start voting.' });

    const projectId = Number(req.body.projectId);
    const score = Number(req.body.score);
    if (!Number.isInteger(projectId) || !q.getProject.get(projectId)) {
      return res.status(400).json({ error: 'Unknown project.' });
    }
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      return res.status(400).json({ error: 'Score must be a whole number from 1 to 10.' });
    }

    q.upsertVote.run(projectId, voter.id, score);
    res.json({ ok: true, projectId, score });
  });

  // =========================================================
  // Admin API
  // =========================================================

  app.post('/api/admin/login', (req, res) => {
    const password = String(req.body.password || '');
    if (!safeEqual(sha256('admin:' + password), adminToken)) {
      return res.status(401).json({ error: 'Wrong password.' });
    }
    res.cookie('admin', adminToken, cookieOpts);
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin');
    res.json({ ok: true });
  });

  app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

  // Full admin snapshot: status, projects, live results, who voted what.
  app.get('/api/admin/results', requireAdmin, (req, res) => {
    const projects = q.resultsByProject.all().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      voteCount: p.vote_count,
      average: p.average, // null until first vote
    }));

    const byProject = {};
    for (const v of q.detailedVotes.all()) {
      (byProject[v.project_id] ||= []).push({ voterName: v.voter_name, score: v.score, at: v.created_at });
    }

    res.json({
      status: getStatus(),
      projects,
      votesByProject: byProject,
      voters: q.listVoters.all(),
    });
  });

  // Change status. Projects can only be edited while 'draft'.
  app.post('/api/admin/status', requireAdmin, (req, res) => {
    const status = String(req.body.status || '');
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    if (status === 'live' && q.countProjects.get().n === 0) {
      return res.status(400).json({ error: 'Add at least one project before going live.' });
    }
    q.setStatus.run(status);
    res.json({ status });
  });

  function ensureDraft(res) {
    if (getStatus() !== 'draft') {
      res.status(409).json({ error: 'Projects can only be changed while the vote is a draft.' });
      return false;
    }
    return true;
  }

  app.get('/api/admin/projects', requireAdmin, (req, res) => {
    res.json({ status: getStatus(), projects: q.listProjects.all() });
  });

  app.post('/api/admin/projects', requireAdmin, (req, res) => {
    if (!ensureDraft(res)) return;
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    if (!name) return res.status(400).json({ error: 'Project needs a name.' });
    const info = q.insertProject.run(name, description);
    res.json(q.getProject.get(info.lastInsertRowid));
  });

  app.put('/api/admin/projects/:id', requireAdmin, (req, res) => {
    if (!ensureDraft(res)) return;
    const id = Number(req.params.id);
    if (!q.getProject.get(id)) return res.status(404).json({ error: 'Project not found.' });
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    if (!name) return res.status(400).json({ error: 'Project needs a name.' });
    q.updateProject.run(name, description, id);
    res.json(q.getProject.get(id));
  });

  app.delete('/api/admin/projects/:id', requireAdmin, (req, res) => {
    if (!ensureDraft(res)) return;
    const id = Number(req.params.id);
    if (!q.getProject.get(id)) return res.status(404).json({ error: 'Project not found.' });
    q.deleteProject.run(id);
    res.json({ ok: true });
  });

  // ---- static frontend ----
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  app._db = db; // exposed for tests / graceful shutdown
  return app;
}

module.exports = { createApp };
