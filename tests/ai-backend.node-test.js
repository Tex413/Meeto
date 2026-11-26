'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');

const { createLmStudioBackend, envFileValue, isPrivateAddress } = require(path.join(__dirname, '..', 'lib', 'ai-backend'));

const REQUEST = { system: 'sys', messages: [{ role: 'user', content: 'synthetic' }], max_tokens: 50 };

function backend(settings, dependencies = {}) {
  return createLmStudioBackend({ readSetting: name => settings[name] || '', ...dependencies });
}

async function fakeLmStudio(t, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, body: JSON.parse(body) });
      handler(res);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { requests, url: `http://127.0.0.1:${server.address().port}/v1/` };
}

const reply = (status, payload) => res => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
};
const answer = content => reply(200, { choices: [{ message: { content }, finish_reason: 'stop' }] });

test('sends the configured model to the configured address, whatever model the screen asked for', async t => {
  const lm = await fakeLmStudio(t, answer('<think>hidden</think> OK '));
  const result = await backend({ LMSTUDIO_URL: lm.url, LMSTUDIO_MODEL: 'configured-model' })
    .complete({ ...REQUEST, model: 'claude-sonnet-4-20250514' });

  assert.equal(result.content[0].text, 'OK');
  assert.equal(lm.requests[0].url, '/v1/chat/completions');
  assert.equal(lm.requests[0].body.model, 'configured-model');
  assert.deepEqual(lm.requests[0].body.messages[0], { role: 'system', content: 'sys' });
  assert.equal('reasoning_effort' in lm.requests[0].body, false);
});

test('passes the configured reasoning effort', async t => {
  const lm = await fakeLmStudio(t, answer('OK'));
  await backend({ LMSTUDIO_URL: lm.url, LMSTUDIO_MODEL: 'm', LMSTUDIO_REASONING_EFFORT: 'none' }).complete(REQUEST);
  assert.equal(lm.requests[0].body.reasoning_effort, 'none');
});

test('has no built-in model name', async () => {
  await assert.rejects(backend({}).complete(REQUEST), /set LMSTUDIO_MODEL/);
});

test('refuses cloud web search tools without contacting any server', async t => {
  const lm = await fakeLmStudio(t, answer('OK'));
  await assert.rejects(
    backend({ LMSTUDIO_URL: lm.url, LMSTUDIO_MODEL: 'm' }).complete({ ...REQUEST, tools: [{ name: 'web_search' }] }),
    { statusCode: 403 },
  );
  assert.equal(lm.requests.length, 0);
});

test('reports upstream errors, bad replies and empty answers', async t => {
  const cases = [
    [reply(400, { error: { message: 'model not loaded' } }), /LM Studio error: model not loaded/],
    [reply(200, 'not json'), /LM Studio error: HTTP 200/],
    [answer(''), /no answer text/],
  ];
  for (const [handler, expected] of cases) {
    const lm = await fakeLmStudio(t, handler);
    await assert.rejects(backend({ LMSTUDIO_URL: lm.url, LMSTUDIO_MODEL: 'm' }).complete(REQUEST), expected);
  }
});

test('times out with a clear error', async t => {
  const lm = await fakeLmStudio(t, () => {});
  await assert.rejects(
    backend({ LMSTUDIO_URL: lm.url, LMSTUDIO_MODEL: 'm', LMSTUDIO_TIMEOUT_MS: '100' }).complete(REQUEST),
    { statusCode: 504 },
  );
});

test('refuses a public address, given as a literal or reached through a name', async () => {
  await assert.rejects(
    backend({ LMSTUDIO_URL: 'http://93.184.215.14:1234/v1', LMSTUDIO_MODEL: 'm' }).complete(REQUEST),
    /not on this machine or your network/,
  );
  // One public address among private ones is enough to refuse the name.
  const lookup = (host, options, callback) => callback(null, [
    { address: '10.0.0.5', family: 4 }, { address: '93.184.215.14', family: 4 },
  ]);
  await assert.rejects(
    backend({ LMSTUDIO_URL: 'http://lm.example.test:1234/v1', LMSTUDIO_MODEL: 'm' }, { lookup }).complete(REQUEST),
    /not on this machine or your network/,
  );
});

test('follows no redirect away from the configured server', async t => {
  const other = await fakeLmStudio(t, answer('leaked'));
  const lm = await fakeLmStudio(t, res => { res.writeHead(307, { Location: `${other.url}chat/completions` }); res.end(); });
  await assert.rejects(backend({ LMSTUDIO_URL: lm.url, LMSTUDIO_MODEL: 'm' }).complete(REQUEST), /HTTP 307/);
  assert.equal(other.requests.length, 0);
});

test('rejects addresses that are not plain http or https', async () => {
  for (const value of ['file:///etc/passwd', 'localhost:1234', 'http://user:pw@127.0.0.1/v1']) {
    await assert.rejects(backend({ LMSTUDIO_URL: value, LMSTUDIO_MODEL: 'm' }).complete(REQUEST), /LMSTUDIO_URL/);
  }
});

test('classifies private and public addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.65.254', '100.64.0.1', '::1', 'fd00::2']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '::ffff:8.8.8.8', '2606:4700::1111', 'localhost']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('ignores commented and empty .env entries', () => {
  const content = '# LMSTUDIO_URL=http://example.test/v1\nLMSTUDIO_MODEL=\nOTHER=x\n  LMSTUDIO_TIMEOUT_MS = 5000 \r\n';
  assert.equal(envFileValue(content, 'LMSTUDIO_URL'), '');
  assert.equal(envFileValue(content, 'LMSTUDIO_MODEL'), '');
  assert.equal(envFileValue(content, 'LMSTUDIO_TIMEOUT_MS'), '5000');
});
