'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const markdownIn = (dir) => fs.readdirSync(path.join(ROOT, dir))
  .filter((name) => name.endsWith('.md'))
  .map((name) => `${dir}/${name}`);

// Identifiers and addresses that stay until a later step; docs/old-names.md explains each one.
const KEPT = [
  /meetintel\.io/g,
  /meetintel\.(?:sqlite|log)/g,
  /meetintel_(?:sid|net)/g,
  /meetintel-(?:dev-secret|cloudflared|inline-script-fragility)/g,
  /MEETINTEL2?-(?=\(|\$|<|' \+)/g,
  /meeto-v1:/g,
  /MEETO_BASE_URL/g,
];
const OLD_NAME = /meet[ _-]?intel|meeto|meeteor/i;

// Everything a person reads: pages, emails and messages in server code, and customer documents.
const SEEN_BY_PEOPLE = [
  ...fs.readdirSync(ROOT).filter((name) => name.endsWith('.html')),
  'main.js',
  'server.js',
  'inference-worker.js',
  'docs/admin-guide.md',
  'docs/feature-inventory.md',
  ...markdownIn('docs/kb'),
  ...markdownIn('docs/user-manual'),
];

// Exceptions allowed in one file only: the real Compose service name, the pinned desktop data
// folder, and an internal multipart boundary that is never displayed.
const KEPT_BY_FILE = {
  'docs/admin-guide.md': [/`meetintel`/g],
  'main.js': [/'meetintel'\)/g],
  'server.js': [/'meetintel-' \+ Date\.now\(\)/g],
};

for (const file of SEEN_BY_PEOPLE) {
  test(`${file} shows no old product name`, () => {
    const patterns = [...KEPT, ...(KEPT_BY_FILE[file] || [])];
    const leftovers = read(file)
      .split(/\r?\n/)
      .map((line, index) => ({ line: index + 1, text: patterns.reduce((s, p) => s.replace(p, ''), line) }))
      .filter(({ text }) => OLD_NAME.test(text))
      .map(({ line, text }) => `${line}: ${text.trim().slice(0, 120)}`);
    assert.deepEqual(leftovers, []);
  });
}

test('MCP tool descriptions and messages use the new name', () => {
  const source = read('mcp-server.js');
  assert.doesNotMatch(source, /\bMeeto\b/);
  assert.match(source, /Verbatimely recording started\./);
});

test('app name changes while package, service and data names stay', () => {
  const pkg = require(path.join(ROOT, 'package.json'));
  assert.equal(pkg.build.productName, 'Verbatimely');
  assert.equal(pkg.author, 'Verbatimely');
  assert.equal(pkg.name, 'meetintel');
  assert.equal(pkg.build.appId, 'io.meetintel.desktop');
  assert.match(read('docker-compose.yml'), /^ {2}meetintel:\r?\n {4}build: \.\r?\n {4}container_name: meetintel\r?$/m);
  assert.match(read('server.js'), /path\.join\(DATA_DIR, 'meetintel\.sqlite'\)/);
  assert.match(read('mcp-server.js'), /new McpServer\(\{ name: 'meeto'/);
});

test('desktop app keeps its existing data folder under the new app name', () => {
  const appData = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming');
  const paths = { appData, userData: path.join(appData, 'Verbatimely') };
  const created = [];
  const env = {};
  const electron = {
    app: {
      isPackaged: true,
      getPath: (name) => paths[name],
      setPath: (name, value) => {
        assert.ok(created.includes(value), 'setPath needs an existing folder');
        paths[name] = value;
      },
      whenReady: () => new Promise(() => {}),
      on: () => {},
    },
  };
  const fakes = {
    electron,
    path,
    fs: { mkdirSync: (dir) => created.push(dir) },
    child_process: { execSync: () => '' },
    './server': { serverReady: Promise.resolve() },
  };

  vm.runInNewContext(read('main.js'), { require: (name) => fakes[name], process: { env } });

  assert.equal(paths.userData, path.join(appData, 'meetintel'));
  assert.equal(env.DATA_DIR, path.join(appData, 'meetintel', 'data'));
});
