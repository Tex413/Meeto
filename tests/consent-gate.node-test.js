'use strict';

// Meeting consent gate (docs/decisions/consent-legal-review.md, "Gate requirements").
// The server tests run the real server.js on a temporary data folder; only the speech
// model is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('../consent-gate');
const { createConsentController, createAnnouncement } = require('../consent-client');
const { createSpeaker } = require('../consent-prompt');
const { startServer, tempDataDir } = require('./fixtures/server-harness');
const { grantBody, grantConsent } = require('./fixtures/consent');

const AUDIO = Buffer.from(new Float32Array(1600).buffer).toString('base64');
const SPOKEN = 'stub spoken words';
const JSON_TYPE = { 'content-type': 'application/json' };

async function desktopServer(t, env = {}) {
  const dataDir = tempDataDir(t);
  const server = await startServer(t, {
    dataDir,
    env: { DESKTOP_MODE: '1', DESKTOP_DEV: '1', NODE_ENV: 'test', ROOM_CAMERA_DEV: '', FAKE_TRANSCRIPT: SPOKEN, ...env },
  });
  const call = (method, url, body, headers = JSON_TYPE) => server.send(method, url, {
    body, headers: body === undefined ? {} : { ...headers },
  });
  return {
    server,
    dataDir,
    call,
    newMeeting: async () => (await call('POST', '/meeting/start', { title: 'Synthetic meeting' })).body.id,
    grant: (meetingId, modes) => grantConsent(server, meetingId, modes),
    transcribe: (meetingId, consentId, extra = {}) =>
      call('POST', '/transcribe', { meetingId, consentId, audio: AUDIO, ...extra }),
    upload: (meetingId, consentId, content = 'synthetic-webm') => call('POST',
      `/recording/upload?meetingId=${meetingId}&consentId=${consentId}`, content, { 'content-type': 'video/webm' }),
    records: async meetingId => (await call('GET', '/meeting/' + meetingId)).body.consents,
    recordingFiles: () => fs.readdirSync(path.join(dataDir, 'recordings')),
  };
}

test('/transcribe rejects a request or meeting with no consent record', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
  for (const body of [
    { audio: AUDIO },
    { audio: AUDIO, meetingId },
    { audio: '', meetingId },
    { audio: AUDIO, meetingId, consentId: 'made-up' },
    { audio: AUDIO, meetingId, source: 'recording' },
    { audio: AUDIO, meetingId, source: 'other' },
  ]) {
    const result = await app.call('POST', '/transcribe', body);
    assert.equal(result.status, 403, JSON.stringify({ ...body, audio: undefined }));
    assert.equal(result.body.error, 'consent_required');
    assert.equal(result.body.text, undefined);
  }
});

test('/recording/upload rejects a meeting with no consent record and writes nothing', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
  const otherMeetings = await app.grant(await app.newMeeting(), ['recording']);
  for (const consentId of ['', 'made-up', otherMeetings]) {
    const result = await app.upload(meetingId, consentId);
    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'consent_required');
  }
  const wrongMode = await app.upload(meetingId, await app.grant(meetingId, ['microphone']));
  assert.equal(wrongMode.status, 403);
  assert.deepEqual(app.recordingFiles(), []);
});

test('a grant needs a confirmer, everyone agreeing, the announcement and a JSON request', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
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
  for (const [overrides, status] of cases) {
    const body = await grantBody(app.server, meetingId, ['microphone'], { overrides });
    const result = await app.call('POST', '/consent/grant', body);
    assert.equal(result.status, status, JSON.stringify(overrides));
  }
  const noClip = await grantBody(app.server, meetingId, ['recording'], { overrides: { announcementRecorded: false } });
  assert.equal((await app.call('POST', '/consent/grant', noClip)).status, 400);
  const valid = await grantBody(app.server, meetingId, ['microphone']);
  const forged = await app.call('POST', '/consent/grant', JSON.stringify(valid), { 'content-type': 'text/plain' });
  assert.equal(forged.status, 415);
  assert.deepEqual(await app.records(meetingId), []);
});

test('one user cannot record or withdraw consent for another user\'s meeting', async t => {
  const server = await startServer(t, { dataDir: tempDataDir(t) });
  const register = async email => {
    const res = await server.send('POST', '/auth/register', { body: { email, password: 'test-password' } });
    return { cookie: res.headers['set-cookie'][0].split(';')[0] };
  };
  const owner = await register('owner@test.invalid');
  const other = await register('other@test.invalid');
  const meetingId = (await server.send('POST', '/meeting/start', { headers: owner, body: {} })).body.id;
  const consentId = await grantConsent(server, meetingId, ['microphone'], { headers: owner });

  for (const [url, body] of [
    ['/consent/grant', { meetingId, modes: ['microphone'], confirmer: 'x', everyoneAgreed: true }],
    ['/consent/withdraw', { meetingId, reason: 'withdrawn' }],
  ]) {
    const res = await server.send('POST', url, { headers: { ...other, ...JSON_TYPE }, body });
    assert.equal(res.status, 404, url);
  }
  const stolen = await server.send('POST', '/transcribe', {
    headers: other, body: { meetingId, consentId, audio: AUDIO },
  });
  assert.equal(stolen.status, 403);
  const signedOut = await server.send('POST', '/consent/withdraw', { body: { meetingId, reason: 'withdrawn' } });
  assert.equal(signedOut.status, 401);
});

test('the record stores time, wording version, modes, destination and confirmer', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
  const started = Date.now();
  const consentId = await app.grant(meetingId, ['microphone']);
  const [record] = await app.records(meetingId);
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

  const accepted = await app.transcribe(meetingId, consentId);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.text, SPOKEN);
});

test('withdrawal is saved and stops transcription; consent never carries to another meeting', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
  const consentId = await app.grant(meetingId, ['microphone']);
  assert.equal((await app.transcribe(await app.newMeeting(), consentId)).status, 403);

  assert.equal((await app.call('POST', '/consent/withdraw', { meetingId, reason: 'withdrawn' })).status, 200);
  assert.equal((await app.transcribe(meetingId, consentId)).status, 403);
  const [record] = await app.records(meetingId);
  assert.equal(record.close_reason, 'withdrawn');
  assert.ok(Date.parse(record.closed_at));
  assert.equal((await app.call('POST', '/consent/withdraw', { meetingId, reason: 'because' })).status, 400);
});

test('audio still being transcribed at withdrawal is not returned', async t => {
  const delay = 600;
  const app = await desktopServer(t, { FAKE_TRANSCRIBE_MS: String(delay) });
  const meetingId = await app.newMeeting();
  const consentId = await app.grant(meetingId, ['microphone']);
  const inFlight = app.transcribe(meetingId, consentId);
  await new Promise(resolve => setTimeout(resolve, delay / 4));
  await app.call('POST', '/consent/withdraw', { meetingId, reason: 'withdrawn' });
  const result = await inFlight;
  assert.equal(result.status, 403);
  assert.equal(result.body.text, undefined);
});

test('ending the meeting closes its consent', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
  const consentId = await app.grant(meetingId, ['microphone']);
  await app.call('POST', '/meeting/end', { id: meetingId, transcript: '' });
  assert.equal((await app.transcribe(meetingId, consentId)).status, 403);
  assert.equal((await app.records(meetingId))[0].close_reason, 'meeting_ended');
});

test('switching to a cloud provider voids the record until consent is asked again', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
  const consentId = await app.grant(meetingId, ['microphone']);
  await app.call('POST', '/user/settings', { provider: 'anthropic', anthropicKey: 'sk-ant-synthetic-test' });
  assert.equal((await app.transcribe(meetingId, consentId)).status, 403);
  const preview = await app.call('GET', `/consent/preview?meetingId=${meetingId}&modes=microphone`);
  assert.equal(preview.body.destination.ai, 'anthropic');
  assert.match(preview.body.announcement, /sent to Anthropic, a cloud AI provider/);
});

test('each consented recording uploads once, keeps earlier parts, and delete removes them', async t => {
  const app = await desktopServer(t);
  const meetingId = await app.newMeeting();
  const first = await app.grant(meetingId, ['recording']);
  // End and Withdraw stop the recorder before the upload arrives.
  await app.call('POST', '/consent/withdraw', { meetingId, reason: 'late_arrival' });
  assert.equal((await app.upload(meetingId, first, 'part-one')).status, 200);
  assert.equal((await app.upload(meetingId, first, 'again')).status, 403);
  const second = await app.grant(meetingId, ['recording']);
  assert.equal((await app.upload(meetingId, second, 'part-two')).status, 200);

  assert.equal((await app.call('GET', `/recording/${meetingId}?part=${first}`)).body, 'part-one');
  assert.equal((await app.call('GET', `/recording/${meetingId}`)).body, 'part-two');
  const saved = await app.transcribe(meetingId, '', { source: 'recording' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  assert.equal((await app.call('DELETE', '/meeting/' + meetingId)).status, 200);
  assert.deepEqual(app.recordingFiles(), []);
  assert.equal((await app.transcribe(meetingId, second)).status, 403);
});

test('the room camera is off: flag, button and consent mode', async t => {
  const app = await desktopServer(t);
  const page = await app.call('GET', '/');
  assert.match(page.body, /ROOM_CAMERA_ENABLED = \('0' === '1'\)/);
  assert.match(page.body, /id="cameraToggleBtn" style="display:none"/);
  const meetingId = await app.newMeeting();
  const preview = await app.call('GET', `/consent/preview?meetingId=${meetingId}&modes=camera`);
  assert.equal(preview.status, 403);
  assert.equal(preview.body.error, 'camera_disabled');
  for (const script of ['/consent-client.js', '/consent-prompt.js']) {
    const served = await app.call('GET', script);
    assert.equal(served.status, 200, script);
    assert.equal(served.body, fs.readFileSync(path.join(__dirname, '..', script.slice(1)), 'utf8'));
  }
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
  for (const expected of [/an AI, not a person/, /does not save the audio/, /saved with the meeting/,
    /cloud speech service/, /record video and audio/, /camera/i, /Anthropic, a cloud AI provider/,
    /Microsoft To Do/, /must agree/]) {
    assert.match(text, expected);
  }
});

// ── page wiring ──────────────────────────────────────────────
// Every place index.html opens a capture device, and the gate that must come first in that function.
test('every capture call in the page sits behind the consent gate', () => {
  // Comments are dropped so that only real calls are counted ('//' inside a URL has no space before it).
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  const body = name => {
    const start = page.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return page.slice(start, page.indexOf('\n}\n', start));
  };
  const before = (name, gateText, deviceText) => {
    const source = body(name);
    assert.ok(source.indexOf(gateText) >= 0, `${name} lacks ${gateText}`);
    assert.ok(source.indexOf(gateText) < source.indexOf(deviceText), `${name}: ${deviceText} before ${gateText}`);
  };
  before('startListen', 'await ensureConsent(mode)', 'startWhisper(live)');
  before('startRecord', "await ensureConsent('recording')", 'openRecording(clip)');
  before('startRoomCamera', "await ensureConsent('camera')", 'getUserMedia');
  // The device helpers are reachable only through the gated functions above.
  assert.equal(page.match(/(?<!function )startWhisper\(/g).length, 1);
  assert.equal(page.match(/(?<!function )startWebSpeech\(/g).length, 1);
  assert.equal(page.match(/(?<!function )openRecording\(/g).length, 1);
  assert.equal(page.match(/getUserMedia\(/g).length, 3);
  assert.equal(page.match(/getDisplayMedia\(/g).length, 1);
  assert.equal(page.match(/new SR\(\)/g).length, 1);
  assert.match(body('initLocalControlChannel'), /'start-recording', \(\) => \{ if \(!listening\) startListen\(\); \}/);
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

test('the instant mute silences the announcement, and a muted voice never counts as spoken', async () => {
  let muted = false;
  const played = [];
  const speaking = [];
  const speak = createSpeaker({
    synthesize: async () => new Blob(['wav']),
    setSpeaking: on => speaking.push(on),
    isMuted: () => muted,
    createAudio: () => {
      const audio = { paused: 0, play: async () => {}, pause() { this.paused += 1; } };
      played.push(audio);
      return audio;
    },
  });
  const options = () => ({ clip: null, signal: new AbortController().signal });

  const running = speak('notice', options());
  await new Promise(resolve => setImmediate(resolve));
  muted = true;
  speak.mute();
  await assert.rejects(running, /voice is muted/);
  assert.ok(played[0].paused >= 1);
  assert.deepEqual(speaking, [true, false]);

  await assert.rejects(speak('notice', options()), /voice is muted/);
  assert.equal(played.length, 1);

  muted = false;
  const heard = speak('notice', options());
  await new Promise(resolve => setImmediate(resolve));
  played[1].onended();
  await heard;
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
