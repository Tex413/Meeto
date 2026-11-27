'use strict';

// Loads docs/kb into the Meeteor tenant in Sulenna (Agenta) and checks that its answers cite the expected articles.
// Dry run (default, no network):  node scripts/kb-sync.js
// Load, then check answers:       AGENTA_URL=... AGENTA_ADMIN_KEY=... node scripts/kb-sync.js --apply
// Safe to re-run: existing tenant and article ids are looked up first, and unchanged articles are not written.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SYNC_FILE = 'config/sulenna-sync.json';
const REQUEST_TIMEOUT_MS = 15000;
// Agenta's ingest limits and retrieval rules (its src/Agenta/Domain.cs and Inference.cs).
const MAX_TITLE = 150;
const MAX_BODY = 16000;
const MAX_TAGS = 10;
const TAG_PATTERN = /^[A-Za-z0-9 _-]{1,40}$/;
const RETRIEVE_LIMIT = 4;
const STOP_WORDS = new Set([
  'the', 'and', 'this', 'that', 'with', 'have', 'for', 'can', 'you', 'please', 'help', 'what', 'how', 'not', 'does',
  'when', 'from',
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseArticle(stem, raw) {
  const body = raw.replace(/\r\n/g, '\n').trim();
  const front = /^---\n([\s\S]*?)\n---\n/.exec(body);
  if (!front) throw new Error(`${stem}: missing front matter`);
  const field = (name) => (new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(front[1]) || [])[1]?.trim() || '';
  const tags = field('tags').replace(/^\[|\]$/g, '').split(',').map((tag) => tag.trim()).filter(Boolean);
  // The whole file is the article body: its front matter carries applies_to.
  return { stem, title: field('title'), product: field('product'), version: field('version'), tags, body };
}

function validateArticle(article, manifest) {
  const errors = [];
  const { stem, title, product, version, tags, body } = article;
  if (!title || title.length > MAX_TITLE) errors.push(`${stem}: title must be 1-${MAX_TITLE} characters`);
  if (product !== manifest.product) errors.push(`${stem}: product must be ${manifest.product}`);
  if (version !== manifest.version) errors.push(`${stem}: version must be ${manifest.version}`);
  if (body.length > MAX_BODY) errors.push(`${stem}: body is over ${MAX_BODY} characters`);
  if (tags.length > MAX_TAGS || !tags.every((tag) => TAG_PATTERN.test(tag))
    || new Set(tags.map((tag) => tag.toLowerCase())).size !== tags.length) {
    errors.push(`${stem}: use up to ${MAX_TAGS} different tags of 1-40 letters, digits, spaces, - or _`);
  }
  return errors;
}

function validateTenant(tenant) {
  const errors = [];
  const filled = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;
  if (!/^[a-z0-9_-]{1,50}$/.test(tenant.id || '')) errors.push('tenant id must be 1-50 of a-z, 0-9, - or _');
  if (!filled(tenant.name, 100)) errors.push('tenant name is required');
  if (!/^https:\/\/[^/@\s]+/.test(tenant.website || '')) errors.push('tenant website must be an https URL');
  if (tenant.supportMode !== 'automated_only') errors.push('tenant supportMode must be automated_only');
  if (!['demo', 'local_first'].includes(tenant.inferenceMode)) {
    errors.push('tenant inferenceMode must be demo or local_first');
  }
  if (typeof tenant.responseExpectation !== 'string' || tenant.responseExpectation.length > 300) {
    errors.push('tenant responseExpectation must be text of up to 300 characters');
  }
  const brand = tenant.branding || {};
  for (const [name, max] of [['agentName', 50], ['welcomeMessage', 500], ['launcherText', 50]]) {
    if (!filled(brand[name], max)) errors.push(`tenant branding.${name} must be 1-${max} characters`);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(brand.accentColor || '')) errors.push('tenant branding.accentColor must be #RRGGBB');
  if (!/^(https:\/\/.+)?$/.test(brand.avatarUrl ?? '-')) errors.push('tenant branding.avatarUrl must be empty or https');
  if (!['left', 'right'].includes(brand.widgetPosition)) {
    errors.push('tenant branding.widgetPosition must be left or right');
  }
  const questions = brand.suggestedQuestions;
  if (!Array.isArray(questions) || questions.length > 5 || !questions.every((question) => filled(question, 160))) {
    errors.push('tenant branding.suggestedQuestions must be up to 5 questions');
  }
  return errors;
}

const words = (text) => new Set((text.toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((word) => word.length > 2 && !STOP_WORDS.has(word)));

// Offline estimate of Agenta's retrieval: shared distinct words, ties by article id. It does not model the
// topic-tag bonus or the policy guard, so only the --apply answer checks prove what a tenant cites.
function rankArticles(articles, question, tenantId) {
  const terms = words(question);
  return articles
    .map((article) => ({
      stem: article.stem,
      id: articleId(tenantId, article.stem),
      score: [...words(`${article.title} ${article.body}`)].filter((word) => terms.has(word)).length,
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, RETRIEVE_LIMIT)
    .map((hit) => hit.stem);
}

const articleId = (tenantId, stem) => `${tenantId}-${stem}`;

function loadSet(root = ROOT) {
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const manifest = readJson(SYNC_FILE);
  const tenant = readJson(manifest.tenantFile);
  const errors = validateTenant(tenant);
  const excluded = new Set(manifest.exclude);
  const directory = path.join(root, manifest.articleDir);
  const articles = [];
  for (const file of fs.readdirSync(directory).sort()) {
    if (!file.endsWith('.md') || excluded.has(file)) continue;
    try {
      const article = parseArticle(file.slice(0, -3), fs.readFileSync(path.join(directory, file), 'utf8'));
      errors.push(...validateArticle(article, manifest));
      articles.push(article);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (!articles.length) errors.push(`no articles found in ${manifest.articleDir}`);
  const titles = articles.map((article) => article.title.toLowerCase());
  if (new Set(titles).size !== titles.length) errors.push('article titles must be unique');
  if (!manifest.answerChecks?.length) errors.push('the sync file has no answer checks');
  // A demo-mode tenant cites only the first retrieved article, so each expected article must rank first.
  for (const check of manifest.answerChecks || []) {
    const [first] = rankArticles(articles, check.question, tenant.id);
    if (first !== check.expectArticle) {
      errors.push(`answer check "${check.question}" expects ${check.expectArticle}, ranked first: ${first || 'none'}`);
    }
  }
  return { manifest, tenant, articles, errors };
}

function createClient({ baseUrl, adminKey, fetchFn = fetch }) {
  const url = new URL(baseUrl);
  // The admin key must never cross a network in clear text.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error('AGENTA_URL must be https, or http on this computer');
  }
  const base = url.href.replace(/\/+$/, '');

  async function request(route, { body, headers = {}, admin = false } = {}) {
    let response;
    try {
      response = await fetchFn(base + route, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(admin ? { 'X-Agenta-Admin-Key': adminKey } : {}), ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new Error(`Sulenna ${route} could not be reached: ${error.message}`);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const hint = response.status === 429 ? ' (rate limit: wait a minute and run again)' : '';
      throw new Error(`Sulenna ${route} failed (${response.status}): ${data?.error || 'no detail'}${hint}`);
    }
    if (!data) throw new Error(`Sulenna ${route} returned no JSON`);
    return data;
  }
  return { request };
}

// An existing tenant keeps whatever provider and branding were tuned in Sulenna; settings only create a missing one.
function findTenant(workspace, settings) {
  const tenants = (workspace.tenants || []).map((entry) => entry.tenant);
  const byId = tenants.find((tenant) => tenant.id === settings.id);
  if (byId) return byId;
  const byName = tenants.filter((tenant) => tenant.name.toLowerCase() === settings.name.toLowerCase());
  if (byName.length > 1) throw new Error(`more than one tenant is named ${settings.name}; keep one before syncing`);
  return byName[0] || null;
}

// Matches each file to the tenant article it should update: first by the id this script gives it, then by
// title for articles added by hand. Throws before any write when the match is ambiguous.
function matchArticles(articles, existing, tenantId, product) {
  return articles.map((article) => {
    const byId = existing.find((item) => item.id === articleId(tenantId, article.stem));
    if (byId) return { article, current: byId };
    const sameTitle = existing.filter((item) => item.title.toLowerCase() === article.title.toLowerCase()
      && (!item.product || item.product === product));
    const published = sameTitle.filter((item) => item.published);
    const candidates = published.length ? published : sameTitle;
    if (candidates.length > 1) {
      throw new Error(`${article.stem}: ${candidates.length} tenant articles are titled "${article.title}"; `
        + 'unpublish the extras before syncing');
    }
    return { article, current: candidates[0] || null };
  });
}

function isUnchanged(current, wanted) {
  return ['title', 'product', 'version', 'body', 'published'].every((name) => current[name] === wanted[name])
    && JSON.stringify(current.tags || []) === JSON.stringify(wanted.tags);
}

async function syncKnowledge({ client, set }) {
  const { manifest, tenant: settings, articles } = set;
  const workspace = await client.request('/api/admin/workspace', { admin: true });
  let tenant = findTenant(workspace, settings);
  const tenantCreated = !tenant;
  if (!tenant) tenant = await client.request('/api/lineup/tenants', { admin: true, body: settings });

  const existing = (workspace.articles || []).filter((item) => item.tenantId === tenant.id);
  const matches = matchArticles(articles, existing, tenant.id, manifest.product);
  const result = { tenantId: tenant.id, tenantCreated, created: 0, updated: 0, unchanged: 0, ids: {}, stale: [] };
  for (const { article, current } of matches) {
    const { title, tags, body } = article;
    const wanted = { title, product: manifest.product, version: manifest.version, body, tags, published: true };
    const id = current ? current.id : articleId(tenant.id, article.stem);
    result.ids[article.stem] = id;
    if (!current) {
      // Only the lineup route lets a new article have a chosen id, so a later title change still updates it.
      const { product, version, ...item } = wanted;
      await client.request('/api/lineup/docs', {
        admin: true,
        body: { tenantId: tenant.id, product, version, articles: [{ id, sourceUrl: '', ...item }] },
      });
      result.created += 1;
    } else if (isUnchanged(current, wanted)) {
      result.unchanged += 1;
    } else {
      // The admin route keeps the source link and SKU an operator set on the article.
      await client.request('/api/admin/articles', { admin: true, body: { ...current, ...wanted } });
      result.updated += 1;
    }
  }
  const matched = new Set(Object.values(result.ids));
  result.stale = existing
    .filter((item) => item.published && item.product === manifest.product && !matched.has(item.id))
    .map((item) => item.title);
  return result;
}

// Asks each question as a customer would (no admin key) and reads which articles the reply cites.
async function checkAnswers({ client, set, tenantId, ids }) {
  const { product, version, answerChecks } = set.manifest;
  const cases = `/api/public/${encodeURIComponent(tenantId)}/cases`;
  const results = [];
  for (const { question, expectArticle } of answerChecks) {
    const opened = await client.request(cases, { body: { product, version } });
    const headers = { 'X-Case-Token': opened.token };
    const route = `${cases}/${encodeURIComponent(opened.id)}`;
    await client.request(`${route}/messages`, { headers, body: { text: question, intent: 'message' } });
    const reply = ((await client.request(route, { headers })).messages || []).filter((m) => m.role === 'assistant').pop();
    const cited = reply?.sources || [];
    const stems = cited.map((id) => Object.keys(ids).find((stem) => ids[stem] === id) || id);
    results.push({ question, expectArticle, cited: stems, ok: cited.includes(ids[expectArticle]) });
  }
  return results;
}

async function main(argv = process.argv.slice(2), { env = process.env, fetchFn, log = console.log, root } = {}) {
  const unknown = argv.filter((arg) => arg !== '--apply' && arg !== '--dry-run');
  if (unknown.length || (argv.includes('--apply') && argv.includes('--dry-run'))) {
    log('ERROR: use either --dry-run (default) or --apply');
    return 2;
  }
  const set = loadSet(root);
  log(`Loaded ${set.articles.length} articles for ${set.manifest.product} ${set.manifest.version}.`);
  if (set.errors.length) {
    for (const error of set.errors) log(`ERROR: ${error}`);
    return 1;
  }
  if (!argv.includes('--apply')) {
    for (const article of set.articles) log(`  ${article.stem}: ${article.title}`);
    log(`Dry run passed (${set.manifest.answerChecks.length} offline answer checks); no server was contacted.`);
    return 0;
  }
  if (!env.AGENTA_URL || !env.AGENTA_ADMIN_KEY) {
    log('ERROR: --apply needs AGENTA_URL and AGENTA_ADMIN_KEY in the environment');
    return 2;
  }
  const client = createClient({ baseUrl: env.AGENTA_URL, adminKey: env.AGENTA_ADMIN_KEY, fetchFn });
  const synced = await syncKnowledge({ client, set });
  log(`Tenant ${synced.tenantId} (${synced.tenantCreated ? 'created' : 'existing'}): `
    + `${synced.created} created, ${synced.updated} updated, ${synced.unchanged} unchanged.`);
  for (const title of synced.stale) log(`WARNING: published in the tenant but not in docs/kb: ${title}`);
  const checks = await checkAnswers({ client, set, tenantId: synced.tenantId, ids: synced.ids });
  for (const check of checks) {
    log(`${check.ok ? 'PASS' : 'FAIL'} "${check.question}" cited ${check.cited.join(', ') || 'nothing'}`
      + (check.ok ? '' : `, expected ${check.expectArticle}`));
  }
  const passed = checks.filter((check) => check.ok).length;
  log(`Answer checks: ${passed}/${checks.length} passed.`);
  return passed === checks.length ? 0 : 1;
}

if (require.main === module) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

module.exports = { loadSet, createClient, syncKnowledge, checkAnswers, main };
