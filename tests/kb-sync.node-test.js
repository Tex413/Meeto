'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSet, createClient, syncKnowledge, checkAnswers, main } = require('../scripts/kb-sync.js');

const ROOT = path.join(__dirname, '..');
const KEY = 'synthetic-admin-key-for-tests-only';
const ENV = { AGENTA_URL: 'http://127.0.0.1:5999', AGENTA_ADMIN_KEY: KEY };
const noNetwork = async () => { throw new Error('unexpected network call'); };

// Follows Agenta's id rules: lineup/docs upserts by the given id; admin/articles creates on an empty id,
// updates a known id and answers 404 to an unknown one. `cite` picks the article id a reply cites.
function fakeAgenta({ tenants = [], articles = [], cite = () => [] } = {}) {
  const db = { tenants: [...tenants], articles: [...articles], cases: [] };
  const calls = [];
  let nextId = 0;
  const fetchFn = async (url, init) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, method: init.method, headers: init.headers, redirect: init.redirect, body });
    const reply = (value, status = 200) => ({ ok: status < 300, status, json: async () => structuredClone(value) });
    if (route === '/api/admin/workspace') {
      return reply({ tenants: db.tenants.map((tenant) => ({ tenant })), articles: db.articles });
    }
    if (route === '/api/lineup/tenants') {
      db.tenants.push(body);
      return reply(body);
    }
    if (route === '/api/lineup/docs') {
      for (const item of body.articles) {
        const saved = { ...item, tenantId: body.tenantId, product: body.product, version: body.version, sku: '' };
        const index = db.articles.findIndex((a) => a.id === saved.id && a.tenantId === saved.tenantId);
        if (index < 0) db.articles.push(saved); else db.articles[index] = saved;
      }
      return reply({ articlesRegistered: body.articles.length });
    }
    if (route === '/api/admin/articles') {
      const index = db.articles.findIndex((a) => a.id === body.id && a.tenantId === body.tenantId);
      if (body.id && index < 0) return reply({ error: 'not found' }, 404);
      const saved = { ...body, id: body.id || `random-${nextId += 1}` };
      if (index < 0) db.articles.push(saved); else db.articles[index] = saved;
      return reply(saved);
    }
    if (route.endsWith('/cases')) {
      db.cases.push([]);
      return reply({ id: String(db.cases.length - 1), token: 'case-token' });
    }
    const messages = db.cases[Number(route.split('/')[5])];
    if (route.endsWith('/messages')) {
      messages.push({ role: 'user', text: body.text }, { role: 'assistant', sources: cite(body.text) });
      return reply({ status: 'open' });
    }
    return reply({ messages });
  };
  return { db, calls, fetchFn, client: createClient({ baseUrl: ENV.AGENTA_URL, adminKey: KEY, fetchFn }) };
}

const writes = (calls) => calls.filter((call) => call.method === 'POST');

test('the dry run loads every docs/kb article without contacting a server', async () => {
  const files = fs.readdirSync(path.join(ROOT, 'docs', 'kb'))
    .filter((name) => name.endsWith('.md') && name !== 'README.md').sort();
  const index = fs.readFileSync(path.join(ROOT, 'docs', 'kb', 'README.md'), 'utf8');
  const indexed = [...index.matchAll(/^- \[[^\]]+\]\(([a-z0-9-]+\.md)\)/gm)].map((match) => match[1]).sort();
  const set = loadSet();
  assert.deepEqual(set.errors, []);
  assert.deepEqual(set.articles.map((article) => `${article.stem}.md`), files);
  assert.deepEqual(files, indexed);

  const lines = [];
  assert.equal(await main([], { env: {}, fetchFn: noNetwork, log: (line) => lines.push(line) }), 0);
  assert.match(lines.join('\n'), new RegExp(`Loaded ${files.length} articles`));
  for (const article of set.articles) assert.ok(lines.includes(`  ${article.stem}: ${article.title}`));
});

test('the first sync creates the tenant and each article; a repeat sync writes nothing', async () => {
  const agenta = fakeAgenta();
  const set = loadSet();
  const first = await syncKnowledge({ client: agenta.client, set });
  assert.equal(first.tenantCreated, true);
  assert.equal(first.created, set.articles.length);
  assert.equal(agenta.db.articles.length, set.articles.length);

  const before = writes(agenta.calls).length;
  const repeat = await syncKnowledge({ client: agenta.client, set });
  assert.deepEqual(
    [repeat.tenantCreated, repeat.created, repeat.updated, repeat.unchanged],
    [false, 0, 0, set.articles.length],
  );
  assert.equal(writes(agenta.calls).length, before);
  assert.equal(agenta.db.articles.length, set.articles.length);
  assert.equal(agenta.db.tenants.length, 1);
  assert.deepEqual(repeat.ids, first.ids);
});

test('a changed or retitled file updates its article in place', async () => {
  const agenta = fakeAgenta();
  const set = loadSet();
  await syncKnowledge({ client: agenta.client, set });
  set.articles[0] = { ...set.articles[0], title: 'A new title', body: `${set.articles[0].body}\nMore.` };
  const result = await syncKnowledge({ client: agenta.client, set });
  assert.deepEqual([result.created, result.updated], [0, 1]);
  assert.equal(agenta.db.articles.length, set.articles.length);
  assert.equal(agenta.db.articles.find((a) => a.id === result.ids[set.articles[0].stem]).title, 'A new title');
});

test('hand-added articles keep their ids, SKU and source link; the tenant is not reset', async () => {
  const set = loadSet();
  const [first] = set.articles;
  const agenta = fakeAgenta({
    tenants: [{ id: 'abc123', name: 'Meeteor', inferenceMode: 'local_first' }],
    articles: [
      {
        id: 'hand-1', tenantId: 'abc123', title: first.title, product: 'Meeteor', version: '2.1.0', body: 'old',
        published: true, tags: [], sku: 'SKU-1', sourceUrl: 'https://example.com/help',
      },
      { id: 'old-1', tenantId: 'abc123', title: 'Retired page', product: 'Meeteor', published: true },
      { id: 'other-1', tenantId: 'someone-else', title: first.title, product: 'Meeteor', published: true },
    ],
  });
  const result = await syncKnowledge({ client: agenta.client, set });
  assert.equal(result.tenantId, 'abc123');
  assert.equal(agenta.calls.some((call) => call.route === '/api/lineup/tenants'), false);
  assert.equal(result.ids[first.stem], 'hand-1');
  const saved = agenta.db.articles.find((a) => a.id === 'hand-1');
  assert.deepEqual([saved.sku, saved.sourceUrl, saved.body], ['SKU-1', 'https://example.com/help', first.body]);
  assert.equal(agenta.db.articles.filter((a) => a.tenantId === 'abc123' && a.title === first.title).length, 1);
  assert.deepEqual(result.stale, ['Retired page']);
  assert.equal(agenta.db.articles.find((a) => a.id === 'other-1').body, undefined);
});

test('an ambiguous title match stops the sync before any article is written', async () => {
  const set = loadSet();
  const title = set.articles.at(-1).title;
  const copy = { tenantId: 'meeteor', title, product: 'Meeteor', published: true };
  const agenta = fakeAgenta({
    tenants: [{ id: 'meeteor', name: 'Meeteor' }],
    articles: [{ ...copy, id: 'a' }, { ...copy, id: 'b' }],
  });
  await assert.rejects(syncKnowledge({ client: agenta.client, set }), /2 tenant articles are titled/);
  assert.equal(writes(agenta.calls).length, 0);
});

test('--apply passes only when every reply cites the expected article, and keeps the key off public routes', async () => {
  const set = loadSet();
  const expected = new Map(set.manifest.answerChecks.map((c) => [c.question, `meeteor-${c.expectArticle}`]));
  const good = fakeAgenta({ cite: (question) => [expected.get(question)] });
  const lines = [];
  const log = (line) => lines.push(line);
  assert.equal(await main(['--apply'], { env: ENV, fetchFn: good.fetchFn, log }), 0);
  assert.match(lines.at(-1), new RegExp(`${expected.size}/${expected.size} passed`));
  for (const call of good.calls) {
    assert.equal(call.headers['X-Agenta-Admin-Key'], call.route.startsWith('/api/public/') ? undefined : KEY);
    assert.equal(call.redirect, 'error');
  }
  assert.equal(lines.join('\n').includes(KEY), false);

  const bad = fakeAgenta({ cite: () => ['meeteor-getting-started'] });
  assert.equal(await main(['--apply'], { env: ENV, fetchFn: bad.fetchFn, log }), 1);
  const synced = await syncKnowledge({ client: bad.client, set });
  const checks = await checkAnswers({ client: bad.client, set, tenantId: synced.tenantId, ids: synced.ids });
  assert.deepEqual(checks.filter((c) => c.ok).map((c) => c.expectArticle), ['getting-started']);
});

test('--apply is refused without a URL and key, and never sends the key over remote http', async () => {
  const log = () => {};
  assert.equal(await main(['--apply'], { env: {}, fetchFn: noNetwork, log }), 2);
  assert.equal(await main(['--aply'], { env: ENV, fetchFn: noNetwork, log }), 2);
  const env = { ...ENV, AGENTA_URL: 'http://sulenna.example.com' };
  await assert.rejects(main(['--apply'], { env, fetchFn: noNetwork, log }), /must be https/);
});

test('a rejected request reports the route and status', async () => {
  const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Sign in to continue.' }) });
  await assert.rejects(main(['--apply'], { env: ENV, fetchFn, log: () => {} }), /workspace failed \(401\): Sign in/);
});

test('bad tenant settings, a bad article or a failing offline answer check fail the dry run', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const folder of ['config', path.join('docs', 'kb')]) {
    fs.cpSync(path.join(ROOT, folder), path.join(root, folder), { recursive: true });
  }
  const edit = (file, change) => {
    const target = path.join(root, file);
    fs.writeFileSync(target, change(fs.readFileSync(target, 'utf8')));
  };
  edit('config/tenant.sulenna.json', (text) => text.replace('"automated_only"', '"staffed"'));
  edit('config/sulenna-sync.json', (text) => text.replace('"getting-started" }', '"history" }'));
  fs.writeFileSync(path.join(root, 'docs', 'kb', 'broken.md'), 'no front matter');

  const lines = [];
  assert.equal(await main([], { root, env: {}, fetchFn: noNetwork, log: (line) => lines.push(line) }), 1);
  const output = lines.join('\n');
  assert.match(output, /supportMode must be automated_only/);
  assert.match(output, /broken: missing front matter/);
  assert.match(output, /expects history, ranked first: getting-started/);
});
