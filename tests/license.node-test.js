'use strict';

// Runs the real server.js with a synthetic keypair and a fake Stripe. The preload swaps the
// embedded public key only inside these child processes; the product has no such override.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createLicensing } = require('../license');

const SERVER = path.join(__dirname, '..', 'server.js');
const pemOptions = {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
};
const pair = crypto.generateKeyPairSync('ed25519', pemOptions);
const otherPair = crypto.generateKeyPairSync('ed25519', pemOptions);

const paid = {
  payment_status: 'paid',
  status: 'complete',
  mode: 'payment',
  created: 1795000000,
  metadata: { product: 'meetintel' },
  customer_details: { email: 'buyer@example.com' },
};
const SESSIONS = {
  cs_paid: paid,
  cs_annual: { ...paid, mode: 'subscription' },
  cs_unpaid: { ...paid, payment_status: 'unpaid' },
  cs_open: { ...paid, payment_status: 'unpaid', status: 'open' },
  cs_foreign: { ...paid, metadata: {} },
};

const PRELOAD = `
const crypto = require('crypto');
const Module = require('module');
const sessions = ${JSON.stringify(SESSIONS)};
const realCreatePublicKey = crypto.createPublicKey;
crypto.createPublicKey = input => realCreatePublicKey(
  typeof input === 'string' && input.includes('BEGIN PUBLIC KEY') ? process.env.TEST_PUBLIC_PEM : input);
// Keep the inference worker from loading or downloading models.
require('worker_threads').Worker = class extends require('events') { postMessage() {} };
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request !== 'stripe') return load.call(this, request, ...rest);
  return () => ({ checkout: { sessions: {
    retrieve: async id => { if (!sessions[id]) throw new Error('No such session'); return sessions[id]; },
    create: async () => ({ url: 'https://checkout.invalid/session' }),
  } } });
};
`;

function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(t, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeteor-license-'));
  // .cjs: a "type": "module" package.json above the temp directory must not change how this loads.
  const preload = path.join(dir, 'preload.cjs');
  fs.writeFileSync(preload, PRELOAD);
  fs.writeFileSync(path.join(dir, '.env'), 'STRIPE_SECRET_KEY=fake\n');
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, TEST_PUBLIC_PEM: pair.publicKey };
  delete env.DESKTOP_MODE;
  delete env.DESKTOP_DEV;
  delete env.MEETEOR_LICENSE_SIGNING_PEM;
  delete env.MEETEOR_ADMIN_EMAIL;
  const child = spawn(process.execPath, ['-r', preload, SERVER], { env: { ...env, ...extraEnv } });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => {
    child.kill();
    await exited;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 20000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('running at')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (url, { body, cookie } = {}) => {
    const res = await fetch(base + url, {
      method: body ? 'POST' : 'GET',
      headers: cookie ? { cookie } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    return { status: res.status, text: await res.text(), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  return { request, output: () => output };
}

async function successKey(server, sessionId) {
  const res = await server.request(`/checkout/success?session_id=${sessionId}`);
  assert.equal(res.status, 200);
  return res.text.match(/<span id="keyText">(.*?)<\/span>/)[1];
}

const signingEnv = { MEETEOR_LICENSE_SIGNING_PEM: pair.privateKey };

test('a paid checkout key activates the desktop app', async t => {
  const web = await startServer(t, signingEnv);
  const desktop = await startServer(t, { DESKTOP_MODE: '1' });
  for (const [id, plan] of [['cs_paid', 'lifetime'], ['cs_annual', 'annual']]) {
    const key = await successKey(web, id);
    assert.match(key, /^MEETINTEL2-/);
    const res = await desktop.request('/license/activate', { body: { key } });
    assert.equal(res.status, 200, res.text);
    assert.equal(JSON.parse(res.text).plan, plan);
    const status = JSON.parse((await desktop.request('/license/status')).text);
    assert.equal(status.licensed, true);
    assert.equal(status.email, 'buyer@example.com');
  }
});

test('reloading the success page returns the same key', async t => {
  const web = await startServer(t, signingEnv);
  const first = await successKey(web, 'cs_paid');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await successKey(web, 'cs_paid'), first);
  const payload = createLicensing({ publicKey: pair.publicKey, env: {} }).verify(first);
  assert.equal(payload.purchasedAt, new Date(paid.created * 1000).toISOString());
});

test('unpaid, foreign and unknown sessions get no key', async t => {
  const web = await startServer(t, signingEnv);
  for (const id of ['cs_unpaid', 'cs_open', 'cs_foreign', 'cs_missing']) {
    assert.equal(await successKey(web, id), '', id);
  }
});

test('without a matching signing key nothing is issued and checkout takes no payment', async t => {
  for (const extraEnv of [{}, { MEETEOR_LICENSE_SIGNING_PEM: otherPair.privateKey }]) {
    const web = await startServer(t, extraEnv);
    assert.equal(await successKey(web, 'cs_paid'), '');
    const res = await web.request('/checkout/create', { body: { plan: 'lifetime' } });
    assert.equal(res.status, 503);
    assert.ok(!web.output().includes('PRIVATE KEY'));
  }
});

test('a signing PEM with escaped newlines works and checkout opens', async t => {
  const web = await startServer(t, { MEETEOR_LICENSE_SIGNING_PEM: pair.privateKey.replace(/\n/g, '\\n') });
  assert.match(await successKey(web, 'cs_paid'), /^MEETINTEL2-/);
  assert.equal((await web.request('/checkout/create', { body: { plan: 'annual' } })).status, 200);
});

test('only the configured admin can mint licences, and the keys verify', async t => {
  const web = await startServer(t, { ...signingEnv, MEETEOR_ADMIN_EMAIL: 'Admin@example.com' });
  const register = async email =>
    (await web.request('/auth/register', { body: { email, password: 'synthetic-pass' } })).cookie;
  const admin = await register('admin@example.com');
  const user = await register('user@example.com');

  for (const url of ['/admin/generate-key', '/admin/grant-license', '/admin/reset-password']) {
    const res = await web.request(url, { cookie: user, body: { targetUserId: 2, newPassword: 'changed-pass' } });
    assert.equal(res.status, 403, url);
  }
  assert.equal((await web.request('/admin/reset-links', { cookie: user })).status, 403);

  const generated = JSON.parse((await web.request('/admin/generate-key', { cookie: admin, body: { type: 'annual' } })).text);
  const checked = JSON.parse((await web.request('/admin/verify-key', { cookie: admin, body: { key: generated.key } })).text);
  assert.equal(checked.valid, true);
  assert.equal(checked.plan, 'annual');

  const granted = JSON.parse((await web.request('/admin/grant-license',
    { cookie: admin, body: { targetUserId: 2, licenseType: 'lifetime' } })).text);
  assert.match(granted.key, /^MEETINTEL2-/);
  const missing = await web.request('/admin/grant-license', { cookie: admin, body: { targetUserId: 999 } });
  assert.equal(missing.status, 404);

  const redeemed = await web.request('/license/activate', { cookie: user, body: { key: generated.key } });
  assert.deepEqual(JSON.parse(redeemed.text), { ok: true, type: 'annual' });
});

test('admin routes are closed when no admin is configured', async t => {
  const web = await startServer(t, signingEnv);
  const { cookie } = await web.request('/auth/register',
    { body: { email: 'user@example.com', password: 'synthetic-pass' } });
  assert.equal((await web.request('/admin/generate-key', { cookie, body: { type: 'lifetime' } })).status, 403);
});
