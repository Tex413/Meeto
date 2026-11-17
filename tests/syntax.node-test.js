'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCES = [
  'server.js',
  'main.js',
  'preload.js',
  'inference-worker.js',
  'mcp-server.js',
  'scripts/smoke-inference.js',
  'tools/sign-license.js',
];

for (const file of SOURCES) {
  test(`${file} parses`, () => {
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
}

test('package.json declares build, test and verify commands', () => {
  const { scripts } = require(path.join(ROOT, 'package.json'));
  assert.ok(scripts.build);
  assert.ok(scripts.test);
  assert.ok(scripts.verify.includes('build') && scripts.verify.includes('test'));
});
