'use strict';

// Meeting consent gate (docs/decisions/consent-legal-review.md, "Gate requirements").
// The server tests run the real server.js on a temporary data folder; only the speech
// model is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const gate = require('../lib/consent-gate');
const { createConsentController, createAnnouncement } = require('../lib/consent-client');

const AUDIO = Buffer.from(new Float32Array(1600).buffer).toString('base64');
const TRANSCRIBE_DELAY_MS = 400;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test.describe('server', () => {
  let child, base, dataDir;

  test.before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consent-gate-'));
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--require', path.join(__dirname, 'helpers', 'stub-inference.js'), 'server.js'], {
      cwd: ROOT,
      env: {
        ...process.env, DATA_DIR: dataDir, PORT: String(port), DESKTOP_MODE: '1', DESKTOP_DEV: '1',
        NODE_ENV: 'test', ROOM_CAMERA_DEV: '', STUB_TRANSCRIBE_MS: String(TRANSCRIBE_DELAY_MS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 20000);
      child.stdout.on('data', chunk => {
        if (String(chunk).includes('running at')) { clearTimeout(timer); resolve(); }
      });
      child.on('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); });
    });
  });

  test.after(async () => {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function call(method, url, body, headers = { 'Content-Type': 'application/json' }) {
    const response = await fetch(base + url, {
      method, headers, body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not a JSON response */ }
    return { status: response.status, body: json, text };
  }

  async function newMeeting() {
    return (await call('POST', '/meeting/start', { title: 'Synthetic meeting' })).body.id;
  }

  async function grantBody(meetingId, modes, overrides = {}) {
    const preview = (await call('GET', `/consent/preview?meetingId=${meetingId}&modes=${modes.join(',')}`)).body;
    return {
      meetingId, modes, wordingVersion: preview.wordingVersion, destinationKey: preview.destination.key,
      confirmer: 'Test Host', announcedBy: 'speech', announcementRecorded: modes.includes('recording'),
      everyoneAgreed: true, ...overrides,
    };
  }

  async function grant(meetingId, modes) {
    const result = await call('POST', '/consent/grant', await grantBody(meetingId, modes));
    assert.equal(result.status, 200, result.text);
    return result.body.consentId;
  }

  function transcribe(meetingId, consentId, extra = {}) {
    return call('POST', '/transcribe', { meetingId, consentId, audio: AUDIO, ...extra });
  }

  function upload(meetingId, consentId, content = 'synthetic-webm') {
    return call('POST', `/recording/upload?meetingId=${meetingId}&consentId=${consentId}`,
      Buffer.from(content), { 'Content-Type': 'video/webm' });
  }

  const recordingFiles = () => fs.readdirSync(path.join(dataDir, 'recordings'));
  const records = async meetingId => (await call('GET', '/meeting/' + meetingId)).body.consents;

  test('/transcribe rejects a request or meeting with no consent record', async () => {
    const meetingId = await newMeeting();
    for (const body of [
      { audio: AUDIO },
      { audio: AUDIO, meetingId },
      { audio: '', meetingId },
      { audio: AUDIO, meetingId, consentId: 'made-up' },
      { audio: AUDIO, meetingId, source: 'recording' },
      { audio: AUDIO, meetingId, source: 'other' },
    ]) {
      const result = await call('POST', '/transcribe', body);
      assert.equal(result.status, 403, JSON.stringify({ ...body, audio: undefined }));
      assert.equal(result.body.error, 'consent_required');
    }
  });

  test('/recording/upload rejects a meeting with no consent record and writes nothing', async () => {
    const meetingId = await newMeeting();
    const before = recordingFiles().length;
    const microphoneOnly = await grant(await newMeeting(), ['recording']);   // another meeting
    for (const consentId of ['', 'made-up', microphoneOnly]) {
      const result = await upload(meetingId, consentId);
      assert.equal(result.status, 403);
      assert.equal(result.body.error, 'consent_required');
    }
    const wrongMode = await upload(meetingId, await grant(meetingId, ['microphone']));
    assert.equal(wrongMode.status, 403);
    assert.equal(recordingFiles().length, before);
  });

  test('a grant needs a confirmer, everyone agreeing, the announcement and a JSON request', async () => {
    const meetingId = await newMeeting();
    const cases = [
      [{ everyoneAgreed: false }, 400],
      [{ confirmer: '   ' }, 400],
      [{ confirmer: 'x'.repeat(121) }, 400],
      [{ announcedBy: 'nobody' }, 400],
      [{ modes: ['retina'] }, 400],
      [{ modes: [] }, 400],
      [{ destinationKey: 'stale' }, 409],
      [{ wordingVersion: 'older' }, 409],
      [{ meetingId: 99999 }, 404],
    ];
    for (const [override, status] of cases) {
      const result = await call('POST', '/consent/grant', await grantBody(meetingId, ['microphone'], override));
      assert.equal(result.status, status, JSON.stringify(override));
    }
    const noClip = await grantBody(meetingId, ['recording'], { announcementRecorded: false });
    assert.equal((await call('POST', '/consent/grant', noClip)).status, 400);
    const forged = await call('POST', '/consent/grant', await grantBody(meetingId, ['microphone']),
      { 'Content-Type': 'text/plain' });
    assert.equal(forged.status, 415);
    assert.deepEqual(await records(meetingId), []);
  });

  test('the record stores time, wording version, modes, destination and confirmer', async () => {
    const meetingId = await newMeeting();
    const started = Date.now();
    const consentId = await grant(meetingId, ['microphone']);
    const [record] = await records(meetingId);
    assert.equal(record.id, consentId);
    assert.ok(Date.parse(record.granted_at) >= started - 1000);
    assert.equal(record.wording_version, gate.WORDING_VERSION);
    assert.match(record.wording_version, /unapproved/);
    assert.equal(record.wording_approved, 0);
    assert.deepEqual(record.modes, ['microphone']);
    assert.equal(record.destination.server, 'this-computer');
    assert.equal(record.destination.ai, 'none');
    assert.equal(record.confirmer, 'Test Host');
    assert.equal(record.announced_by, 'speech');
    assert.match(record.announcement, /It is an AI, not a person/);
    assert.equal(record.closed_at, null);

    const accepted = await transcribe(meetingId, consentId);
    assert.equal(accepted.status, 200, accepted.text);
    assert.equal(accepted.body.text, 'stub spoken words');
  });

  test('withdrawal is saved and stops transcription; consent never carries to another meeting', async () => {
    const meetingId = await newMeeting();
    const consentId = await grant(meetingId, ['microphone']);
    assert.equal((await transcribe(await newMeeting(), consentId)).status, 403);

    assert.equal((await call('POST', '/consent/withdraw', { meetingId, reason: 'withdrawn' })).status, 200);
    assert.equal((await transcribe(meetingId, consentId)).status, 403);
    const [record] = await records(meetingId);
    assert.equal(record.close_reason, 'withdrawn');
    assert.ok(Date.parse(record.closed_at));
    assert.equal((await call('POST', '/consent/withdraw', { meetingId, reason: 'because' })).status, 400);
  });

  test('audio still being transcribed at withdrawal is neither returned nor logged', async () => {
    const logFile = path.join(dataDir, 'meetintel.log');
    const loggedTexts = () => fs.readFileSync(logFile, 'utf8').split('stub spoken words').length;
    const meetingId = await newMeeting();
    const consentId = await grant(meetingId, ['microphone']);
    const before = loggedTexts();
    const inFlight = transcribe(meetingId, consentId);
    await new Promise(resolve => setTimeout(resolve, TRANSCRIBE_DELAY_MS / 4));
    await call('POST', '/consent/withdraw', { meetingId, reason: 'withdrawn' });
    const result = await inFlight;
    assert.equal(result.status, 403);
    assert.equal(loggedTexts(), before);
  });

  test('ending the meeting closes its consent', async () => {
    const meetingId = await newMeeting();
    const consentId = await grant(meetingId, ['microphone']);
    await call('POST', '/meeting/end', { id: meetingId, transcript: '' });
    assert.equal((await transcribe(meetingId, consentId)).status, 403);
    assert.equal((await records(meetingId))[0].close_reason, 'meeting_ended');
  });

  test('switching to a cloud provider voids the record until consent is asked again', async () => {
    const meetingId = await newMeeting();
    const consentId = await grant(meetingId, ['microphone']);
    await call('POST', '/user/settings', { provider: 'anthropic', anthropicKey: 'sk-ant-synthetic-test' });
    try {
      assert.equal((await transcribe(meetingId, consentId)).status, 403);
      const preview = await call('GET', `/consent/preview?meetingId=${meetingId}&modes=microphone`);
      assert.equal(preview.body.destination.ai, 'anthropic');
      assert.match(preview.body.announcement, /sent to Anthropic, a cloud AI provider/);
    } finally {
      // Settings cannot clear a key; switching back to OpenAI (no key) restores "none".
      await call('POST', '/user/settings', { provider: 'openai' });
    }
  });

  test('each consented recording uploads once, keeps earlier parts, and delete removes them', async () => {
    const meetingId = await newMeeting();
    const first = await grant(meetingId, ['recording']);
    // End and Withdraw stop the recorder before the upload arrives.
    await call('POST', '/consent/withdraw', { meetingId, reason: 'late_arrival' });
    assert.equal((await upload(meetingId, first, 'part-one')).status, 200);
    assert.equal((await upload(meetingId, first, 'again')).status, 403);
    const second = await grant(meetingId, ['recording']);
    assert.equal((await upload(meetingId, second, 'part-two')).status, 200);

    assert.equal((await call('GET', `/recording/${meetingId}?part=${first}`)).text, 'part-one');
    assert.equal((await call('GET', `/recording/${meetingId}`)).text, 'part-two');
    const saved = await transcribe(meetingId, '', { source: 'recording' });
    assert.equal(saved.status, 200, saved.text);

    await call('DELETE', '/meeting/' + meetingId);
    assert.deepEqual(recordingFiles().filter(name => name.startsWith(`meeting-${meetingId}-`)), []);
    assert.equal((await transcribe(meetingId, second)).status, 403);
  });

  test('the room camera is off: flag, button and consent mode', async () => {
    const page = await call('GET', '/');
    assert.match(page.text, /ROOM_CAMERA_ENABLED = \('0' === '1'\)/);
    const meetingId = await newMeeting();
    const preview = await call('GET', `/consent/preview?meetingId=${meetingId}&modes=camera`);
    assert.equal(preview.status, 403);
    assert.equal(preview.body.error, 'camera_disabled');
    for (const script of ['/consent-client.js', '/consent-prompt.js']) {
      assert.equal((await call('GET', script)).status, 200);
    }
  });
});

test('the room camera can be enabled only in an unsold development run', () => {
  const on = (env, desktop, desktopDev) => gate.roomCameraEnabled({ env, desktop, desktopDev });
  assert.equal(on({}, false, false), false);
  assert.equal(on({ ROOM_CAMERA_DEV: '1', NODE_ENV: 'production' }, false, false), false);
  assert.equal(on({ ROOM_CAMERA_DEV: '1' }, true, false), false);   // packaged desktop app
  assert.equal(on({ ROOM_CAMERA_DEV: '1' }, true, true), true);
});

test('the announcement says what is captured, kept and sent to a cloud service', () => {
  const destination = gate.destinationFor({
    settings: { ai_provider: 'openai', openai_key: 'sk-ant-parked', msft_tokens: '{}' }, desktop: false,
  });
  assert.equal(destination.ai, 'anthropic');
  const text = gate.buildAnnouncement(['microphone', 'webspeech', 'recording', 'camera'], destination);
  for (const expected of [/an AI, not a person/, /does not save the audio/, /app log/, /cloud speech service/,
    /record video and audio/, /camera/i, /Anthropic, a cloud AI provider/, /Microsoft To Do/, /must agree/]) {
    assert.match(text, expected);
  }
});

// ── page controller ──────────────────────────────────────────
function harness(overrides = {}) {
  const events = [];
  let grants = 0;
  const state = { recording: false, answer: { agreed: true, confirmer: 'Host', announcedBy: 'speech' } };
  const deps = {
    api: {
      preview: async (meetingId, modes) => ({ modes, wordingVersion: 'v', destination: { key: 'k' } }),
      grant: async body => {
        events.push('grant:' + body.modes.join('+'));
        return { consentId: 'c' + (++grants), meetingId: body.meetingId, modes: body.modes };
      },
      withdraw: async (meetingId, reason) => { events.push(`server:${reason}:${meetingId}`); },
    },
    prompt: async (preview, { needsClip }) => {
      events.push('prompt:' + preview.modes.join('+') + (needsClip ? ':clip' : ''));
      return { ...state.answer, clip: needsClip ? 'clip-blob' : null };
    },
    stopCapture: () => events.push('stop'),
    isRecording: () => state.recording,
    onError: message => events.push('error:' + message),
    ...overrides,
  };
  return { consent: createConsentController(deps), events, state, deps };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('nothing is allowed before consent, and declining stops capture', async () => {
  const { consent, events, state } = harness();
  assert.equal(consent.allows('microphone', 1), false);
  assert.equal(consent.ticket('microphone', 1)(), false);
  state.answer = { agreed: false };
  assert.equal(await consent.ensure(1, ['microphone']), null);
  assert.deepEqual(events, ['prompt:microphone', 'stop', 'server:declined:1']);
  assert.equal(consent.current(), null);
});

test('a new mode, a new recording and a new meeting each ask again', async () => {
  const { consent, events, state } = harness();
  await consent.ensure(1, ['microphone']);
  await consent.ensure(1, ['microphone']);
  assert.equal(events.filter(e => e.startsWith('prompt')).length, 1);

  const recording = await consent.ensure(1, ['recording']);
  assert.equal(recording.clip, 'clip-blob');
  assert.ok(events.includes('prompt:microphone+recording:clip'));
  state.recording = true;
  await consent.ensure(1, ['camera']);
  assert.ok(events.includes('prompt:microphone+recording+camera'));

  state.recording = false;   // stopped: the next recording needs its own announcement
  events.length = 0;
  await consent.ensure(1, ['recording']);
  assert.ok(events.includes('prompt:microphone+camera+recording:clip'));

  events.length = 0;
  await consent.ensure(2, ['microphone']);
  assert.deepEqual(events.slice(0, 2), ['stop', 'prompt:microphone']);
  assert.equal(consent.allows('microphone', 1), false);
});

test('withdrawal stops devices before telling the server, even if the server fails', async () => {
  const { consent, events, deps } = harness();
  await consent.ensure(1, ['microphone']);
  const live = consent.ticket('microphone', 1);
  assert.equal(live(), true);
  events.length = 0;
  deps.api.withdraw = async () => { events.push('server'); throw new Error('offline'); };
  await consent.withdraw('withdrawn');
  assert.deepEqual(events.slice(0, 2), ['stop', 'server']);
  assert.match(events[2], /Capture is stopped.*offline/);
  assert.equal(live(), false);
  assert.equal(consent.current(), null);
});

test('a stop while the prompt or the grant is pending leaves capture off', async () => {
  const answer = deferred();
  const asking = harness({
    prompt: (preview, { signal }) => {
      signal.addEventListener('abort', () => answer.resolve({ agreed: false }));
      return answer.promise;
    },
  });
  const pending = asking.consent.ensure(1, ['microphone']);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await asking.consent.ensure(1, ['camera']), null);   // one prompt at a time
  await asking.consent.withdraw('withdrawn', 1);
  assert.equal(await pending, null);
  assert.equal(asking.consent.current(), null);

  const stored = deferred();
  const granting = harness();
  granting.deps.api.grant = () => stored.promise;
  const inFlight = granting.consent.ensure(1, ['microphone']);
  await new Promise(resolve => setImmediate(resolve));
  granting.consent.end();
  stored.resolve({ consentId: 'late', meetingId: 1, modes: ['microphone'] });
  assert.equal(await inFlight, null);
  assert.equal(granting.consent.current(), null);
  assert.ok(granting.events.includes('server:withdrawn:1'));
});

test('a server refusal keeps capture off', async () => {
  const { consent, events, deps } = harness();
  deps.api.grant = async () => { throw new Error('The announcement is out of date.'); };
  assert.equal(await consent.ensure(1, ['microphone']), null);
  assert.equal(consent.current(), null);
  assert.match(events.at(-1), /capture stays off/);
});

test('late arrival stops capture, then restarts only if everyone agrees again', async () => {
  const { consent, events, state } = harness();
  await consent.ensure(1, ['microphone']);
  const options = {
    activeModes: ['microphone'],
    restart: async modes => events.push('restart:' + modes.join('+')),
    change: async () => events.push('change'),
  };
  events.length = 0;
  assert.equal(await consent.reask('late_arrival', options), true);
  assert.deepEqual(events,
    ['stop', 'server:late_arrival:1', 'change', 'prompt:microphone', 'grant:microphone', 'restart:microphone']);

  events.length = 0;
  state.answer = { agreed: false };
  assert.equal(await consent.reask('late_arrival', options), false);
  assert.ok(!events.some(e => e.startsWith('restart')));
  assert.equal(consent.current(), null);
});

function fakeClip(log) {
  return { discard: () => log.push('discard'), stop: async () => { log.push('stop'); return 'blob'; } };
}

test('failed speech is reported so the host must read the announcement aloud', async () => {
  const session = createAnnouncement({
    text: 'notice', needsClip: false, signal: null,
    speak: async () => { throw new Error('no voice'); },
    startClip: async () => assert.fail('no clip without A/V recording'),
  });
  assert.deepEqual(await session.announce(), { spoken: false, error: 'no voice' });
});

test('the announcement clip starts before speech and is discarded unless everyone agrees', async () => {
  for (const [agreed, expected] of [[false, ['open', 'speak', 'discard']], [true, ['open', 'speak', 'stop']]]) {
    const log = [];
    const session = createAnnouncement({
      text: 'notice', needsClip: true, signal: null,
      speak: async (text, { clip }) => { assert.ok(clip); log.push('speak'); },
      startClip: async () => { log.push('open'); return fakeClip(log); },
    });
    assert.deepEqual(await session.announce(), { spoken: true });
    assert.equal(await session.finish(agreed), agreed ? 'blob' : null);
    assert.deepEqual(log, expected);
    assert.equal(session.hasClip(), false);
  }
});

test('a clip that opens after the prompt closed is discarded; no clip means no announcement', async () => {
  const log = [];
  const opened = deferred();
  const late = createAnnouncement({
    text: 'notice', needsClip: true, signal: null,
    speak: async () => log.push('speak'), startClip: () => opened.promise,
  });
  const announcing = late.announce();
  await late.finish(false);
  opened.resolve(fakeClip(log));
  await announcing;
  assert.deepEqual(log, ['discard']);

  const failing = createAnnouncement({
    text: 'notice', needsClip: true, signal: null,
    speak: async () => assert.fail('must not speak without the clip'),
    startClip: async () => { throw new Error('microphone denied'); },
  });
  await assert.rejects(failing.announce(), /microphone denied/);
});
