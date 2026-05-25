const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 7432;
const ENV_FILE = path.join(__dirname, '.env');
const DB_FILE = path.join(__dirname, 'meetings.sqlite');
const DOCS_DIR = path.join(__dirname, 'documents');
const LOG_FILE = path.join(__dirname, 'meeto.log');

function log(...args) {
  const line = new Date().toISOString() + ' ' + args.join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}
process.on('uncaughtException', e => log('UNCAUGHT', e.stack || e.message));
process.on('unhandledRejection', e => log('UNHANDLED', e?.stack || e));

// ── sqlite setup ──────────────────────────────────────────────
const initSqlJs = require('sql.js');
let db = null;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      started_at TEXT,
      ended_at TEXT,
      transcript TEXT,
      word_count INTEGER,
      total_cards INTEGER,
      context_used TEXT,
      todos TEXT
    )
  `);
  // add todos column if upgrading from older db
  try { db.run('ALTER TABLE meetings ADD COLUMN todos TEXT'); } catch(e) {}
  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER,
      captured_at TEXT,
      tag TEXT,
      title TEXT,
      body TEXT,
      transcript_snapshot TEXT,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      file_type TEXT,
      size INTEGER,
      char_count INTEGER,
      chunk_count INTEGER,
      uploaded_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER,
      chunk_index INTEGER,
      text TEXT,
      embedding TEXT,
      FOREIGN KEY(doc_id) REFERENCES documents(id)
    )
  `);
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  saveDb();
  log('Database ready:', DB_FILE);
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// ── session auth ──────────────────────────────────────────────
const sessions = new Map(); // token → expiry ms
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours, sliding

function hashPwd(pwd) {
  return crypto.createHash('sha256').update('meeto-v1:' + pwd).digest('hex');
}
function loadPwdHash() {
  try { const c = fs.readFileSync(ENV_FILE, 'utf8'); const m = c.match(/APP_PWD_HASH=(.+)/); return m ? m[1].trim() : ''; } catch { return ''; }
}
function savePwdHash(h) {
  let c = ''; try { c = fs.readFileSync(ENV_FILE, 'utf8'); } catch(e) {}
  c = /APP_PWD_HASH=/.test(c) ? c.replace(/APP_PWD_HASH=.+/, 'APP_PWD_HASH=' + h) : c.trimEnd() + '\nAPP_PWD_HASH=' + h + '\n';
  fs.writeFileSync(ENV_FILE, c, 'utf8');
}
function makeToken() {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, Date.now() + SESSION_MS);
  return t;
}
function checkToken(req) {
  const m = (req.headers.cookie || '').match(/meeto_sid=([a-f0-9]{64})/);
  const token = m ? m[1] : (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || Date.now() > exp) { sessions.delete(token); return false; }
  sessions.set(token, Date.now() + SESSION_MS); // sliding window
  return true;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `meeto_sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'meeto_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

// ── env helpers ───────────────────────────────────────────────
function loadEnv() {
  try {
    const c = fs.readFileSync(ENV_FILE, 'utf8');
    const m = c.match(/ANTHROPIC_API_KEY\s*=\s*(.+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
function saveEnv(key) {
  fs.writeFileSync(ENV_FILE, `ANTHROPIC_API_KEY=${key}\n`, 'utf8');
}

// ── request helpers ───────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', d => b += d);
    req.on('end', () => res(b));
    req.on('error', rej);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

// ── Whisper transcription ──────────────────────────────────────
let _whisper = null;
let _whisperLoading = false;

async function getWhisper() {
  if (_whisper) return _whisper;
  if (_whisperLoading) {
    await new Promise(resolve => {
      const check = setInterval(() => { if (!_whisperLoading) { clearInterval(check); resolve(); } }, 200);
    });
    return _whisper;
  }
  _whisperLoading = true;
  log('Loading Whisper model (first run downloads ~150 MB)...');
  try {
    const { pipeline } = await import('@xenova/transformers');
    _whisper = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
    log('Whisper model ready.');
  } finally {
    _whisperLoading = false;
  }
  return _whisper;
}

// ── RAG / embeddings ──────────────────────────────────────────
let _embedder = null;
let _embedderLoading = false;

async function getEmbedder() {
  if (_embedder) return _embedder;
  if (_embedderLoading) {
    await new Promise(resolve => {
      const check = setInterval(() => { if (!_embedderLoading) { clearInterval(check); resolve(); } }, 200);
    });
    return _embedder;
  }
  _embedderLoading = true;
  log('Loading embedding model (first run downloads ~80 MB)...');
  try {
    const { pipeline } = await import('@xenova/transformers');
    _embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
    log('Embedding model ready.');
  } finally {
    _embedderLoading = false;
  }
  return _embedder;
}

async function computeEmbedding(text) {
  const embedder = await getEmbedder();
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

function cosineSim(a, b) {
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; ma += a[i]*a[i]; mb += b[i]*b[i]; }
  return (ma && mb) ? dot / (Math.sqrt(ma) * Math.sqrt(mb)) : 0;
}

function chunkText(text, size = 400, overlap = 50) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim()) chunks.push(chunk);
    if (i + size >= words.length) break;
  }
  return chunks;
}

async function extractText(buffer, ext) {
  if (ext === 'txt' || ext === 'md') return buffer.toString('utf8');
  if (ext === 'html' || ext === 'htm') {
    return buffer.toString('utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&#?\w+;/g, ' ')
      .replace(/\s{2,}/g, ' ').trim();
  }
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    return (await pdfParse(buffer)).text;
  }
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer })).value;
  }
  throw new Error('Unsupported type: ' + ext);
}

// ── Microsoft Graph helpers ───────────────────────────────────
const MSFT_TOKENS_FILE = path.join(__dirname, '.msft-tokens.json');

function loadMsftTokens() {
  try { return JSON.parse(fs.readFileSync(MSFT_TOKENS_FILE, 'utf8')); } catch(e) { return null; }
}
function saveMsftTokens(t) { fs.writeFileSync(MSFT_TOKENS_FILE, JSON.stringify(t), 'utf8'); }

function loadMsftClientId() {
  try {
    const c = fs.readFileSync(ENV_FILE, 'utf8');
    const m = c.match(/MSFT_CLIENT_ID\s*=\s*(.+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
function saveMsftClientId(id) {
  let c = '';
  try { c = fs.readFileSync(ENV_FILE, 'utf8'); } catch(e) {}
  if (/MSFT_CLIENT_ID\s*=/.test(c)) {
    c = c.replace(/MSFT_CLIENT_ID\s*=\s*.+/, 'MSFT_CLIENT_ID=' + id);
  } else {
    c = c.trimEnd() + '\nMSFT_CLIENT_ID=' + id + '\n';
  }
  fs.writeFileSync(ENV_FILE, c, 'utf8');
}

function msftFormPost(path, params) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const body = Object.entries(params).map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const opts = {
      hostname: 'login.microsoftonline.com', path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function graphRequest(tokens, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'graph.microsoft.com', path: '/v1.0' + apiPath, method,
      headers: { 'Authorization': 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
const graphGet = (t, p) => graphRequest(t, 'GET', p, null);
const graphPost = (t, p, b) => graphRequest(t, 'POST', p, b);

async function getValidMsftTokens() {
  let tokens = loadMsftTokens();
  if (!tokens) return null;
  const expiresAt = (tokens.acquired_at || 0) + ((tokens.expires_in || 3600) - 300) * 1000;
  if (Date.now() > expiresAt && tokens.refresh_token) {
    try {
      const clientId = loadMsftClientId();
      const refreshed = await msftFormPost('/common/oauth2/v2.0/token', {
        grant_type: 'refresh_token', client_id: clientId,
        refresh_token: tokens.refresh_token, scope: 'Tasks.ReadWrite offline_access'
      });
      if (refreshed.access_token) {
        tokens = { ...refreshed, acquired_at: Date.now() };
        saveMsftTokens(tokens);
      }
    } catch(e) { log('MSFT token refresh error:', e.message); }
  }
  return tokens;
}

// ── Stripe / license helpers ──────────────────────────────────
function loadEnvVar(varName) {
  try { const c = fs.readFileSync(ENV_FILE, 'utf8'); const m = c.match(new RegExp(varName + '\\s*=\\s*(.+)')); return m ? m[1].trim() : ''; } catch { return ''; }
}
function writeEnvVar(varName, value) {
  let c = ''; try { c = fs.readFileSync(ENV_FILE, 'utf8'); } catch(e) {}
  const re = new RegExp(varName + '\\s*=.*');
  c = re.test(c) ? c.replace(re, varName + '=' + value) : c.trimEnd() + '\n' + varName + '=' + value + '\n';
  fs.writeFileSync(ENV_FILE, c, 'utf8');
}
function generateLicenseKey(type) {
  const secret = loadEnvVar('LICENSE_SECRET') || 'meeto-dev-secret';
  const payload = Buffer.from(JSON.stringify({ type, issued: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url').substring(0, 22);
  return `MEETO-${payload}.${sig}`;
}
function verifyLicenseKey(key) {
  try {
    const secret = loadEnvVar('LICENSE_SECRET') || 'meeto-dev-secret';
    const m = key.match(/^MEETO-(.+)\.([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    const [, payload, sig] = m;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url').substring(0, 22);
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch(e) { return null; }
}
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── server ────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // ── public routes (no auth required) ─────────────────────────
  if (req.method === 'GET' && url === '/landing') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8'));
  }

  // ── Checkout + Stripe webhook (public) ───────────────────────
  if (req.method === 'POST' && url === '/checkout/create') {
    const body = JSON.parse(await readBody(req));
    const { plan } = body;
    const stripeKey = loadEnvVar('STRIPE_SECRET_KEY');
    if (!stripeKey) return json(res, 500, { error: 'Stripe not configured' });
    try {
      const Stripe = require('stripe');
      const stripe = Stripe(stripeKey);
      const isAnnual = plan === 'annual';
      const session = await stripe.checkout.sessions.create({
        mode: isAnnual ? 'subscription' : 'payment',
        line_items: [{ price_data: {
          currency: 'usd',
          product_data: { name: isAnnual ? 'Meeto Annual License' : 'Meeto Lifetime License' },
          unit_amount: isAnnual ? 2995 : 11900,
          ...(isAnnual ? { recurring: { interval: 'year' } } : {})
        }, quantity: 1 }],
        success_url: `http://localhost:${PORT}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `http://localhost:${PORT}/checkout/cancel`
      });
      return json(res, 200, { url: session.url });
    } catch(e) { log('Stripe error:', e.message); return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'GET' && url.startsWith('/checkout/success')) {
    const params = new URLSearchParams((req.url.split('?')[1] || ''));
    const sessionId = params.get('session_id') || '';
    const stripeKey = loadEnvVar('STRIPE_SECRET_KEY');
    let licenseKey = '';
    let planType = 'lifetime';
    if (stripeKey && sessionId) {
      try {
        const Stripe = require('stripe');
        const stripe = Stripe(stripeKey);
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid' || session.status === 'complete') {
          planType = session.mode === 'subscription' ? 'annual' : 'lifetime';
          licenseKey = generateLicenseKey(planType);
          log('License generated:', planType, licenseKey.substring(0, 20) + '...');
        }
      } catch(e) { log('Stripe success error:', e.message); }
    }
    const html = fs.readFileSync(path.join(__dirname, 'success.html'), 'utf8')
      .replace('{{LICENSE_KEY}}', licenseKey)
      .replace('{{PLAN_TYPE}}', planType === 'annual' ? 'Annual' : 'Lifetime');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  if (req.method === 'GET' && url === '/checkout/cancel') {
    res.writeHead(302, { 'Location': '/landing#pricing' });
    return res.end();
  }

  if (req.method === 'POST' && url === '/stripe/webhook') {
    const rawBody = await readRawBody(req);
    const webhookSecret = loadEnvVar('STRIPE_WEBHOOK_SECRET');
    const stripeKey = loadEnvVar('STRIPE_SECRET_KEY');
    if (stripeKey && webhookSecret) {
      try {
        const Stripe = require('stripe');
        const stripe = Stripe(stripeKey);
        const sig = req.headers['stripe-signature'];
        const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        log('Stripe webhook event:', event.type);
      } catch(e) { log('Stripe webhook verify error:', e.message); return json(res, 400, { error: e.message }); }
    }
    return json(res, 200, { received: true });
  }

  if (req.method === 'GET' && url === '/auth/status') {
    return json(res, 200, { needsSetup: !loadPwdHash(), authenticated: checkToken(req) });
  }

  if (req.method === 'POST' && url === '/auth/setup') {
    const body = JSON.parse(await readBody(req));
    if (loadPwdHash()) return json(res, 403, { error: 'Password already set' });
    if (!body.password || body.password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });
    savePwdHash(hashPwd(body.password));
    const token = makeToken();
    setSessionCookie(res, token);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/auth/login') {
    const body = JSON.parse(await readBody(req));
    const hash = loadPwdHash();
    if (!hash || hashPwd(body.password || '') !== hash) {
      return json(res, 401, { error: 'Incorrect password' });
    }
    const token = makeToken();
    setSessionCookie(res, token);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/auth/logout') {
    const m = (req.headers.cookie || '').match(/meeto_sid=([a-f0-9]{64})/);
    if (m) sessions.delete(m[1]);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  // ── main app + all API routes require valid session ───────────
  if (req.method === 'GET' && url === '/') {
    if (!checkToken(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8'));
    }
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  if (!checkToken(req)) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  // ── Admin ──────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'));
  }

  if (req.method === 'GET' && url === '/admin/stats') {
    const mtgCount = db.exec('SELECT COUNT(*) FROM meetings')[0]?.values[0][0] || 0;
    const cardCount = db.exec('SELECT COUNT(*) FROM cards')[0]?.values[0][0] || 0;
    const docCount = db.exec('SELECT COUNT(*) FROM documents')[0]?.values[0][0] || 0;
    let dbSize = 0; try { dbSize = fs.statSync(DB_FILE).size; } catch(e) {}
    return json(res, 200, {
      meetings: mtgCount, cards: cardCount, docs: docCount, dbSize,
      stripeConfigured: !!loadEnvVar('STRIPE_SECRET_KEY'),
      licenseSecretSet: !!loadEnvVar('LICENSE_SECRET'),
      uptime: Math.round(process.uptime())
    });
  }

  if (req.method === 'GET' && url === '/admin/config') {
    const sk = loadEnvVar('STRIPE_SECRET_KEY');
    const wh = loadEnvVar('STRIPE_WEBHOOK_SECRET');
    const ls = loadEnvVar('LICENSE_SECRET');
    return json(res, 200, {
      stripeKey: sk ? sk.substring(0, 7) + '...' + sk.slice(-4) : '',
      webhookSecret: wh ? wh.substring(0, 6) + '...' : '',
      licenseSecretSet: !!ls
    });
  }

  if (req.method === 'POST' && url === '/admin/save-config') {
    const body = JSON.parse(await readBody(req));
    if (body.stripeKey) writeEnvVar('STRIPE_SECRET_KEY', body.stripeKey.trim());
    if (body.webhookSecret) writeEnvVar('STRIPE_WEBHOOK_SECRET', body.webhookSecret.trim());
    if (body.licenseSecret) writeEnvVar('LICENSE_SECRET', body.licenseSecret.trim());
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/admin/generate-key') {
    const body = JSON.parse(await readBody(req));
    const type = body.type === 'annual' ? 'annual' : 'lifetime';
    const key = generateLicenseKey(type);
    log('Admin generated license key:', type);
    return json(res, 200, { key });
  }

  if (req.method === 'POST' && url === '/admin/verify-key') {
    const body = JSON.parse(await readBody(req));
    const info = verifyLicenseKey(body.key || '');
    return json(res, 200, info ? { valid: true, ...info } : { valid: false });
  }

  if (req.method === 'GET' && url === '/api-key') {
    return json(res, 200, { key: loadEnv() });
  }

  if (req.method === 'POST' && url === '/save-key') {
    const body = JSON.parse(await readBody(req));
    if (body.key) saveEnv(body.key);
    return json(res, 200, { ok: true });
  }

  // ── meeting CRUD ──────────────────────────────────────────
  if (req.method === 'POST' && url === '/meeting/start') {
    const body = JSON.parse(await readBody(req));
    const stmt = db.prepare(`
      INSERT INTO meetings (title, started_at, transcript, word_count, total_cards, context_used)
      VALUES (?, ?, '', 0, 0, ?)
    `);
    stmt.run([body.title || 'Meeting ' + new Date().toLocaleDateString(), new Date().toISOString(), body.context || '']);
    stmt.free();
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    saveDb();
    return json(res, 200, { id });
  }

  if (req.method === 'POST' && url === '/meeting/update') {
    const body = JSON.parse(await readBody(req));
    db.run(`
      UPDATE meetings SET transcript=?, word_count=?, total_cards=?, ended_at=?
      WHERE id=?
    `, [body.transcript || '', body.wordCount || 0, body.totalCards || 0, new Date().toISOString(), body.id]);
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/meeting/end') {
    const body = JSON.parse(await readBody(req));
    db.run(`
      UPDATE meetings SET transcript=?, word_count=?, total_cards=?, ended_at=?
      WHERE id=?
    `, [body.transcript || '', body.wordCount || 0, body.totalCards || 0, new Date().toISOString(), body.id]);
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/card/save') {
    const body = JSON.parse(await readBody(req));
    const stmt = db.prepare(`
      INSERT INTO cards (meeting_id, captured_at, tag, title, body, transcript_snapshot)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    body.cards.forEach(c => {
      stmt.run([body.meetingId, new Date().toISOString(), c.tag, c.title, c.body, body.transcriptSnapshot || '']);
    });
    stmt.free();
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/meetings') {
    const result = db.exec(`
      SELECT m.id, m.title, m.started_at, m.ended_at, m.word_count, m.total_cards,
             COUNT(c.id) as card_count
      FROM meetings m
      LEFT JOIN cards c ON c.meeting_id = m.id
      GROUP BY m.id
      ORDER BY m.started_at DESC
    `);
    const rows = result.length ? result[0].values.map(r => ({
      id: r[0], title: r[1], started_at: r[2], ended_at: r[3],
      word_count: r[4], total_cards: r[5], card_count: r[6]
    })) : [];
    return json(res, 200, rows);
  }

  if (req.method === 'GET' && url.startsWith('/meeting/')) {
    const id = parseInt(url.split('/')[2]);
    const m = db.exec(`SELECT * FROM meetings WHERE id=${id}`);
    const c = db.exec(`SELECT * FROM cards WHERE meeting_id=${id} ORDER BY captured_at ASC`);
    if (!m.length || !m[0].values.length) return json(res, 404, { error: 'Not found' });
    const cols = m[0].columns;
    const vals = m[0].values[0];
    const meeting = {};
    cols.forEach((col, i) => meeting[col] = vals[i]);
    const cardCols = c.length ? c[0].columns : [];
    const cards = c.length ? c[0].values.map(r => {
      const card = {};
      cardCols.forEach((col, i) => card[col] = r[i]);
      return card;
    }) : [];
    return json(res, 200, { meeting, cards });
  }

  if (req.method === 'DELETE' && url.startsWith('/meeting/')) {
    const id = parseInt(url.split('/')[2]);
    db.run(`DELETE FROM cards WHERE meeting_id=?`, [id]);
    db.run(`DELETE FROM meetings WHERE id=?`, [id]);
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/export/csv') {
    const m = db.exec(`SELECT m.id, m.title, m.started_at, m.ended_at, m.word_count, m.total_cards FROM meetings m ORDER BY m.started_at DESC`);
    const c = db.exec(`SELECT meeting_id, captured_at, tag, title, body FROM cards ORDER BY meeting_id, captured_at`);
    let csv = 'meeting_id,meeting_title,started_at,ended_at,word_count,card_tag,card_title,card_body\n';
    const meetings = {};
    if (m.length) m[0].values.forEach(r => meetings[r[0]] = { title: r[1], started: r[2], ended: r[3], words: r[4] });
    if (c.length) c[0].values.forEach(r => {
      const mtg = meetings[r[0]] || {};
      const esc = v => '"' + (v||'').toString().replace(/"/g,'""') + '"';
      csv += `${r[0]},${esc(mtg.title)},${esc(mtg.started)},${esc(mtg.ended)},${mtg.words||0},${esc(r[2])},${esc(r[3])},${esc(r[4])}\n`;
    });
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="meetings.csv"' });
    return res.end(csv);
  }

  if (req.method === 'POST' && url === '/meeting/todos') {
    const body = JSON.parse(await readBody(req));
    db.run('UPDATE meetings SET todos=? WHERE id=?', [body.todos || '[]', body.id]);
    saveDb();
    return json(res, 200, { ok: true });
  }

  // ── Claude proxy ──────────────────────────────────────────
  if (req.method === 'POST' && url === '/proxy') {
    const apiKey = loadEnv();
    if (!apiKey) return json(res, 401, { error: 'No API key' });
    const body = await readBody(req);
    const https = require('https');
    const payload = body;
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const proxyReq = https.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', d => data += d);
      proxyRes.on('end', () => { res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' }); res.end(data); });
    });
    proxyReq.on('error', e => json(res, 500, { error: e.message }));
    proxyReq.write(payload);
    return proxyReq.end();
  }

  // ── Whisper transcription ─────────────────────────────────
  if (req.method === 'POST' && url === '/transcribe') {
    const body = JSON.parse(await readBody(req));
    const { audio, sampleRate = 16000 } = body;
    if (!audio || !audio.length) return json(res, 200, { text: '' });
    try {
      const whisper = await getWhisper();
      const buf = Buffer.from(audio, 'base64');
      // slice() copies bytes into a new ArrayBuffer at offset 0 — avoids Float32Array alignment error
      const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const audioData = new Float32Array(aligned);
      log('Transcribe: ' + audioData.length + ' samples @ ' + sampleRate + ' Hz');
      const result = await whisper(audioData, { sampling_rate: sampleRate });
      log('Whisper result: ' + JSON.stringify(result.text || ''));
      return json(res, 200, { text: result.text || '' });
    } catch(e) {
      log('Transcription error: ' + e.message);
      return json(res, 200, { text: '' });
    }
  }

  // ── document RAG ──────────────────────────────────────────
  if (req.method === 'GET' && url === '/documents') {
    const r = db.exec('SELECT id, name, file_type, size, chunk_count, uploaded_at FROM documents ORDER BY uploaded_at DESC');
    const docs = r.length ? r[0].values.map(v => ({ id:v[0], name:v[1], file_type:v[2], size:v[3], chunk_count:v[4], uploaded_at:v[5] })) : [];
    return json(res, 200, docs);
  }

  if (req.method === 'POST' && url === '/documents/upload') {
    const body = JSON.parse(await readBody(req));
    const { name, data } = body;
    const ext = (name || '').split('.').pop().toLowerCase();
    if (!['txt','md','pdf','docx','html','htm'].includes(ext)) return json(res, 400, { error: 'Unsupported file type' });
    const buf = Buffer.from(data, 'base64');
    let text;
    try { text = await extractText(buf, ext); } catch(e) { return json(res, 500, { error: 'Extraction failed: ' + e.message }); }
    if (!text || text.trim().length < 20) return json(res, 400, { error: 'No text content found' });
    const chunks = chunkText(text);
    const ds = db.prepare('INSERT INTO documents (name, file_type, size, char_count, chunk_count, uploaded_at) VALUES (?,?,?,?,?,?)');
    ds.run([name, ext, buf.length, text.length, chunks.length, new Date().toISOString()]);
    ds.free();
    const docId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    for (let i = 0; i < chunks.length; i++) {
      let emb = [];
      try { emb = await computeEmbedding(chunks[i]); } catch(e) { console.warn('Embedding error chunk', i, e.message); }
      const cs = db.prepare('INSERT INTO document_chunks (doc_id, chunk_index, text, embedding) VALUES (?,?,?,?)');
      cs.run([docId, i, chunks[i], JSON.stringify(emb)]);
      cs.free();
    }
    saveDb();
    return json(res, 200, { id: docId, name, chunks: chunks.length });
  }

  if (req.method === 'POST' && url === '/documents/search') {
    const body = JSON.parse(await readBody(req));
    const { query, topK = 4 } = body;
    if (!query) return json(res, 200, { chunks: [] });
    const cr = db.exec('SELECT COUNT(*) FROM document_chunks');
    if (!cr.length || !cr[0].values[0][0]) return json(res, 200, { chunks: [] });
    let qEmb;
    try { qEmb = await computeEmbedding(query); } catch(e) { return json(res, 200, { chunks: [] }); }
    const rows = db.exec('SELECT dc.text, dc.embedding, d.name FROM document_chunks dc JOIN documents d ON d.id=dc.doc_id');
    if (!rows.length) return json(res, 200, { chunks: [] });
    const scored = [];
    for (const r of rows[0].values) {
      let sim = 0;
      try { const emb = JSON.parse(r[1] || '[]'); if (emb.length) sim = cosineSim(qEmb, emb); } catch(e) {}
      if (sim > 0.25) scored.push({ text: r[0], docName: r[2], sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    return json(res, 200, { chunks: scored.slice(0, topK) });
  }

  if (req.method === 'DELETE' && url.startsWith('/documents/')) {
    const id = parseInt(url.split('/')[2]);
    if (!isNaN(id)) {
      db.run('DELETE FROM document_chunks WHERE doc_id=?', [id]);
      db.run('DELETE FROM documents WHERE id=?', [id]);
      saveDb();
      return json(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && url === '/open-url') {
    const body = JSON.parse(await readBody(req));
    try {
      const { shell } = require('electron');
      await shell.openExternal(body.url || '');
      return json(res, 200, { ok: true });
    } catch(e) { return json(res, 200, { ok: false }); }
  }

  // ── Microsoft To Do integration ───────────────────────────────
  if (req.method === 'GET' && url === '/msft/status') {
    const clientId = loadMsftClientId();
    const tokens = loadMsftTokens();
    return json(res, 200, { hasClientId: !!clientId, authenticated: !!tokens });
  }

  if (req.method === 'POST' && url === '/msft/save-client') {
    const body = JSON.parse(await readBody(req));
    if (body.clientId) saveMsftClientId(body.clientId.trim());
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/msft/start-auth') {
    const clientId = loadMsftClientId();
    if (!clientId) return json(res, 400, { error: 'No client ID saved' });
    try {
      const result = await msftFormPost('/common/oauth2/v2.0/devicecode', {
        client_id: clientId, scope: 'Tasks.ReadWrite offline_access'
      });
      return json(res, 200, result);
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && url === '/msft/poll-auth') {
    const body = JSON.parse(await readBody(req));
    const clientId = loadMsftClientId();
    try {
      const result = await msftFormPost('/common/oauth2/v2.0/token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId, device_code: body.device_code
      });
      if (result.access_token) {
        saveMsftTokens({ ...result, acquired_at: Date.now() });
        return json(res, 200, { status: 'authenticated' });
      }
      if (result.error === 'authorization_pending') return json(res, 200, { status: 'pending' });
      return json(res, 200, { status: 'error', error: result.error_description || result.error });
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && url === '/msft/disconnect') {
    try { fs.unlinkSync(MSFT_TOKENS_FILE); } catch(e) {}
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/msft/lists') {
    try {
      const tokens = await getValidMsftTokens();
      if (!tokens) return json(res, 401, { error: 'Not authenticated' });
      const r = await graphGet(tokens, '/me/todo/lists');
      return json(res, 200, { lists: r.value || [] });
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && url === '/msft/create-tasks') {
    const body = JSON.parse(await readBody(req));
    try {
      const tokens = await getValidMsftTokens();
      if (!tokens) return json(res, 401, { error: 'Not authenticated' });
      let created = 0;
      for (const text of (body.tasks || [])) {
        await graphPost(tokens, `/me/todo/lists/${body.listId}/tasks`, { title: text });
        created++;
      }
      log('Created ' + created + ' Microsoft To Do tasks');
      return json(res, 200, { created });
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  res.writeHead(404); res.end('not found');
});

const serverReady = new Promise(resolve => {
  initDb().then(() => {
    server.listen(PORT, '127.0.0.1', () => {
      log(`Meeto running at http://localhost:${PORT}`);
      if (!process.versions.electron) {
        const { exec } = require('child_process');
        exec(`start http://localhost:${PORT}`);
      }
      resolve();
    });
  });
});

module.exports = { serverReady };
