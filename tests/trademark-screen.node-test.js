'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { screenName, checkDomain } = require('../scripts/trademark-screen');

const OPTIONS = { stem: 'verbat', control: 'verbatim' };

function reply(body, status = 200) {
  return { ok: status < 300, status, json: async () => body, text: async () => String(body) };
}

function register(marks, extra = {}) {
  return reply({
    timedOut: false,
    shardsFailed: 0,
    hits: { totalValue: marks.length, hits: marks.map((source) => ({ id: source.wordmark, source })) },
    ...extra,
  });
}

// Answers the control query first, then every later query with `next`.
function fakeFetch(next, controlReply = register([{ wordmark: 'VERBATIM', alive: true }])) {
  let calls = 0;
  return async () => (calls++ === 0 ? controlReply : next());
}

test('reports an empty result only after the control query finds marks', async () => {
  const result = await screenName('verbatimely', { ...OPTIONS, fetchImpl: fakeFetch(() => register([])) });
  assert.equal(result.controlTotal, 1);
  assert.deepEqual([result.exact.total, result.similar.total, result.liveStem.total], [0, 0, 0]);
});

test('refuses to report zero conflicts when the control query finds nothing', async () => {
  const fetchImpl = fakeFetch(() => register([]), register([]));
  await assert.rejects(screenName('verbatimely', { ...OPTIONS, fetchImpl }), /cannot be trusted/);
});

for (const [label, broken] of [
  ['an HTTP error', () => reply({}, 503)],
  ['a bot-challenge status', () => reply({}, 202)],
  ['a page without a result set', () => reply({ message: 'ok' })],
  ['failed shards', () => register([], { shardsFailed: 1 })],
  ['a server-side timeout', () => register([], { timedOut: true })],
]) {
  test(`fails on ${label} instead of reading it as no conflicts`, async () => {
    await assert.rejects(screenName('verbatimely', { ...OPTIONS, fetchImpl: fakeFetch(broken) }), /USPTO/);
  });
}

test('keeps each mark with its classes and flags a truncated list', async () => {
  const mark = { wordmark: 'VERBATIM', alive: true, internationalClass: ['IC 009'], ownerName: ['Owner'] };
  const next = () => reply({ timedOut: false, shardsFailed: 0, hits: { totalValue: 500, hits: [{ source: mark }] } });
  const result = await screenName('verbatimely', { ...OPTIONS, fetchImpl: fakeFetch(next) });
  assert.equal(result.liveStem.truncated, true);
  assert.deepEqual(result.liveStem.marks[0].internationalClass, ['IC 009']);
});

test('rejects a name, stem or control that is not plain letters and digits', async () => {
  const fetchImpl = () => assert.fail('no request expected');
  await assert.rejects(screenName('', { ...OPTIONS, fetchImpl }), /name/);
  await assert.rejects(screenName('verbatimely', { ...OPTIONS, stem: '*', fetchImpl }), /stem/);
  await assert.rejects(screenName('verbatimely', { stem: 'verbat', fetchImpl }), /control/);
});

test('reads the title and description of a look-alike domain', async () => {
  const html = '<title>Verbatimly |\n AI Transcription</title><meta name="description" content="Transcribe audio">';
  const found = await checkDomain('verbatimly.com', { fetchImpl: async () => reply(html) });
  assert.deepEqual(found, {
    domain: 'verbatimly.com', status: 200, title: 'Verbatimly | AI Transcription', description: 'Transcribe audio',
  });
});

test('records an unreachable domain as unknown, with the reason', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  const found = await checkDomain('verbatimly.app', { fetchImpl });
  assert.deepEqual(found, { domain: 'verbatimly.app', status: null, error: 'ENOTFOUND' });
});

test('rejects a domain that carries a path or credentials', async () => {
  const fetchImpl = () => assert.fail('no request expected');
  await assert.rejects(checkDomain('user@host/path', { fetchImpl }), /domain/);
});
