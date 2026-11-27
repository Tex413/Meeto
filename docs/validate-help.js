'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DOCS = __dirname;
const KB = path.join(DOCS, 'kb');
const INDEX = path.join(KB, 'README.md');
const VERSION = '2.1.0';
const MAX_TITLE = 150;
const MAX_BODY = 16000;
const MAX_TAGS = 10;
const MAX_TAG = 40;
const failures = [];
const articles = fs.existsSync(KB)
  ? fs.readdirSync(KB).filter((name) => name.endsWith('.md') && name !== 'README.md')
  : [];
const index = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : '';

if (articles.length < 1) failures.push('No KB articles found');
if (!index) failures.push('Missing KB index');

for (const name of articles) {
  const body = fs.readFileSync(path.join(KB, name), 'utf8');
  const front = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) {
    failures.push(`${name}: missing front matter`);
    continue;
  }
  for (const field of ['title', 'product', 'version', 'tags', 'applies_to']) {
    if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(front[1])) failures.push(`${name}: missing ${field}`);
  }
  if (!/^product: Meeteor\s*$/m.test(front[1])) failures.push(`${name}: wrong product`);
  if (!new RegExp(`^version: ${VERSION.replace(/\./g, '\\.')}\\s*$`, 'm').test(front[1])) {
    failures.push(`${name}: wrong version`);
  }
  if (!/^## Short answer\s*\r?\n\S/m.test(body)) failures.push(`${name}: missing short answer`);
  if (!/^## Steps\s*\r?\n1\. /m.test(body)) failures.push(`${name}: missing numbered steps`);
  if (!index.includes(`](${name})`)) failures.push(`${name}: missing from index`);

  // Sulenna/Agenta article ingest limits.
  const title = (front[1].match(/^title:\s*(.+?)\s*$/m) || [])[1] || '';
  if (title.length > MAX_TITLE) failures.push(`${name}: title over ${MAX_TITLE} characters`);
  if (body.length > MAX_BODY) failures.push(`${name}: body over ${MAX_BODY} characters`);
  const tags = ((front[1].match(/^tags:\s*\[(.*)\]\s*$/m) || [])[1] || '')
    .split(',').map((tag) => tag.trim()).filter(Boolean);
  if (tags.length < 1 || tags.length > MAX_TAGS || tags.some((tag) => tag.length > MAX_TAG)) {
    failures.push(`${name}: tags must be a [list] of 1-${MAX_TAGS} items, each up to ${MAX_TAG} characters`);
  }
}

// Same-file and cross-file heading anchors must exist.
const slug = (heading) => heading.toLowerCase().replace(/[^\w\- ]/g, '').trim().replace(/ /g, '-');
for (const file of [path.join(DOCS, 'admin-guide.md'), path.join(DOCS, 'user-manual', 'README.md'), INDEX]) {
  if (!fs.existsSync(file)) continue;
  for (const [, target, anchor] of fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)#]*)(?:#([^)]*))?\)/g)) {
    const resolved = target ? path.resolve(path.dirname(file), target) : file;
    if (!fs.existsSync(resolved)) {
      failures.push(`${file}: broken link ${target}`);
      continue;
    }
    if (!anchor) continue;
    const headings = [...fs.readFileSync(resolved, 'utf8').matchAll(/^#{1,6} (.+?)\r?$/gm)].map((m) => slug(m[1]));
    if (!headings.includes(anchor)) failures.push(`${file}: broken anchor #${anchor}`);
  }
}

for (const manual of ['../user-manual/README.md', '../admin-guide.md']) {
  if (!index.includes(`](${manual})`)) failures.push(`Index missing ${manual}`);
}
for (const match of index.matchAll(/\]\(([^)]+\.md)\)/g)) {
  if (!fs.existsSync(path.resolve(KB, match[1]))) failures.push(`Broken index link: ${match[1]}`);
}
for (const file of [path.join(DOCS, 'admin-guide.md'), path.join(DOCS, 'user-manual', 'README.md'),
  ...articles.map((name) => path.join(KB, name))]) {
  if (!fs.existsSync(file)) continue;
  const body = fs.readFileSync(file, 'utf8');
  if (/\b(?:sk_(?:live|test)_|whsec_)[A-Za-z0-9]{8,}\b/.test(body)) failures.push(`${file}: possible key`);
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(body)) failures.push(`${file}: email address`);
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Help validation passed: ${articles.length} articles, manuals, links, and content checks.\n`);
}
