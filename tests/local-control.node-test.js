'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { ROOT, startServer, tempDataDir } = require('./fixtures/server-harness');

const COMMANDS = ['/api/local/start-recording', '/api/local/stop-recording'];
const TOKEN = 'synthetic-local-control-value';

// Subscribes like the browser tab does and collects whatever the server broadcasts.
function listen(t, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/local/events' }, res => {
      let received = '';
      res.on('data', chunk => { received += chunk; });
      res.once('data', () => resolve({ status: res.statusCode, headers: res.headers, received: () => received }));
    });
    req.on('error', reject);
    t.after(() => req.destroy());
  });
}

const settle = () => new Promise(resolve => setTimeout(resolve, 150));

const OUTSIDE_REQUESTS = {
  'X-Forwarded-For': { 'x-forwarded-for': '203.0.113.7' },
  'X-Forwarded-Host': { 'x-forwarded-host': 'meet.example.com' },
  'X-Forwarded-Proto': { 'x-forwarded-proto': 'https' },
  'X-Real-IP': { 'x-real-ip': '203.0.113.7' },
  Forwarded: { forwarded: 'for=203.0.113.7' },
  Via: { via: '1.1 proxy' },
  'CF-Connecting-IP': { 'cf-connecting-ip': '203.0.113.7' },
  'public Host': { host: 'meet.example.com' },
  'look-alike Host': { host: 'localhost.example.com' },
  'cross-site Origin': { origin: 'https://evil.example.com' },
  'opaque Origin': { origin: 'null' },
  'cross-site fetch': { 'sec-fetch-site': 'cross-site' },
};

test('a proxied or outside request cannot start capture, even from a loopback socket', async t => {
  const server = await startServer(t, { dataDir: tempDataDir(t) });
  const tab = await listen(t, server.port);

  for (const [name, headers] of Object.entries(OUTSIDE_REQUESTS)) {
    for (const url of COMMANDS) {
      assert.equal((await server.send('POST', url, { headers })).status, 403, `${name} ${url}`);
    }
    assert.equal((await server.send('GET', '/api/local/events', { headers })).status, 403, `${name} events`);
  }
  await settle();
  assert.doesNotMatch(tab.received(), /event:/);
});

test('the local default still works without a token and warns about it', async t => {
  const server = await startServer(t, { dataDir: tempDataDir(t) });
  const tab = await listen(t, server.port);
  assert.equal(tab.status, 200);
  assert.equal(tab.headers['access-control-allow-origin'], undefined);

  const started = await server.send('POST', COMMANDS[0]);
  assert.deepEqual([started.status, started.body], [200, { ok: true, listeners: 1 }]);
  const stopped = await server.send('POST', COMMANDS[1], { headers: { origin: `http://localhost:${server.port}` } });
  assert.equal(stopped.status, 200);
  await settle();
  assert.match(tab.received(), /event: start-recording[\s\S]*event: stop-recording/);
  assert.match(server.output(), /WARNING: local recording start\/stop is running without LOCAL_CONTROL_TOKEN/);
});

test('a deployment with a public PUBLIC_URL and no token refuses commands from clean loopback', async t => {
  for (const PUBLIC_URL of ['https://meet.example.com', 'https://localhost.example.com', 'not a url']) {
    const server = await startServer(t, { dataDir: tempDataDir(t), env: { PUBLIC_URL } });
    for (const url of COMMANDS) {
      assert.equal((await server.send('POST', url)).status, 403, `${PUBLIC_URL} ${url}`);
    }
    await server.stop();
  }
});

test('when LOCAL_CONTROL_TOKEN is set, commands need it as a bearer header', async t => {
  for (const env of [{}, { PUBLIC_URL: 'https://meet.example.com' }]) {
    const server = await startServer(t, { dataDir: tempDataDir(t), env: { ...env, LOCAL_CONTROL_TOKEN: TOKEN } });
    for (const url of COMMANDS) {
      assert.equal((await server.send('POST', url)).status, 401, 'missing');
      const wrong = { authorization: 'Bearer wrong-value' };
      assert.equal((await server.send('POST', url, { headers: wrong })).status, 401, 'wrong');
      assert.equal((await server.send('POST', `${url}?token=${TOKEN}`)).status, 401, 'query string');
      const right = { authorization: `Bearer ${TOKEN}` };
      assert.equal((await server.send('POST', url, { headers: right })).status, 200, 'correct');
      const proxied = { ...right, 'x-forwarded-for': '203.0.113.7' };
      assert.equal((await server.send('POST', url, { headers: proxied })).status, 403, 'proxied with token');
    }
    assert.ok(!server.output().includes(TOKEN), 'the token is never logged');
    await server.stop();
  }
});

test('the MCP tools start and stop through the real server with and without a token', async t => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  for (const tokenEnv of [{}, { LOCAL_CONTROL_TOKEN: TOKEN }]) {
    const server = await startServer(t, { dataDir: tempDataDir(t), env: tokenEnv });
    const client = new Client({ name: 'meeteor-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, 'mcp-server.js')],
      env: { MEETO_BASE_URL: `http://127.0.0.1:${server.port}`, ...tokenEnv },
    }));
    try {
      for (const name of ['start_meeting_recording', 'stop_meeting_recording']) {
        const result = await client.callTool({ name, arguments: {} });
        assert.ok(!result.isError, result.content[0].text);
      }
    } finally {
      await client.close();
    }
    await server.stop();
  }
});
