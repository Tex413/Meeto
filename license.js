'use strict';

// Ed25519 desktop licences (offline-verifiable). Format:
//   MEETINTEL2-<payloadB64url>.<ed25519SigB64url>
const crypto = require('crypto');

// SecretsBoss delivers the private signing PEM to the fulfilment server under this name.
const SIGNING_ENV_NAME = 'MEETEOR_LICENSE_SIGNING_PEM';
const CHECKOUT_PRODUCT = 'meetintel';
const UPDATE_DAYS = 365;

function createLicensing({ publicKey, env = process.env }) {
  const verifier = crypto.createPublicKey(publicKey);

  function verify(key) {
    try {
      const m = (key || '').trim().match(/^MEETINTEL2-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
      if (!m) return null;
      const [, payloadB64, sigB64] = m;
      const ok = crypto.verify(null, Buffer.from(payloadB64), verifier, Buffer.from(sigB64, 'base64url'));
      if (!ok) return null;
      return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch (_) {
      return null; // a malformed key is simply not a licence
    }
  }

  // Error messages must never carry the PEM.
  function signingKey() {
    const pem = env[SIGNING_ENV_NAME];
    if (!pem) throw new Error(`License signing unavailable: ${SIGNING_ENV_NAME} is not set`);
    let privateKey;
    try {
      privateKey = crypto.createPrivateKey(pem.replace(/\\n/g, '\n'));
    } catch (_) {
      throw new Error(`License signing unavailable: ${SIGNING_ENV_NAME} is not a readable private key`);
    }
    // A key from another pair would sign licences that the desktop app rejects.
    if (!crypto.createPublicKey(privateKey).equals(verifier)) {
      throw new Error(`License signing unavailable: ${SIGNING_ENV_NAME} does not match the app's public key`);
    }
    return privateKey;
  }

  function signingReady() {
    try {
      signingKey();
      return true;
    } catch (_) {
      return false; // callers only need yes or no; issue() reports the reason
    }
  }

  function issue({ plan, email = '', purchasedAt = new Date() }) {
    const privateKey = signingKey();
    const payload = {
      plan,
      email,
      purchasedAt: purchasedAt.toISOString(),
      updatesUntil: new Date(purchasedAt.getTime() + UPDATE_DAYS * 86400000).toISOString(),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign(null, Buffer.from(payloadB64), privateKey).toString('base64url');
    return `MEETINTEL2-${payloadB64}.${sig}`;
  }

  // Returns null unless the session is a paid Meetintel checkout. Everything signed comes from
  // the session and Ed25519 is deterministic, so a reload returns the same key without storing it.
  function issueForCheckout(session) {
    if (session?.payment_status !== 'paid' || session.metadata?.product !== CHECKOUT_PRODUCT) return null;
    const plan = session.mode === 'subscription' ? 'annual' : 'lifetime';
    const key = issue({
      plan,
      email: session.customer_details?.email || '',
      purchasedAt: new Date(session.created * 1000),
    });
    return { key, plan };
  }

  return { verify, signingReady, issue, issueForCheckout };
}

module.exports = { createLicensing, CHECKOUT_PRODUCT };
