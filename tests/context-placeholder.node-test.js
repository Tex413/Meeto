'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const GENERIC_PLACEHOLDER = 'e.g. The goal of this meeting, project background, systems involved, '
  + 'roles of the people attending, open questions, and terms or acronyms to know...';

// Every user sees this text, so any change to it is deliberate: no names, companies or client figures.
test('the Context placeholder is the generic text', () => {
  const match = PAGE.match(/<textarea id="ctx" placeholder="([^"]*)"/);
  assert.ok(match, 'Context textarea not found in index.html');
  assert.equal(match[1], GENERIC_PLACEHOLDER);
});
