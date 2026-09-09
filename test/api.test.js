'use strict';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../app');

function makeApp() {
  return createApp({ dbPath: ':memory:', adminPassword: 'secret' });
}

// Logs in as admin and returns an agent that keeps the cookie.
async function adminAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'secret' }).expect(200);
  return agent;
}

async function addProject(agent, name, description = '') {
  const res = await agent.post('/api/admin/projects').send({ name, description }).expect(200);
  return res.body.id;
}

test('admin login rejects wrong password and accepts the right one', async () => {
  const app = makeApp();
  await request(app).post('/api/admin/login').send({ password: 'nope' }).expect(401);
  await request(app).post('/api/admin/login').send({ password: 'secret' }).expect(200);
});

test('admin endpoints require authentication', async () => {
  const app = makeApp();
  await request(app).get('/api/admin/results').expect(401);
  await request(app).post('/api/admin/projects').send({ name: 'X' }).expect(401);
});

test('projects can only be created/edited/deleted while draft', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);

  const id = await addProject(admin, 'Alpha', 'first');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);

  await admin.post('/api/admin/projects').send({ name: 'Beta' }).expect(409);
  await admin.put(`/api/admin/projects/${id}`).send({ name: 'Alpha2' }).expect(409);
  await admin.delete(`/api/admin/projects/${id}`).expect(409);
});

test('cannot go live with zero projects', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(400);
});

test('voting is blocked unless status is live', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await addProject(admin, 'Alpha');

  // draft -> registration blocked
  await request(app).post('/api/voter/register').send({ firstName: 'Sam', lastName: 'Lee' }).expect(409);
});

test('re-voting updates the score (still one row per project) while voting is open', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  const pid = await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);

  const voter = request.agent(app);
  await voter.post('/api/voter/register').send({ firstName: 'Sam', lastName: 'Lee' }).expect(200);

  await voter.post('/api/votes').send({ projectId: pid, score: 8 }).expect(200);
  await voter.post('/api/votes').send({ projectId: pid, score: 3 }).expect(200); // update, not rejected

  const res = await admin.get('/api/admin/results').expect(200);
  const project = res.body.projects.find((p) => p.id === pid);
  assert.strictEqual(project.voteCount, 1);   // still one vote
  assert.strictEqual(project.average, 3);      // updated to the new score
});

test('votes cannot be changed once voting is closed', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  const pid = await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);

  const voter = request.agent(app);
  await voter.post('/api/voter/register').send({ firstName: 'Sam', lastName: 'Lee' }).expect(200);
  await voter.post('/api/votes').send({ projectId: pid, score: 8 }).expect(200);

  await admin.post('/api/admin/status').send({ status: 'closed' }).expect(200);
  await voter.post('/api/votes').send({ projectId: pid, score: 2 }).expect(409); // locked after close
});

test('score must be a whole number from 1 to 10', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  const pid = await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);

  const voter = request.agent(app);
  await voter.post('/api/voter/register').send({ firstName: 'Sam', lastName: 'Lee' }).expect(200);

  await voter.post('/api/votes').send({ projectId: pid, score: 0 }).expect(400);
  await voter.post('/api/votes').send({ projectId: pid, score: 11 }).expect(400);
  await voter.post('/api/votes').send({ projectId: pid, score: 5.5 }).expect(400);
});

test('device lock: the browser stays tied to the first name', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);

  const voter = request.agent(app);
  await voter.post('/api/voter/register').send({ firstName: 'Sam', lastName: 'Lee' }).expect(200);
  // Trying to register again under a new name returns the original identity.
  const res = await voter.post('/api/voter/register').send({ firstName: 'Not', lastName: 'Sam' }).expect(200);
  assert.strictEqual(res.body.name, 'Sam Lee');
});

test('registration requires both first and last name', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);
  await request(app).post('/api/voter/register').send({ firstName: 'Sam' }).expect(400);
  await request(app).post('/api/voter/register').send({ lastName: 'Lee' }).expect(400);
});

test('registration rejects names shorter than 2 characters', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);
  await request(app).post('/api/voter/register').send({ firstName: 'S', lastName: 'Lee' }).expect(400);
  await request(app).post('/api/voter/register').send({ firstName: 'Sam', lastName: 'L' }).expect(400);
  await request(app).post('/api/voter/register').send({ firstName: 'Sa', lastName: 'Le' }).expect(200);
});

test('results are the average of all votes and list who voted', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  const pid = await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);

  for (const [name, score] of [['Sam', 8], ['Kim', 6], ['Lee', 10]]) {
    const v = request.agent(app);
    await v.post('/api/voter/register').send({ firstName: name, lastName: 'Qi' }).expect(200);
    await v.post('/api/votes').send({ projectId: pid, score }).expect(200);
  }

  const res = await admin.get('/api/admin/results').expect(200);
  const project = res.body.projects.find((p) => p.id === pid);
  assert.strictEqual(project.voteCount, 3);
  assert.strictEqual(project.average, 8); // (8+6+10)/3
  assert.strictEqual(res.body.votesByProject[pid].length, 3);
  const names = res.body.votesByProject[pid].map((x) => x.voterName).sort();
  assert.deepStrictEqual(names, ['Kim Qi', 'Lee Qi', 'Sam Qi']);
});

test('admin can remove a specific vote (duplicate cleanup)', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  const pid = await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);

  for (const [name, score] of [['Sam', 8], ['Kim', 6]]) {
    const v = request.agent(app);
    await v.post('/api/voter/register').send({ firstName: name, lastName: 'Qi' }).expect(200);
    await v.post('/api/votes').send({ projectId: pid, score }).expect(200);
  }

  let res = await admin.get('/api/admin/results').expect(200);
  const kim = res.body.votesByProject[pid].find((x) => x.voterName === 'Kim Qi');
  assert.ok(kim.voteId, 'each vote exposes a voteId');

  await admin.delete('/api/admin/votes/' + kim.voteId).expect(200);

  res = await admin.get('/api/admin/results').expect(200);
  const project = res.body.projects.find((p) => p.id === pid);
  assert.strictEqual(project.voteCount, 1);              // Kim's vote gone
  assert.strictEqual(project.average, 8);               // only Sam's 8 remains
  assert.deepStrictEqual(res.body.votesByProject[pid].map((x) => x.voterName), ['Sam Qi']);
});

test('removing a vote requires admin, and a missing vote 404s', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await request(app).delete('/api/admin/votes/1').expect(401);
  await admin.delete('/api/admin/votes/99999').expect(404);
});

const SAMPLE_CSV =
  'Timestamp,Email Address,Team Name,Team Members,Elevator Pitch\n' +
  '9/8/2026 14:41:00,a@x.com,Alpha Team,"Ann A, Bo B","A pitch, with a comma"\n' +
  '9/8/2026 14:51:00,b@x.com,Beta Team,"Cy C","Multi\nline pitch"\n';

test('CSV upload replaces all projects (team name, members, pitch)', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await addProject(admin, 'Old Project', 'to be replaced');

  const res = await admin.post('/api/admin/projects/upload').send({ csv: SAMPLE_CSV }).expect(200);
  assert.strictEqual(res.body.count, 2);

  const { body } = await admin.get('/api/admin/projects').expect(200);
  assert.deepStrictEqual(body.projects.map((p) => p.name), ['Alpha Team', 'Beta Team']);
  assert.strictEqual(body.projects[0].team_members, 'Ann A, Bo B');
  assert.strictEqual(body.projects[0].description, 'A pitch, with a comma');
  assert.strictEqual(body.projects[1].description, 'Multi\nline pitch');
});

test('CSV upload is blocked unless the vote is a draft', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await addProject(admin, 'Alpha');
  await admin.post('/api/admin/status').send({ status: 'live' }).expect(200);
  await admin.post('/api/admin/projects/upload').send({ csv: SAMPLE_CSV }).expect(409);
});

test('a CSV with no team rows is rejected and leaves projects intact', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  await addProject(admin, 'Keep Me');
  await admin.post('/api/admin/projects/upload').send({ csv: 'Timestamp,Email,Team Name\n' }).expect(400);
  const { body } = await admin.get('/api/admin/projects').expect(200);
  assert.deepStrictEqual(body.projects.map((p) => p.name), ['Keep Me']);
});

test('CSV upload requires admin auth', async () => {
  const app = makeApp();
  await request(app).post('/api/admin/projects/upload').send({ csv: SAMPLE_CSV }).expect(401);
});

test('a project with no votes reports null average and zero count', async () => {
  const app = makeApp();
  const admin = await adminAgent(app);
  const pid = await addProject(admin, 'Alpha');
  const res = await admin.get('/api/admin/results').expect(200);
  const project = res.body.projects.find((p) => p.id === pid);
  assert.strictEqual(project.voteCount, 0);
  assert.strictEqual(project.average, null);
});
