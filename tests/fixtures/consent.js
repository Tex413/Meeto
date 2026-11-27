'use strict';

const assert = require('node:assert/strict');

// Records consent the way the page does: preview the announcement, then grant against it.
async function grantBody(server, meetingId, modes, { headers = {}, overrides = {} } = {}) {
  const preview = await server.send('GET', `/consent/preview?meetingId=${meetingId}&modes=${modes.join(',')}`,
    { headers });
  return {
    meetingId, modes, wordingVersion: preview.body.wordingVersion, destinationKey: preview.body.destination?.key,
    confirmer: 'Test Host', announcedBy: 'speech', announcementRecorded: modes.includes('recording'),
    everyoneAgreed: true, ...overrides,
  };
}

async function grantConsent(server, meetingId, modes, { headers = {} } = {}) {
  const body = await grantBody(server, meetingId, modes, { headers });
  const res = await server.send('POST', '/consent/grant', {
    headers: { ...headers, 'content-type': 'application/json' }, body,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.consentId;
}

module.exports = { grantBody, grantConsent };
