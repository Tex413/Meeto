'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSpokenAudio } = require('../speech-mute');
const { ROOT, startServer, tempDataDir } = require('./fixtures/server-harness');

// A clip that behaves like the browser's Audio element: pausing while play() is pending rejects it.
function fakeClip({ holdPlay = false } = {}) {
  const clip = { played: 0, paused: 0 };
  let rejectPlay = null;
  clip.play = () => {
    clip.played += 1;
    if (holdPlay) return new Promise((_, reject) => { rejectPlay = reject; });
    clip.onplay();
    return Promise.resolve();
  };
  clip.pause = () => {
    clip.paused += 1;
    if (rejectPlay) rejectPlay(new Error('play() interrupted by pause()'));
  };
  return clip;
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function dependencies(overrides = {}) {
  const seen = { clips: [], synthesized: [], revoked: [], state: 'idle', logs: [] };
  const deps = {
    synthesize: async text => { seen.synthesized.push(text); return text; },
    createAudio: () => { const clip = fakeClip(); seen.clips.push(clip); return clip; },
    createUrl: wav => `blob:${wav}`,
    revokeUrl: url => seen.revoked.push(url),
    storage: memoryStorage(),
    onPlaying: () => { seen.state = 'speaking'; },
    onIdle: () => { seen.state = 'idle'; },
    log: message => seen.logs.push(message),
    ...overrides,
  };
  return { deps, seen };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('muting stops every clip that is playing at once', async () => {
  const { deps, seen } = dependencies();
  const voice = createSpokenAudio(deps);
  await voice.speak('first');
  await voice.speak('second');
  assert.equal(seen.state, 'speaking');

  voice.setMuted(true);

  assert.deepEqual(seen.clips.map(clip => clip.paused), [1, 1]);
  assert.deepEqual(seen.revoked, ['blob:first', 'blob:second']);
  assert.equal(seen.state, 'idle');
});

test('nothing is synthesized or played while muted, and speech returns after unmuting', async () => {
  const { deps, seen } = dependencies();
  const voice = createSpokenAudio(deps);
  voice.setMuted(true);
  await voice.speak('silent');
  assert.deepEqual(seen.synthesized, []);
  assert.equal(seen.clips.length, 0);

  voice.setMuted(false);
  await voice.speak('audible');
  assert.equal(seen.clips.length, 1);
  assert.equal(seen.clips[0].played, 1);
});

for (const [name, unmute] of [['still muted', false], ['unmuted again', true]]) {
  test(`an answer being prepared when mute is pressed is never played (${name})`, async () => {
    let finish;
    const { deps, seen } = dependencies({ synthesize: () => new Promise(resolve => { finish = resolve; }) });
    const voice = createSpokenAudio(deps);
    const pending = voice.speak('late');
    voice.setMuted(true);
    if (unmute) voice.setMuted(false);
    finish('late');
    await pending;

    assert.equal(seen.clips.length, 0);
    assert.equal(seen.state, 'idle');
  });
}

test('muting while a clip is starting pauses it without reporting a failure', async () => {
  const clip = fakeClip({ holdPlay: true });
  const { deps, seen } = dependencies({ createAudio: () => clip });
  const voice = createSpokenAudio(deps);
  const pending = voice.speak('starting');
  await tick();
  voice.setMuted(true);
  await pending;
  clip.onplay(); // a play event already queued by the browser must not revive the speaking state

  assert.equal(clip.paused, 1);
  assert.equal(seen.state, 'idle');
  assert.deepEqual(seen.revoked, ['blob:starting']);
  assert.equal(seen.logs.some(line => line.includes('failed')), false);
});

test('a failed or finished clip releases its audio and returns to idle', async () => {
  const refused = { play: () => Promise.reject(new Error('autoplay blocked')), pause() {} };
  const { deps, seen } = dependencies({ createAudio: () => refused });
  await createSpokenAudio(deps).speak('blocked');
  assert.deepEqual(seen.revoked, ['blob:blocked']);
  assert.ok(seen.logs.includes('Piper TTS failed: autoplay blocked'));

  const normal = dependencies();
  await createSpokenAudio(normal.deps).speak('done');
  normal.seen.clips[0].onended();
  assert.deepEqual(normal.seen.revoked, ['blob:done']);
  assert.equal(normal.seen.state, 'idle');
});

test('the mute choice survives a page reload', async () => {
  const storage = memoryStorage();
  createSpokenAudio(dependencies({ storage }).deps).setMuted(true);

  const reloaded = dependencies({ storage });
  const voice = createSpokenAudio(reloaded.deps);
  assert.equal(voice.isMuted(), true);
  await voice.speak('after reload');
  assert.equal(reloaded.seen.clips.length, 0);
});

test('audio stops even when the mute choice cannot be saved', async () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const { deps, seen } = dependencies({ storage });
  const voice = createSpokenAudio(deps);
  await voice.speak('loud');

  assert.throws(() => voice.setMuted(true), /quota/);
  assert.equal(seen.clips[0].paused, 1);
  assert.equal(voice.isMuted(), true);
});

// Runs the wiring that ships in index.html against the real module, with only browser objects faked.
test('the page control stops the page\'s own speakAnswer and keeps it silent', async () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(page.match(/id="voiceMuteBtn"/g).length, 1);
  assert.ok(page.indexOf('<script src="/speech-mute.js">') < page.indexOf('createSpokenAudio({'));
  const wiring = page.slice(page.indexOf('const spokenAudio ='), page.indexOf('// LLM refine pass'));

  const elements = new Map();
  const element = () => ({ attributes: {}, classes: new Set(), setAttribute(k, v) { this.attributes[k] = v; },
    get classList() { return { toggle: (n, on) => (on ? this.classes.add(n) : this.classes.delete(n)) }; } });
  const clips = [];
  const context = vm.createContext({
    getPiper: async () => ({ predict: async () => 'wav' }),
    PIPER_VOICE: 'voice',
    Audio: function Audio() { const clip = fakeClip(); clips.push(clip); return clip; },
    URL: { createObjectURL: () => 'blob:wav', revokeObjectURL: () => {} },
    localStorage: memoryStorage(),
    setPresenceState: state => { context.presence = state; },
    listening: true,
    dbg: () => {},
    document: {
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'speech-mute.js'), 'utf8'), context);
  vm.runInContext(`var _speaking = false;\n${wiring}`, context);

  await context.speakAnswer('hello');
  assert.equal(context._speaking, true);

  context.toggleVoiceMute();
  assert.equal(clips[0].paused, 1);
  assert.equal(context._speaking, false);
  assert.equal(context.presence, 'listening');
  assert.equal(elements.get('voiceMuteBtn').attributes['aria-pressed'], 'true');
  assert.equal(elements.get('voiceMuteLabel').textContent, 'Voice muted · Unmute');

  await context.speakAnswer('again');
  assert.equal(clips.length, 1);
});

test('the server serves the mute module the page loads', async t => {
  const server = await startServer(t, { dataDir: tempDataDir(t) });
  const response = await server.send('GET', '/speech-mute.js');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^application\/javascript/);
  assert.equal(response.body, fs.readFileSync(path.join(ROOT, 'speech-mute.js'), 'utf8'));
});
