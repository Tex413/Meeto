const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const PORT = parseInt(process.env.PORT || '7432');
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_HTTPS = PUBLIC_URL.startsWith('https://');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'meetintel.sqlite');
const DOCS_DIR = path.join(DATA_DIR, 'documents');
const LOG_FILE = path.join(DATA_DIR, 'meetintel.log');
const ENV_FILE = path.join(DATA_DIR, '.env');

const TRIAL_SECONDS = 20 * 60;
const TRIAL_MAX_DOCS = 2;
const TRIAL_DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

function log(...args) {
  const line = new Date().toISOString() + ' ' + args.join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}
process.on('uncaughtException', e => log('UNCAUGHT', e.stack || e.message));
process.on('unhandledRejection', e => log('UNHANDLED', e?.stack || e));

// ── sqlite ─────────────────────────────────────────────────────
const initSqlJs = require('sql.js');
let db = null;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    pwd_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'trial',
    trial_seconds_used INTEGER NOT NULL DEFAULT 0,
    trial_docs_uploaded INTEGER NOT NULL DEFAULT 0,
    trial_expired_at TEXT,
    data_deleted_at TEXT,
    license_key TEXT,
    license_type TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    ai_provider TEXT NOT NULL DEFAULT 'openai',
    ai_model TEXT NOT NULL DEFAULT 'gpt-4o',
    anthropic_key TEXT,
    openai_key TEXT,
    msft_client_id TEXT,
    msft_tokens TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    title TEXT,
    started_at TEXT,
    ended_at TEXT,
    transcript TEXT,
    word_count INTEGER,
    total_cards INTEGER,
    context_used TEXT,
    todos TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    captured_at TEXT,
    tag TEXT,
    title TEXT,
    body TEXT,
    transcript_snapshot TEXT,
    FOREIGN KEY(meeting_id) REFERENCES meetings(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT,
    file_type TEXT,
    size INTEGER,
    char_count INTEGER,
    chunk_count INTEGER,
    uploaded_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER,
    chunk_index INTEGER,
    text TEXT,
    embedding TEXT,
    FOREIGN KEY(doc_id) REFERENCES documents(id)
  )`);

  // migrations for existing DBs
  const migrate = sql => { try { db.run(sql); } catch(e) {} };
  migrate('ALTER TABLE meetings ADD COLUMN user_id INTEGER DEFAULT 1');
  migrate('ALTER TABLE documents ADD COLUMN user_id INTEGER DEFAULT 1');
  migrate('ALTER TABLE meetings ADD COLUMN todos TEXT');
  migrate('ALTER TABLE users ADD COLUMN reset_token TEXT');
  migrate('ALTER TABLE users ADD COLUMN reset_expires TEXT');

  // Data fix: an Anthropic key (sk-ant-) saved in the OpenAI slot breaks
  // Whisper transcription and confuses provider routing. Normalize it.
  migrate(`UPDATE user_settings SET anthropic_key = openai_key WHERE (anthropic_key IS NULL OR anthropic_key = '') AND openai_key LIKE 'sk-ant-%'`);
  migrate(`UPDATE user_settings SET ai_provider = 'anthropic' WHERE ai_provider = 'openai' AND anthropic_key LIKE 'sk-ant-%'`);
  migrate(`UPDATE user_settings SET ai_model = 'claude-sonnet-4-6' WHERE ai_provider = 'anthropic' AND (ai_model IS NULL OR ai_model LIKE 'gpt%' OR ai_model LIKE 'o1%' OR ai_model LIKE 'o3%')`);
  migrate(`UPDATE user_settings SET openai_key = NULL WHERE openai_key LIKE 'sk-ant-%'`);

  saveDb();
  log('Database ready:', DB_FILE);
}

function saveDb() {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function dbGet(sql, params = []) {
  const r = db.exec(sql.replace(/\?/g, () => {
    const v = params.shift();
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return v;
    return "'" + String(v).replace(/'/g, "''") + "'";
  }));
  if (!r.length || !r[0].values.length) return null;
  const row = {}; r[0].columns.forEach((c, i) => row[c] = r[0].values[0][i]);
  return row;
}

// ── session auth ───────────────────────────────────────────────
const sessions = new Map(); // token → { userId, expiry }
const SESSION_MS = 8 * 60 * 60 * 1000;

function hashPwd(pwd) {
  return crypto.createHash('sha256').update('meeto-v1:' + pwd).digest('hex');
}
function makeToken(userId) {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, { userId, expiry: Date.now() + SESSION_MS });
  return t;
}
function checkToken(req) {
  const m = (req.headers.cookie || '').match(/meetintel_sid=([a-f0-9]{64})/);
  const token = m ? m[1] : (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || Date.now() > s.expiry) { sessions.delete(token); return null; }
  s.expiry = Date.now() + SESSION_MS;
  return s.userId;
}
function setSessionCookie(res, token) {
  const secure = IS_HTTPS ? '; Secure' : '';
  res.setHeader('Set-Cookie', `meetintel_sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}${secure}`);
}
function clearSessionCookie(res) {
  const secure = IS_HTTPS ? '; Secure' : '';
  res.setHeader('Set-Cookie', `meetintel_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

// ── trial helpers ──────────────────────────────────────────────
function trialStatus(user) {
  if (user.tier === 'paid') return { ok: true, tier: 'paid' };
  const secondsLeft = Math.max(0, TRIAL_SECONDS - (user.trial_seconds_used || 0));
  const expired = secondsLeft === 0;
  return { ok: !expired, tier: 'trial', secondsLeft, secondsUsed: user.trial_seconds_used || 0, secondsTotal: TRIAL_SECONDS };
}

function markTrialExpired(userId) {
  const u = dbGet(`SELECT trial_expired_at FROM users WHERE id = ${userId}`);
  if (!u || u.trial_expired_at) return;
  db.run(`UPDATE users SET trial_expired_at = '${new Date().toISOString()}' WHERE id = ${userId}`);
  saveDb();
}

function cleanupExpiredTrials() {
  const cutoff = new Date(Date.now() - TRIAL_DELETE_AFTER_MS).toISOString();
  const r = db.exec(`SELECT id FROM users WHERE tier='trial' AND trial_seconds_used >= ${TRIAL_SECONDS} AND data_deleted_at IS NULL AND trial_expired_at < '${cutoff}'`);
  if (!r.length || !r[0].values.length) return;
  for (const [userId] of r[0].values) {
    const mids = db.exec(`SELECT id FROM meetings WHERE user_id = ${userId}`);
    if (mids.length && mids[0].values.length) {
      for (const [mid] of mids[0].values) db.run(`DELETE FROM cards WHERE meeting_id = ${mid}`);
    }
    db.run(`DELETE FROM meetings WHERE user_id = ${userId}`);
    const dids = db.exec(`SELECT id FROM documents WHERE user_id = ${userId}`);
    if (dids.length && dids[0].values.length) {
      for (const [did] of dids[0].values) db.run(`DELETE FROM document_chunks WHERE doc_id = ${did}`);
    }
    db.run(`DELETE FROM documents WHERE user_id = ${userId}`);
    db.run(`UPDATE users SET data_deleted_at = '${new Date().toISOString()}' WHERE id = ${userId}`);
    log('Deleted expired trial data for user', userId);
  }
  saveDb();
}
setInterval(cleanupExpiredTrials, 60 * 60 * 1000);

// ── env helpers ────────────────────────────────────────────────
function loadEnvVar(varName) {
  try { const c = fs.readFileSync(ENV_FILE, 'utf8'); const m = c.match(new RegExp(varName + '\\s*=\\s*(.+)')); return m ? m[1].trim() : ''; } catch { return ''; }
}
function writeEnvVar(varName, value) {
  let c = ''; try { c = fs.readFileSync(ENV_FILE, 'utf8'); } catch(e) {}
  const re = new RegExp(varName + '\\s*=.*');
  c = re.test(c) ? c.replace(re, varName + '=' + value) : c.trimEnd() + '\n' + varName + '=' + value + '\n';
  fs.writeFileSync(ENV_FILE, c, 'utf8');
}

// ── email / password reset ─────────────────────────────────────
async function sendResetEmail(toEmail, token) {
  const url = `${PUBLIC_URL}/reset?token=${token}`;
  const smtpHost = loadEnvVar('SMTP_HOST');
  if (smtpHost) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(loadEnvVar('SMTP_PORT') || '587'),
      secure: loadEnvVar('SMTP_PORT') === '465',
      auth: { user: loadEnvVar('SMTP_USER'), pass: loadEnvVar('SMTP_PASS') }
    });
    await transporter.sendMail({
      from: loadEnvVar('SMTP_FROM') || 'noreply@meetintel.io',
      to: toEmail,
      subject: 'Reset your Meetintel password',
      text: `Click this link to reset your password (expires in 1 hour):\n\n${url}\n\nIf you didn't request this, ignore this email.`,
      html: `<p>Click below to reset your Meetintel password (expires in 1 hour):</p><p><a href="${url}">${url}</a></p><p style="color:#888;font-size:12px">If you didn't request this, ignore this email.</p>`
    });
    return { emailed: true };
  }
  log('RESET LINK (no SMTP):', url);
  return { emailed: false, url };
}

// ── request helpers ────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => resolve(b)); req.on('error', reject);
  });
}
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; req.on('data', d => chunks.push(d)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

// ── OpenAI Whisper STT ─────────────────────────────────────────
function float32ToWav(samples, sampleRate) {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  }
  const pcm = Buffer.from(int16.buffer);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(sampleRate, 24);
  hdr.writeUInt32LE(sampleRate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([hdr, pcm]);
}

function openaiWhisper(wavBuffer, openaiKey) {
  return new Promise((resolve, reject) => {
    const boundary = 'meetintel-' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      wavBuffer,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`)
    ]);
    const opts = {
      hostname: 'api.openai.com', path: '/v1/audio/transcriptions', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + openaiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          resolve(parsed.text || '');
        } catch(e) { reject(new Error(d.substring(0, 200))); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// True only for a usable OpenAI key (not an Anthropic key parked in the slot)
function isRealOpenAIKey(key) {
  return !!key && key.startsWith('sk-') && !key.startsWith('sk-ant-');
}

// ── AI proxy (Anthropic + OpenAI, unified Anthropic response format) ──
function proxyAnthropic(body, apiKey) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': apiKey,
        'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function proxyOpenAI(anthropicBody, openaiKey, model) {
  return new Promise((resolve, reject) => {
    const req = JSON.parse(anthropicBody);
    const messages = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    (req.messages || []).forEach(m => messages.push(m));
    const payload = JSON.stringify({ model, messages, max_tokens: req.max_tokens || 1024 });
    const opts = {
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const r = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const oai = JSON.parse(d);
          if (oai.error) {
            resolve({ status: 400, body: JSON.stringify({ error: oai.error.message || JSON.stringify(oai.error) }) });
            return;
          }
          const text = oai.choices?.[0]?.message?.content || '';
          const anthropicRes = {
            id: oai.id || 'openai', type: 'message', role: 'assistant',
            content: [{ type: 'text', text }], model: oai.model || model,
            usage: { input_tokens: oai.usage?.prompt_tokens || 0, output_tokens: oai.usage?.completion_tokens || 0 }
          };
          resolve({ status: 200, body: JSON.stringify(anthropicRes) });
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject); r.write(payload); r.end();
  });
}

// ── RAG / embeddings ───────────────────────────────────────────
let _embedder = null, _embedderLoading = false;
async function getEmbedder() {
  if (_embedder) return _embedder;
  if (_embedderLoading) {
    await new Promise(resolve => { const t = setInterval(() => { if (!_embedderLoading) { clearInterval(t); resolve(); } }, 200); });
    return _embedder;
  }
  _embedderLoading = true;
  log('Loading embedding model…');
  try {
    const { pipeline } = await import('@xenova/transformers');
    _embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
    log('Embedding model ready.');
  } finally { _embedderLoading = false; }
  return _embedder;
}
async function computeEmbedding(text) {
  const e = await getEmbedder();
  const out = await e(text, { pooling: 'mean', normalize: true });
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
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#?\w+;/g, ' ')
      .replace(/\s{2,}/g, ' ').trim();
  }
  if (ext === 'pdf') { const p = require('pdf-parse'); return (await p(buffer)).text; }
  if (ext === 'docx') { const m = require('mammoth'); return (await m.extractRawText({ buffer })).value; }
  throw new Error('Unsupported type: ' + ext);
}

// ── Microsoft Graph helpers ────────────────────────────────────
function msftFormPost(apiPath, params) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const opts = {
      hostname: 'login.microsoftonline.com', path: apiPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
function graphRequest(tokens, method, apiPath, body) {
  return new Promise((resolve, reject) => {
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

async function getValidMsftTokens(userId) {
  const s = dbGet(`SELECT msft_tokens, msft_client_id FROM user_settings WHERE user_id = ${userId}`);
  if (!s || !s.msft_tokens) return null;
  let tokens; try { tokens = JSON.parse(s.msft_tokens); } catch(e) { return null; }
  const expiresAt = (tokens.acquired_at || 0) + ((tokens.expires_in || 3600) - 300) * 1000;
  if (Date.now() > expiresAt && tokens.refresh_token) {
    try {
      const refreshed = await msftFormPost('/common/oauth2/v2.0/token', {
        grant_type: 'refresh_token', client_id: s.msft_client_id,
        refresh_token: tokens.refresh_token, scope: 'Tasks.ReadWrite offline_access'
      });
      if (refreshed.access_token) {
        tokens = { ...refreshed, acquired_at: Date.now() };
        saveMsftTokens(userId, tokens);
      }
    } catch(e) { log('MSFT refresh error:', e.message); }
  }
  return tokens;
}
function saveMsftTokens(userId, tokens) {
  ensureUserSettings(userId);
  db.run(`UPDATE user_settings SET msft_tokens = '${JSON.stringify(tokens).replace(/'/g, "''")}' WHERE user_id = ${userId}`);
  saveDb();
}
function ensureUserSettings(userId) {
  const s = dbGet(`SELECT user_id FROM user_settings WHERE user_id = ${userId}`);
  if (!s) db.run(`INSERT INTO user_settings (user_id) VALUES (${userId})`);
}

// ── Stripe / license helpers ───────────────────────────────────
function generateLicenseKey(type) {
  const secret = loadEnvVar('LICENSE_SECRET') || 'meetintel-dev-secret';
  const payload = Buffer.from(JSON.stringify({ type, issued: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url').substring(0, 22);
  return `MEETINTEL-${payload}.${sig}`;
}
function verifyLicenseKey(key) {
  try {
    const secret = loadEnvVar('LICENSE_SECRET') || 'meetintel-dev-secret';
    const m = key.match(/^MEETINTEL-(.+)\.([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    const [, payload, sig] = m;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url').substring(0, 22);
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch(e) { return null; }
}

// ── server ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const skipLog = ['/auth/status', '/'].includes(url) || url.startsWith('/static');
  if (!skipLog) log(`${req.method} ${url}`);
  if (req.method === 'GET' && url === '/landing') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8'));
  }

  if (req.method === 'GET' && url === '/auth/status') {
    const userId = checkToken(req);
    return json(res, 200, { authenticated: !!userId });
  }

  if (req.method === 'POST' && url === '/auth/register') {
    const body = JSON.parse(await readBody(req));
    const { email, password } = body;
    if (!email || !email.includes('@')) return json(res, 400, { error: 'Valid email required' });
    if (!password || password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });
    const existing = dbGet(`SELECT id FROM users WHERE email = '${email.replace(/'/g, "''").toLowerCase()}'`);
    if (existing) return json(res, 409, { error: 'Email already registered' });
    const hash = hashPwd(password);
    const emailSafe = email.toLowerCase().replace(/'/g, "''");
    db.run(`INSERT INTO users (email, pwd_hash, created_at) VALUES ('${emailSafe}', '${hash}', '${new Date().toISOString()}')`);
    saveDb();
    const user = dbGet(`SELECT id FROM users WHERE email = '${emailSafe}'`);
    const token = makeToken(user.id);
    setSessionCookie(res, token);
    log('New user registered:', email);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/auth/login') {
    const body = JSON.parse(await readBody(req));
    const emailSafe = (body.email || '').toLowerCase().replace(/'/g, "''");
    const user = dbGet(`SELECT id, pwd_hash FROM users WHERE email = '${emailSafe}'`);
    if (!user || hashPwd(body.password || '') !== user.pwd_hash) {
      return json(res, 401, { error: 'Incorrect email or password' });
    }
    const token = makeToken(user.id);
    setSessionCookie(res, token);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/auth/forgot') {
    const body = JSON.parse(await readBody(req));
    const emailSafe = (body.email || '').toLowerCase().replace(/'/g, "''");
    const user = dbGet(`SELECT id FROM users WHERE email = '${emailSafe}'`);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      db.run(`UPDATE users SET reset_token='${token}', reset_expires='${expires}' WHERE id=${user.id}`);
      saveDb();
      try { await sendResetEmail(emailSafe, token); } catch(e) { log('Reset email error:', e.message); }
    }
    return json(res, 200, { ok: true }); // always 200 to prevent email enumeration
  }

  if (req.method === 'GET' && url === '/reset') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'reset.html'), 'utf8'));
  }

  if (req.method === 'POST' && url === '/auth/reset-password') {
    const body = JSON.parse(await readBody(req));
    const { token, password } = body;
    if (!token || !password || password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });
    const tokenSafe = token.replace(/'/g, "''");
    const user = dbGet(`SELECT id, reset_expires FROM users WHERE reset_token='${tokenSafe}'`);
    if (!user || !user.reset_expires || new Date(user.reset_expires) < new Date()) {
      return json(res, 400, { error: 'Reset link is invalid or has expired' });
    }
    db.run(`UPDATE users SET pwd_hash='${hashPwd(password)}', reset_token=NULL, reset_expires=NULL WHERE id=${user.id}`);
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/auth/logout') {
    const m = (req.headers.cookie || '').match(/meetintel_sid=([a-f0-9]{64})/);
    if (m) sessions.delete(m[1]);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  // ── Checkout + Stripe webhook (public) ───────────────────────
  if (req.method === 'POST' && url === '/checkout/create') {
    const body = JSON.parse(await readBody(req));
    const stripeKey = loadEnvVar('STRIPE_SECRET_KEY');
    if (!stripeKey) return json(res, 500, { error: 'Stripe not configured' });
    try {
      const Stripe = require('stripe');
      const stripe = Stripe(stripeKey);
      const isAnnual = body.plan === 'annual';
      const session = await stripe.checkout.sessions.create({
        mode: isAnnual ? 'subscription' : 'payment',
        line_items: [{ price_data: {
          currency: 'usd',
          product_data: { name: isAnnual ? 'Meetintel Annual License' : 'Meetintel Lifetime License' },
          unit_amount: isAnnual ? 2995 : 11900,
          ...(isAnnual ? { recurring: { interval: 'year' } } : {})
        }, quantity: 1 }],
        success_url: `${PUBLIC_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${PUBLIC_URL}/checkout/cancel`
      });
      return json(res, 200, { url: session.url });
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'GET' && url.startsWith('/checkout/success')) {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const sessionId = params.get('session_id') || '';
    const stripeKey = loadEnvVar('STRIPE_SECRET_KEY');
    let licenseKey = '', planType = 'lifetime';
    if (stripeKey && sessionId) {
      try {
        const Stripe = require('stripe');
        const session = await Stripe(stripeKey).checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid' || session.status === 'complete') {
          planType = session.mode === 'subscription' ? 'annual' : 'lifetime';
          licenseKey = generateLicenseKey(planType);
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
    res.writeHead(302, { 'Location': '/landing#pricing' }); return res.end();
  }

  if (req.method === 'POST' && url === '/stripe/webhook') {
    const rawBody = await readRawBody(req);
    const webhookSecret = loadEnvVar('STRIPE_WEBHOOK_SECRET');
    const stripeKey = loadEnvVar('STRIPE_SECRET_KEY');
    if (stripeKey && webhookSecret) {
      try {
        const Stripe = require('stripe');
        const event = Stripe(stripeKey).webhooks.constructEvent(rawBody, req.headers['stripe-signature'], webhookSecret);
        log('Stripe webhook:', event.type);
      } catch(e) { return json(res, 400, { error: e.message }); }
    }
    return json(res, 200, { received: true });
  }

  // ── main app ─────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/') {
    const htmlHdr = { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, must-revalidate' };
    if (!checkToken(req)) {
      res.writeHead(200, htmlHdr);
      return res.end(fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8'));
    }
    res.writeHead(200, htmlHdr);
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
  }

  // ── all routes below require auth ────────────────────────────
  const userId = checkToken(req);
  if (!userId) return json(res, 401, { error: 'Unauthorized' });

  const user = dbGet(`SELECT * FROM users WHERE id = ${userId}`);
  if (!user) return json(res, 401, { error: 'User not found' });

  // ── admin ────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'));
  }

  if (req.method === 'GET' && url === '/admin/reset-links') {
    const r = db.exec(`SELECT email, reset_token, reset_expires FROM users WHERE reset_token IS NOT NULL AND reset_expires > '${new Date().toISOString()}'`);
    const links = r.length ? r[0].values.map(v => ({
      email: v[0],
      url: `${PUBLIC_URL}/reset?token=${v[1]}`,
      expires: v[2]
    })) : [];
    return json(res, 200, links);
  }

  if (req.method === 'GET' && url === '/admin/stats') {
    const mtg = db.exec('SELECT COUNT(*) FROM meetings')[0]?.values[0][0] || 0;
    const crd = db.exec('SELECT COUNT(*) FROM cards')[0]?.values[0][0] || 0;
    const doc = db.exec('SELECT COUNT(*) FROM documents')[0]?.values[0][0] || 0;
    const usr = db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] || 0;
    const paid = db.exec("SELECT COUNT(*) FROM users WHERE tier='paid'")[0]?.values[0][0] || 0;
    let dbSize = 0; try { dbSize = fs.statSync(DB_FILE).size; } catch(e) {}
    return json(res, 200, { meetings: mtg, cards: crd, docs: doc, users: usr, paidUsers: paid, dbSize,
      stripeConfigured: !!loadEnvVar('STRIPE_SECRET_KEY'), licenseSecretSet: !!loadEnvVar('LICENSE_SECRET'),
      uptime: Math.round(process.uptime()) });
  }

  if (req.method === 'GET' && url === '/admin/users') {
    const r = db.exec('SELECT id, email, tier, trial_seconds_used, created_at, license_type, data_deleted_at FROM users ORDER BY created_at DESC');
    const users = r.length ? r[0].values.map(v => ({
      id: v[0], email: v[1], tier: v[2], trialSecondsUsed: v[3], createdAt: v[4], licenseType: v[5], dataDeleted: !!v[6]
    })) : [];
    return json(res, 200, users);
  }

  if (req.method === 'POST' && url === '/admin/reset-password') {
    const body = JSON.parse(await readBody(req));
    const { targetUserId, newPassword } = body;
    if (!newPassword || newPassword.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });
    db.run(`UPDATE users SET pwd_hash='${hashPwd(newPassword)}' WHERE id = ${parseInt(targetUserId)}`);
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/admin/grant-license') {
    const body = JSON.parse(await readBody(req));
    const { targetUserId, licenseType } = body;
    const key = generateLicenseKey(licenseType || 'lifetime');
    db.run(`UPDATE users SET tier='paid', license_key='${key}', license_type='${licenseType || 'lifetime'}' WHERE id = ${parseInt(targetUserId)}`);
    saveDb();
    return json(res, 200, { ok: true, key });
  }

  if (req.method === 'GET' && url === '/admin/config') {
    const sk = loadEnvVar('STRIPE_SECRET_KEY');
    const wh = loadEnvVar('STRIPE_WEBHOOK_SECRET');
    return json(res, 200, {
      stripeKey: sk ? sk.substring(0, 7) + '...' + sk.slice(-4) : '',
      webhookSecret: wh ? wh.substring(0, 6) + '...' : '',
      licenseSecretSet: !!loadEnvVar('LICENSE_SECRET')
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
    return json(res, 200, { key: generateLicenseKey(body.type === 'annual' ? 'annual' : 'lifetime') });
  }

  if (req.method === 'POST' && url === '/admin/verify-key') {
    const body = JSON.parse(await readBody(req));
    const info = verifyLicenseKey(body.key || '');
    return json(res, 200, info ? { valid: true, ...info } : { valid: false });
  }

  // ── user settings ────────────────────────────────────────────
  if (req.method === 'GET' && url === '/user/settings') {
    ensureUserSettings(userId);
    const s = dbGet(`SELECT ai_provider, ai_model, anthropic_key, openai_key FROM user_settings WHERE user_id = ${userId}`);
    const ts = trialStatus(user);
    return json(res, 200, {
      provider: s?.ai_provider || 'openai',
      model: s?.ai_model || 'gpt-4o',
      hasAnthropicKey: !!(s?.anthropic_key) || (s?.openai_key || '').startsWith('sk-ant-'),
      hasOpenaiKey: isRealOpenAIKey(s?.openai_key),
      tier: user.tier,
      trialSecondsUsed: user.trial_seconds_used || 0,
      trialSecondsTotal: TRIAL_SECONDS,
      trialSecondsLeft: ts.secondsLeft ?? null
    });
  }

  if (req.method === 'POST' && url === '/user/settings') {
    const body = JSON.parse(await readBody(req));
    ensureUserSettings(userId);
    const updates = [];
    if (body.provider) updates.push(`ai_provider = '${body.provider === 'anthropic' ? 'anthropic' : 'openai'}'`);
    if (body.model) updates.push(`ai_model = '${body.model.replace(/'/g, "''")}'`);
    if (body.anthropicKey) updates.push(`anthropic_key = '${body.anthropicKey.trim().replace(/'/g, "''")}'`);
    if (body.openaiKey) updates.push(`openai_key = '${body.openaiKey.trim().replace(/'/g, "''")}'`);
    if (updates.length) { db.run(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ${userId}`); saveDb(); }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/license/activate') {
    const body = JSON.parse(await readBody(req));
    const info = verifyLicenseKey(body.key || '');
    if (!info) return json(res, 400, { error: 'Invalid license key' });
    db.run(`UPDATE users SET tier='paid', license_key='${body.key.replace(/'/g, "''")}', license_type='${info.type}' WHERE id = ${userId}`);
    saveDb();
    return json(res, 200, { ok: true, type: info.type });
  }

  if (req.method === 'GET' && url === '/trial/status') {
    const ts = trialStatus(user);
    return json(res, 200, ts);
  }

  // ── meeting CRUD ─────────────────────────────────────────────
  if (req.method === 'POST' && url === '/meeting/start') {
    const ts = trialStatus(user);
    if (!ts.ok) return json(res, 402, { error: 'trial_expired', message: 'Your free trial has ended. Please upgrade to continue.' });
    const body = JSON.parse(await readBody(req));
    const stmt = db.prepare(`INSERT INTO meetings (user_id, title, started_at, transcript, word_count, total_cards, context_used) VALUES (?, ?, ?, '', 0, 0, ?)`);
    stmt.run([userId, body.title || 'Meeting ' + new Date().toLocaleDateString(), new Date().toISOString(), body.context || '']);
    stmt.free();
    const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
    saveDb();
    return json(res, 200, { id });
  }

  if (req.method === 'POST' && url === '/meeting/update') {
    const body = JSON.parse(await readBody(req));
    db.run(`UPDATE meetings SET transcript=?, word_count=?, total_cards=?, ended_at=? WHERE id=? AND user_id=${userId}`,
      [body.transcript || '', body.wordCount || 0, body.totalCards || 0, new Date().toISOString(), body.id]);
    saveDb(); return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/meeting/end') {
    const body = JSON.parse(await readBody(req));
    db.run(`UPDATE meetings SET transcript=?, word_count=?, total_cards=?, ended_at=? WHERE id=? AND user_id=${userId}`,
      [body.transcript || '', body.wordCount || 0, body.totalCards || 0, new Date().toISOString(), body.id]);
    saveDb(); return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/card/save') {
    const body = JSON.parse(await readBody(req));
    const stmt = db.prepare(`INSERT INTO cards (meeting_id, captured_at, tag, title, body, transcript_snapshot) VALUES (?,?,?,?,?,?)`);
    body.cards.forEach(c => stmt.run([body.meetingId, new Date().toISOString(), c.tag, c.title, c.body, body.transcriptSnapshot || '']));
    stmt.free(); saveDb(); return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/meetings') {
    const r = db.exec(`SELECT m.id, m.title, m.started_at, m.ended_at, m.word_count, m.total_cards, COUNT(c.id) as card_count FROM meetings m LEFT JOIN cards c ON c.meeting_id = m.id WHERE m.user_id=${userId} GROUP BY m.id ORDER BY m.started_at DESC`);
    const rows = r.length ? r[0].values.map(r => ({ id:r[0], title:r[1], started_at:r[2], ended_at:r[3], word_count:r[4], total_cards:r[5], card_count:r[6] })) : [];
    return json(res, 200, rows);
  }

  if (req.method === 'GET' && url.startsWith('/meeting/')) {
    const id = parseInt(url.split('/')[2]);
    const m = db.exec(`SELECT * FROM meetings WHERE id=${id} AND user_id=${userId}`);
    const c = db.exec(`SELECT * FROM cards WHERE meeting_id=${id} ORDER BY captured_at ASC`);
    if (!m.length || !m[0].values.length) return json(res, 404, { error: 'Not found' });
    const meeting = {}; m[0].columns.forEach((col, i) => meeting[col] = m[0].values[0][i]);
    const cardCols = c.length ? c[0].columns : [];
    const cards = c.length ? c[0].values.map(r => { const card = {}; cardCols.forEach((col, i) => card[col] = r[i]); return card; }) : [];
    return json(res, 200, { meeting, cards });
  }

  if (req.method === 'DELETE' && url.startsWith('/meeting/')) {
    const id = parseInt(url.split('/')[2]);
    db.run(`DELETE FROM cards WHERE meeting_id=${id}`);
    db.run(`DELETE FROM meetings WHERE id=${id} AND user_id=${userId}`);
    saveDb(); return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/export/csv') {
    const m = db.exec(`SELECT id, title, started_at, ended_at, word_count, total_cards FROM meetings WHERE user_id=${userId} ORDER BY started_at DESC`);
    const c = db.exec(`SELECT meeting_id, captured_at, tag, title, body FROM cards WHERE meeting_id IN (SELECT id FROM meetings WHERE user_id=${userId}) ORDER BY meeting_id, captured_at`);
    let csv = 'meeting_id,meeting_title,started_at,ended_at,word_count,card_tag,card_title,card_body\n';
    const meetings = {};
    if (m.length) m[0].values.forEach(r => meetings[r[0]] = { title: r[1], started: r[2], ended: r[3], words: r[4] });
    if (c.length) c[0].values.forEach(r => {
      const mt = meetings[r[0]] || {};
      const esc = v => '"' + (v||'').toString().replace(/"/g, '""') + '"';
      csv += `${r[0]},${esc(mt.title)},${esc(mt.started)},${esc(mt.ended)},${mt.words||0},${esc(r[2])},${esc(r[3])},${esc(r[4])}\n`;
    });
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="meetings.csv"' });
    return res.end(csv);
  }

  if (req.method === 'POST' && url === '/meeting/todos') {
    const body = JSON.parse(await readBody(req));
    db.run(`UPDATE meetings SET todos=? WHERE id=? AND user_id=${userId}`, [body.todos || '[]', body.id]);
    saveDb(); return json(res, 200, { ok: true });
  }

  // ── AI proxy ─────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/proxy') {
    ensureUserSettings(userId);
    const s = dbGet(`SELECT ai_provider, ai_model, anthropic_key, openai_key FROM user_settings WHERE user_id = ${userId}`);
    const provider = s?.ai_provider || 'openai';
    const rawModel = s?.ai_model || '';
    const isClaudeModel = rawModel.startsWith('claude');
    const isOpenAIModel = rawModel.startsWith('gpt') || rawModel.startsWith('o1') || rawModel.startsWith('o3');
    const model = provider === 'anthropic'
      ? (isClaudeModel ? rawModel : 'claude-sonnet-4-6')
      : (isOpenAIModel ? rawModel : 'gpt-4o');
    const body = await readBody(req);
    try {
      if (provider === 'anthropic') {
        const apiKey = s?.anthropic_key;
        if (!apiKey) return json(res, 400, { error: 'No Anthropic API key saved. Go to Settings to add your key.' });
        const parsedBody = JSON.parse(body);
        parsedBody.model = model;
        log('proxy: Anthropic provider, model=' + model);
        const result = await proxyAnthropic(JSON.stringify(parsedBody), apiKey);
        log('proxy: Anthropic response', result.status, result.body.substring(0, 80));
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        return res.end(result.body);
      } else {
        let apiKey = s?.openai_key;
        if (!apiKey) return json(res, 400, { error: 'No OpenAI API key saved. Go to Settings to add your key.' });
        // Auto-route: if an Anthropic key was saved as the OpenAI key, use the Anthropic proxy
        if (apiKey.startsWith('sk-ant-')) {
          log('proxy: auto-routing Anthropic key → Anthropic API');
          const claudeModel = isClaudeModel ? rawModel : 'claude-sonnet-4-6';
          const parsedBody = JSON.parse(body);
          parsedBody.model = claudeModel;
          const result = await proxyAnthropic(JSON.stringify(parsedBody), apiKey);
          log('proxy: Anthropic response', result.status);
          res.writeHead(result.status, { 'Content-Type': 'application/json' });
          return res.end(result.body);
        }
        const result = await proxyOpenAI(body, apiKey, model);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        return res.end(result.body);
      }
    } catch(e) { log('proxy error:', e.message); return json(res, 500, { error: e.message }); }
  }

  // ── Transcription (OpenAI Whisper API) ───────────────────────
  if (req.method === 'POST' && url === '/transcribe') {
    const ts = trialStatus(user);
    if (!ts.ok) return json(res, 402, { error: 'trial_expired' });
    ensureUserSettings(userId);
    const s = dbGet(`SELECT openai_key FROM user_settings WHERE user_id = ${userId}`);
    if (!isRealOpenAIKey(s?.openai_key)) return json(res, 400, { error: 'no_openai_key', message: 'Whisper transcription needs an OpenAI key. Use Web Speech mode, or add an OpenAI key in Settings.' });
    const body = JSON.parse(await readBody(req));
    const { audio, sampleRate = 16000 } = body;
    if (!audio || !audio.length) return json(res, 200, { text: '' });
    try {
      const buf = Buffer.from(audio, 'base64');
      const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const audioData = new Float32Array(aligned);
      const audioSeconds = audioData.length / sampleRate;
      const wav = float32ToWav(audioData, sampleRate);
      const text = await openaiWhisper(wav, s.openai_key);
      // track trial usage
      if (user.tier === 'trial') {
        const newUsed = Math.min((user.trial_seconds_used || 0) + Math.ceil(audioSeconds), TRIAL_SECONDS + 60);
        db.run(`UPDATE users SET trial_seconds_used = ${newUsed} WHERE id = ${userId}`);
        if (newUsed >= TRIAL_SECONDS) markTrialExpired(userId);
        saveDb();
      }
      return json(res, 200, { text });
    } catch(e) {
      log('Transcription error:', e.message);
      return json(res, 200, { text: '' });
    }
  }

  // ── documents ────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/documents') {
    const r = db.exec(`SELECT id, name, file_type, size, chunk_count, uploaded_at FROM documents WHERE user_id=${userId} ORDER BY uploaded_at DESC`);
    const docs = r.length ? r[0].values.map(v => ({ id:v[0], name:v[1], file_type:v[2], size:v[3], chunk_count:v[4], uploaded_at:v[5] })) : [];
    return json(res, 200, docs);
  }

  if (req.method === 'POST' && url === '/documents/upload') {
    const ts = trialStatus(user);
    if (!ts.ok) return json(res, 402, { error: 'trial_expired' });
    if (user.tier === 'trial' && (user.trial_docs_uploaded || 0) >= TRIAL_MAX_DOCS) {
      return json(res, 402, { error: 'trial_doc_limit', message: `Free trial allows ${TRIAL_MAX_DOCS} documents. Please upgrade.` });
    }
    const body = JSON.parse(await readBody(req));
    const { name, data } = body;
    const ext = (name || '').split('.').pop().toLowerCase();
    if (!['txt','md','pdf','docx','html','htm'].includes(ext)) return json(res, 400, { error: 'Unsupported file type' });
    const buf = Buffer.from(data, 'base64');
    let text; try { text = await extractText(buf, ext); } catch(e) { return json(res, 500, { error: 'Extraction failed: ' + e.message }); }
    if (!text || text.trim().length < 20) return json(res, 400, { error: 'No text content found' });
    const chunks = chunkText(text);
    const ds = db.prepare('INSERT INTO documents (user_id, name, file_type, size, char_count, chunk_count, uploaded_at) VALUES (?,?,?,?,?,?,?)');
    ds.run([userId, name, ext, buf.length, text.length, chunks.length, new Date().toISOString()]);
    ds.free();
    const docId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    for (let i = 0; i < chunks.length; i++) {
      let emb = []; try { emb = await computeEmbedding(chunks[i]); } catch(e) {}
      const cs = db.prepare('INSERT INTO document_chunks (doc_id, chunk_index, text, embedding) VALUES (?,?,?,?)');
      cs.run([docId, i, chunks[i], JSON.stringify(emb)]); cs.free();
    }
    if (user.tier === 'trial') {
      db.run(`UPDATE users SET trial_docs_uploaded = trial_docs_uploaded + 1 WHERE id = ${userId}`);
    }
    saveDb();
    return json(res, 200, { id: docId, name, chunks: chunks.length });
  }

  if (req.method === 'POST' && url === '/documents/search') {
    const body = JSON.parse(await readBody(req));
    const { query, topK = 4 } = body;
    if (!query) return json(res, 200, { chunks: [] });
    const cr = db.exec(`SELECT COUNT(*) FROM document_chunks dc JOIN documents d ON d.id=dc.doc_id WHERE d.user_id=${userId}`);
    if (!cr.length || !cr[0].values[0][0]) return json(res, 200, { chunks: [] });
    let qEmb; try { qEmb = await computeEmbedding(query); } catch(e) { return json(res, 200, { chunks: [] }); }
    const rows = db.exec(`SELECT dc.text, dc.embedding, d.name FROM document_chunks dc JOIN documents d ON d.id=dc.doc_id WHERE d.user_id=${userId}`);
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
      db.run(`DELETE FROM document_chunks WHERE doc_id=${id}`);
      db.run(`DELETE FROM documents WHERE id=${id} AND user_id=${userId}`);
      saveDb(); return json(res, 200, { ok: true });
    }
  }

  // ── open external URL (Electron compat shim) ─────────────────
  if (req.method === 'POST' && url === '/open-url') {
    const body = JSON.parse(await readBody(req));
    try { const { shell } = require('electron'); await shell.openExternal(body.url || ''); return json(res, 200, { ok: true }); }
    catch(e) { return json(res, 200, { ok: false }); }
  }

  // ── Microsoft To Do ──────────────────────────────────────────
  if (req.method === 'GET' && url === '/msft/status') {
    ensureUserSettings(userId);
    const s = dbGet(`SELECT msft_client_id, msft_tokens FROM user_settings WHERE user_id = ${userId}`);
    return json(res, 200, { hasClientId: !!(s?.msft_client_id), authenticated: !!(s?.msft_tokens) });
  }

  if (req.method === 'POST' && url === '/msft/save-client') {
    const body = JSON.parse(await readBody(req));
    ensureUserSettings(userId);
    if (body.clientId) db.run(`UPDATE user_settings SET msft_client_id = '${body.clientId.trim().replace(/'/g, "''")}' WHERE user_id = ${userId}`);
    saveDb(); return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/msft/start-auth') {
    ensureUserSettings(userId);
    const s = dbGet(`SELECT msft_client_id FROM user_settings WHERE user_id = ${userId}`);
    if (!s?.msft_client_id) return json(res, 400, { error: 'No client ID saved' });
    try {
      const result = await msftFormPost('/common/oauth2/v2.0/devicecode', { client_id: s.msft_client_id, scope: 'Tasks.ReadWrite offline_access' });
      return json(res, 200, result);
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && url === '/msft/poll-auth') {
    const body = JSON.parse(await readBody(req));
    ensureUserSettings(userId);
    const s = dbGet(`SELECT msft_client_id FROM user_settings WHERE user_id = ${userId}`);
    try {
      const result = await msftFormPost('/common/oauth2/v2.0/token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: s.msft_client_id, device_code: body.device_code
      });
      if (result.access_token) {
        saveMsftTokens(userId, { ...result, acquired_at: Date.now() });
        return json(res, 200, { status: 'authenticated' });
      }
      if (result.error === 'authorization_pending') return json(res, 200, { status: 'pending' });
      return json(res, 200, { status: 'error', error: result.error_description || result.error });
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && url === '/msft/disconnect') {
    ensureUserSettings(userId);
    db.run(`UPDATE user_settings SET msft_tokens = NULL WHERE user_id = ${userId}`);
    saveDb(); return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/msft/lists') {
    try {
      const tokens = await getValidMsftTokens(userId);
      if (!tokens) return json(res, 401, { error: 'Not authenticated' });
      const r = await graphGet(tokens, '/me/todo/lists');
      return json(res, 200, { lists: r.value || [] });
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && url === '/msft/create-tasks') {
    const body = JSON.parse(await readBody(req));
    try {
      const tokens = await getValidMsftTokens(userId);
      if (!tokens) return json(res, 401, { error: 'Not authenticated' });
      let created = 0;
      for (const text of (body.tasks || [])) {
        await graphPost(tokens, `/me/todo/lists/${body.listId}/tasks`, { title: text });
        created++;
      }
      return json(res, 200, { created });
    } catch(e) { return json(res, 500, { error: e.message }); }
  }

  res.writeHead(404); res.end('not found');
});

const serverReady = new Promise(resolve => {
  initDb().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      log(`Meetintel running at http://0.0.0.0:${PORT}`);
      resolve();
    });
  });
});

module.exports = { serverReady };
