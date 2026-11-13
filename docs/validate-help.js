'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DOCS = __dirname;
const KB = path.join(DOCS, 'kb');
const INDEX = path.join(KB, 'README.md');
const VERSION = '2.1.0';
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
