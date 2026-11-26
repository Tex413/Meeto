'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, tempDataDir } = require('./fixtures/server-harness');

const FAKE_TRANSCRIPT = 'the palamis merger stays confidential until zebrafish';
const FAKE_REFINED = 'the Palantir merger stays confidential until Zebrafish closes';
const SECRET_WORDS = /palamis|palantir|merger|confidential|zebrafish/i;

async function signedInHeaders(server) {
  const res = await server.send('POST', '/auth/register', {
    body: { email: 'speaker@test.invalid', password: 'test-password' },
  });
  assert.equal(res.status, 200);
  return { cookie: res.headers['set-cookie'][0].split(';')[0] };
}

test('/transcribe and /transcribe/refine write no transcript text to the log', async t => {
  const dataDir = tempDataDir(t);
  const server = await startServer(t, { dataDir, env: { FAKE_TRANSCRIPT, FAKE_REFINED } });
  const headers = await signedInHeaders(server);
  await server.send('POST', '/user/settings', { headers, body: { openaiKey: 'fake-test-key' } });
  const audio = Buffer.from(new Float32Array(1600).buffer).toString('base64');

  // The context makes the vocabulary correction change the text, which has its own log line.
  const heard = await server.send('POST', '/transcribe', {
    headers, body: { audio, sampleRate: 16000, context: 'Palantir' },
  });
  assert.equal(heard.status, 200);
  assert.match(heard.body.text, /Palantir merger/);

  const refined = await server.send('POST', '/transcribe/refine', { headers, body: { text: FAKE_TRANSCRIPT } });
  assert.equal(refined.body.text, FAKE_REFINED);

  // Node quotes the input in JSON parse errors, so a broken body must not reach the log either.
  for (const url of ['/transcribe', '/transcribe/refine']) {
    const broken = await server.send('POST', url, { headers, body: 'zebrafish merger' });
    assert.equal(broken.status, 400, url);
  }

  const logged = fs.readFileSync(path.join(dataDir, 'meetintel.log'), 'utf8');
  assert.match(logged, /Transcribe: 1600 samples @ 16000 Hz/);
  assert.doesNotMatch(logged, SECRET_WORDS);
  assert.doesNotMatch(server.output(), SECRET_WORDS);
});

test('startup redacts transcript text already in the log, keeps other lines and is repeatable', async t => {
  const dataDir = tempDataDir(t);
  const logFile = path.join(dataDir, 'meetintel.log');
  const at = '2026-06-01T10:00:00.000Z';
  fs.writeFileSync(logFile, [
    `${at} POST /transcribe`,
    `${at} Transcribe corrected: "palamis zebrafish" → "Palantir zebrafish"`,
    `${at} Transcribe: 1600 samples @ 16000 Hz → "merger confidential"`,
    `${at} Refine: "zebrafish" → "Zebrafish merger"`,
    `${at} proxy: Anthropic response 200 {"content":"confidential merger"}`,
    `${at} UNHANDLED SyntaxError: Unexpected token 'z', "zebrafish merger" is not valid JSON`,
    `${at} Recording saved: meeting-1.webm (2 MB)`,
    '',
  ].join('\n'));

  const first = await startServer(t, { dataDir });
  await first.stop();
  const once = fs.readFileSync(logFile, 'utf8');
  assert.doesNotMatch(once, SECRET_WORDS);
  assert.ok(once.includes(`${at} POST /transcribe\n`));
  assert.ok(once.includes(`${at} Transcribe: 1600 samples @ 16000 Hz [redacted]\n`));
  assert.ok(once.includes(`${at} proxy: Anthropic response 200 [redacted]\n`));
  assert.ok(once.includes(`${at} Recording saved: meeting-1.webm (2 MB)\n`));
  assert.match(once, /Redacted transcript text from 5 existing log lines/);

  const second = await startServer(t, { dataDir });
  await second.stop();
  const twice = fs.readFileSync(logFile, 'utf8');
  assert.ok(twice.startsWith(once));
  assert.equal(twice.match(/Redacted transcript text/g).length, 1);
  assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')), []);
});
