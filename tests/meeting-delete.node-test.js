'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, tempDataDir } = require('./fixtures/server-harness');
const { grantConsent } = require('./fixtures/consent');

// A desktop recording is accepted only against a consent record that covers it.
async function uploadRecording(server, meetingId) {
  const consentId = await grantConsent(server, meetingId, ['recording']);
  return server.send('POST', `/recording/upload?meetingId=${meetingId}&consentId=${consentId}`, { body: 'webm-bytes' });
}

async function register(server, email) {
  const res = await server.send('POST', '/auth/register', { body: { email, password: 'test-password' } });
  assert.equal(res.status, 200);
  return { cookie: res.headers['set-cookie'][0].split(';')[0] };
}

// A meeting with one card and one meeting-scoped intel_cache row.
async function seedMeeting(server, headers) {
  const started = await server.send('POST', '/meeting/start', { headers, body: { title: 'Planning' } });
  const meetingId = started.body.id;
  await server.send('POST', '/card/save', {
    headers, body: { meetingId, cards: [{ tag: 'idea', title: 'Card', body: 'Keep me' }] },
  });
  await server.send('POST', '/api/meeting-cache', {
    headers, body: { meetingId, category: 'competitor', key: 'acme', payload: { note: 'cached' } },
  });
  return meetingId;
}

async function cardCount(server, headers, meetingId) {
  const res = await server.send('GET', `/meeting/${meetingId}`, { headers });
  assert.equal(res.status, 200);
  return res.body.cards.length;
}

async function cacheKeys(server, headers, meetingId) {
  const res = await server.send('GET', `/api/meeting-cache/all?meetingId=${meetingId}&category=competitor`, { headers });
  return Object.keys(res.body.entries);
}

test('deleting another user\'s meeting id returns 404 and removes nothing', async t => {
  const server = await startServer(t, { dataDir: tempDataDir(t) });
  const owner = await register(server, 'owner@test.invalid');
  const other = await register(server, 'other@test.invalid');
  const meetingId = await seedMeeting(server, owner);

  const res = await server.send('DELETE', `/meeting/${meetingId}`, { headers: other });
  assert.equal(res.status, 404);
  assert.equal(await cardCount(server, owner, meetingId), 1);
  assert.deepEqual(await cacheKeys(server, owner, meetingId), ['acme']);

  assert.equal((await server.send('DELETE', '/meeting/abc', { headers: owner })).status, 404);
});

test('deleting an own meeting removes its cards and intel_cache rows only', async t => {
  const server = await startServer(t, { dataDir: tempDataDir(t) });
  const owner = await register(server, 'owner@test.invalid');
  const doomed = await seedMeeting(server, owner);
  const kept = await seedMeeting(server, owner);

  const res = await server.send('DELETE', `/meeting/${doomed}`, { headers: owner });
  assert.equal(res.status, 200);
  assert.equal((await server.send('GET', `/meeting/${doomed}`, { headers: owner })).status, 404);
  assert.deepEqual(await cacheKeys(server, owner, doomed), []);
  assert.deepEqual(await cacheKeys(server, owner, kept), ['acme']);
  assert.equal(await cardCount(server, owner, kept), 1);
});

test('a recording that cannot be deleted returns an error and keeps the meeting for a retry', async t => {
  const dataDir = tempDataDir(t);
  const server = await startServer(t, { dataDir, env: { DESKTOP_MODE: '1', DESKTOP_DEV: '1' } });
  const meetingId = await seedMeeting(server, {});
  const upload = await uploadRecording(server, meetingId);
  assert.equal(upload.status, 200);
  // A directory in the file's place makes unlink fail on every platform.
  const recording = path.join(dataDir, 'recordings', upload.body.path);
  fs.rmSync(recording);
  fs.mkdirSync(recording);

  const failed = await server.send('DELETE', `/meeting/${meetingId}`);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, 'recording_delete_failed');
  assert.match(failed.body.message, /not deleted/i);
  assert.ok(!JSON.stringify(failed.body).includes('recordings'), 'no server path in the response');
  assert.equal(await cardCount(server, {}, meetingId), 1);
  assert.deepEqual(await cacheKeys(server, {}, meetingId), ['acme']);

  // Once the obstacle is gone, a file that is already missing counts as deleted.
  fs.rmdirSync(recording);
  assert.equal((await server.send('DELETE', `/meeting/${meetingId}`)).status, 200);
  assert.equal((await server.send('GET', `/meeting/${meetingId}`)).status, 404);
});

test('deleting a meeting removes its recording file', async t => {
  const dataDir = tempDataDir(t);
  const server = await startServer(t, { dataDir, env: { DESKTOP_MODE: '1', DESKTOP_DEV: '1' } });
  const meetingId = await seedMeeting(server, {});
  const upload = await uploadRecording(server, meetingId);
  const recording = path.join(dataDir, 'recordings', upload.body.path);
  assert.ok(fs.existsSync(recording));

  assert.equal((await server.send('DELETE', `/meeting/${meetingId}`)).status, 200);
  assert.ok(!fs.existsSync(recording));
});
