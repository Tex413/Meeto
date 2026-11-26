'use strict';

// Runs the real server.js with the LM Studio backend against a stand-in LM Studio. scripts/probe-outbound.js is
// preloaded, so every https.request and non-loopback fetch is refused and printed as an OUTBOUND line.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const MODEL = 'test-resident-model';

async function freePort() {
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

test('real server with the LM Studio backend', { timeout: 90_000 }, async t => {
  const lmRequests = [];
  let lmFails = false;
  const lm = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      lmRequests.push(JSON.parse(body));
      res.writeHead(lmFails ? 500 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lmFails
        ? { error: 'synthetic failure' }
        : { choices: [{ message: { content: 'local answer' } }] }));
    });
  }).listen(0, '127.0.0.1');
  await once(lm, 'listening');

  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeteor-gate-'));
  let output = '';
  let child = null;

  async function start() {
    child = spawn(process.execPath, ['--require', path.join(ROOT, 'scripts', 'probe-outbound.js'), 'server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        PORT: String(port),
        DESKTOP_MODE: '1',
        DESKTOP_DEV: '1',
        LMSTUDIO_URL: `http://127.0.0.1:${lm.address().port}/v1`,
        LMSTUDIO_MODEL: MODEL,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const started = output.length;
    await new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.slice(started).includes('running at')) resolve();
      });
      child.once('exit', code => reject(new Error(`server exited with code ${code}`)));
    });
  }
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  t.after(async () => {
    await stop();
    lm.closeAllConnections();
    lm.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function call(method, route, body) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() };
  }
  // Model downloads, the market ticker and news may use the internet; AI and Microsoft hosts may not.
  const cloudCalls = () => output.split('\n')
    .filter(line => /^OUTBOUND .*(openai|anthropic|microsoft)/i.test(line));
  const ask = () => call('POST', '/proxy', {
    model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'synthetic question' }],
  });
  const refine = () => call('POST', '/transcribe/refine', { text: 'synthetic words said in a meeting' });

  await start();

  await t.test('the selection is saved, reads back and survives a restart', async () => {
    // A leftover Anthropic-style key must not reroute a local selection.
    const saved = await call('POST', '/user/settings', { provider: 'lmstudio', openaiKey: 'sk-ant-synthetic' });
    assert.equal(saved.status, 200);
    await stop();
    await start();
    const { body } = await call('GET', '/user/settings');
    assert.equal(body.provider, 'lmstudio');
    assert.equal(body.model, MODEL);
    assert.equal(body.localOnly, true);
  });

  await t.test('an unsupported provider is rejected and nothing changes', async () => {
    for (const provider of ['claude-code', 'LMStudio', '', null, ['lmstudio']]) {
      const result = await call('POST', '/user/settings', { provider, model: 'changed' });
      assert.equal(result.status, 400, JSON.stringify(provider));
    }
    assert.equal((await call('GET', '/user/settings')).body.provider, 'lmstudio');
  });

  await t.test('ask and transcript cleanup use LM Studio with the configured model', async () => {
    const asked = await ask();
    assert.equal(asked.status, 200);
    assert.equal(asked.body.content[0].text, 'local answer');
    assert.deepEqual((await refine()).body, { text: 'local answer' });
    assert.deepEqual(lmRequests.map(r => r.model), [MODEL, MODEL]);
  });

  await t.test('an LM Studio failure is shown, with no cloud fallback', async () => {
    lmFails = true;
    for (const result of [await ask(), await refine()]) {
      assert.equal(result.status, 502);
      assert.match(result.body.error, /LM Studio error: synthetic failure/);
    }
    lmFails = false;
  });

  await t.test('cloud web research and Microsoft To Do are refused by the server', async () => {
    const research = await call('POST', '/proxy', {
      messages: [{ role: 'user', content: 'synthetic company' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });
    assert.equal(research.status, 403);
    await call('POST', '/msft/save-client', { clientId: 'synthetic-client' });
    const routes = [
      ['POST', '/msft/start-auth', {}],
      ['POST', '/msft/poll-auth', { device_code: 'synthetic' }],
      ['GET', '/msft/lists'],
      ['POST', '/msft/create-tasks', { listId: 'x', tasks: ['synthetic task'] }],
    ];
    for (const [method, route, body] of routes) {
      const result = await call(method, route, body);
      assert.equal(result.status, 403, route);
      assert.match(result.body.error, /blocked/);
    }
  });

  await t.test('no request was attempted to a cloud AI or Microsoft host', () => {
    assert.deepEqual(cloudCalls(), []);
  });
});
