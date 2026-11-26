'use strict';

// Shows where the real server.js tries to send data when a local AI backend is requested.
// Usage: node scripts/probe-outbound.js   (takes about 45 s; port 7499 must be free)
// The server runs with a temporary DATA_DIR and a fake key. Its https.request and non-loopback fetch
// calls are recorded and refused, also in worker threads. Other network APIs are not intercepted, and
// browser-side requests (index.html) are not covered, so an empty result would not prove nothing leaves.

const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once, EventEmitter } = require('node:events');

const PORT = 7499;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER = path.join(__dirname, '..', 'server.js');
const START_TIMEOUT_MS = 30_000;
const BACKGROUND_WAIT_MS = 40_000; // server.js starts its market and stock jobs at 30 s and 35 s

function blockOutbound() {
  const record = target => fs.writeSync(1, `OUTBOUND ${target}\n`);
  https.request = options => {
    // The query string is dropped because it can carry an API key.
    record(`${options.hostname}${String(options.path).split('?')[0]}`);
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => setImmediate(() => request.emit('error', new Error('blocked by probe')));
    return request;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input.url || input));
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '127.0.0.1') return realFetch(input, init);
    record(`${url.hostname}${url.pathname}`);
    return Promise.reject(new Error('blocked by probe'));
  };
}

// Fails when something else holds the port, so the probe never talks to a real instance.
async function assertPortFree() {
  const listener = net.createServer();
  listener.listen(PORT, '0.0.0.0');
  await once(listener, 'listening');
  await new Promise(resolve => listener.close(resolve));
}

function waitForStart(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), START_TIMEOUT_MS);
    let output = '';
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      output += chunk;
      if (output.includes(`running at http://0.0.0.0:${PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', code => reject(new Error(`server exited with code ${code}`)));
  });
}

async function call(method, route, body) {
  const response = await fetch(BASE_URL + route, {
    method,
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`RESULT ${method} ${route} -> ${response.status} ${(await response.text()).slice(0, 200)}`);
}

async function main() {
  await assertPortFree();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeteor-probe-'));
  const child = spawn(process.execPath, ['--require', __filename, SERVER], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), DESKTOP_MODE: '1', DESKTOP_DEV: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await waitForStart(child);
    console.log('STEP select the lmstudio provider');
    await call('POST', '/user/settings', { provider: 'lmstudio', openaiKey: 'sk-synthetic-probe' });
    await call('GET', '/user/settings');
    console.log('STEP ask a question');
    await call('POST', '/proxy', { messages: [{ role: 'user', content: 'synthetic question' }] });
    console.log('STEP refine a transcript turn');
    await call('POST', '/transcribe/refine', { text: 'synthetic words said in a meeting' });
    console.log('STEP wait for background jobs');
    await new Promise(resolve => setTimeout(resolve, BACKGROUND_WAIT_MS));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Probe failed: ${error.message}`);
    process.exitCode = 1;
  });
} else {
  // Loaded through --require by the server child and inherited by its worker threads.
  blockOutbound();
}
