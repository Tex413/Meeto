#!/usr/bin/env node
// Mint a Meetintel desktop license key (Ed25519). Run on the OWNER's machine /
// checkout backend only — needs the PRIVATE key in keys/license-private.pem.
//
//   node tools/sign-license.js <plan> [email] [updatesDays]
//   node tools/sign-license.js lifetime jane@acme.com 365
//
// The matching PUBLIC key is embedded in server.js (LICENSE_PUBLIC_KEY); the
// app verifies offline. NEVER ship or commit the private key.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const privPath = path.join(__dirname, '..', 'keys', 'license-private.pem');
if (!fs.existsSync(privPath)) {
  console.error('Missing keys/license-private.pem — generate a keypair first.');
  process.exit(1);
}
const priv = fs.readFileSync(privPath, 'utf8');

const plan = process.argv[2] || 'lifetime';
const email = process.argv[3] || '';
const updatesDays = parseInt(process.argv[4] || '365', 10);

const payload = {
  plan,
  email,
  purchasedAt: new Date().toISOString(),
  updatesUntil: new Date(Date.now() + updatesDays * 86400000).toISOString()
};
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.sign(null, Buffer.from(payloadB64), crypto.createPrivateKey(priv)).toString('base64url');
console.log('MEETINTEL2-' + payloadB64 + '.' + sig);
