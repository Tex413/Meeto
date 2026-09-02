const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// ── Version / build ──────────────────────────────────────────
// Bump BUILD on every deploy so you can confirm in the UI that fresh code
// is actually being served (visible in the debug log and at /version).
const VERSION = '2.1.0';
const BUILD = 10;
const STARTED = new Date().toISOString();

const PORT = parseInt(process.env.PORT || '7432');
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_HTTPS = PUBLIC_URL.startsWith('https://');
// Desktop (Electron) mode: single local user, no login/registration. Set by main.js.
// When off (hosted/web demo), all the multi-user/auth behavior is unchanged.
const DESKTOP_MODE = process.env.DESKTOP_MODE === '1';
// Unpackaged dev build (set by main.js): bypass license gates for local testing.
const DESKTOP_DEV = process.env.DESKTOP_DEV === '1';
let LOCAL_USER_ID = 1; // resolved during initDb when DESKTOP_MODE is on
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'meetintel.sqlite');
const DOCS_DIR = path.join(DATA_DIR, 'documents');
const MODELS_DIR = path.join(DATA_DIR, 'models');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const LOG_FILE = path.join(DATA_DIR, 'meetintel.log');
const ENV_FILE = path.join(DATA_DIR, '.env');

const TRIAL_SECONDS = 20 * 60;
const TRIAL_MAX_DOCS = 2;
const TRIAL_DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

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

  // Shared cache for researched/fetched info (EIA commodity prices, energy news,
  // stock quotes now; later the meeting-scoped competitor-research agent reuses
  // this with scope='meeting' instead of its own table).
  db.run(`CREATE TABLE IF NOT EXISTS intel_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    meeting_id INTEGER,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT,
    fetched_at TEXT NOT NULL,
    expires_at TEXT
  )`);

  // migrations for existing DBs
  const migrate = sql => { try { db.run(sql); } catch(e) {} };
  migrate('ALTER TABLE meetings ADD COLUMN user_id INTEGER DEFAULT 1');
  migrate('ALTER TABLE documents ADD COLUMN user_id INTEGER DEFAULT 1');
  migrate('ALTER TABLE meetings ADD COLUMN todos TEXT');
  migrate('ALTER TABLE cards ADD COLUMN pinned INTEGER DEFAULT 0');
  migrate('ALTER TABLE cards ADD COLUMN deleted INTEGER DEFAULT 0');
  migrate('ALTER TABLE users ADD COLUMN reset_token TEXT');
  migrate('ALTER TABLE users ADD COLUMN reset_expires TEXT');
  // Desktop A/V recording: local file under DATA_DIR/recordings, referenced by name.
  migrate('ALTER TABLE meetings ADD COLUMN recording_path TEXT');
  // BYOK key for EIA.gov Open Data API (market prices) — same shape as the openai/anthropic keys.
  migrate('ALTER TABLE user_settings ADD COLUMN eia_api_key TEXT');

  // Data fix: an Anthropic key (sk-ant-) saved in the OpenAI slot breaks
  // Whisper transcription and confuses provider routing. Normalize it.
  migrate(`UPDATE user_settings SET anthropic_key = openai_key WHERE (anthropic_key IS NULL OR anthropic_key = '') AND openai_key LIKE 'sk-ant-%'`);
  migrate(`UPDATE user_settings SET ai_provider = 'anthropic' WHERE ai_provider = 'openai' AND anthropic_key LIKE 'sk-ant-%'`);
  migrate(`UPDATE user_settings SET ai_model = 'claude-sonnet-4-6' WHERE ai_provider = 'anthropic' AND (ai_model IS NULL OR ai_model LIKE 'gpt%' OR ai_model LIKE 'o1%' OR ai_model LIKE 'o3%')`);
  migrate(`UPDATE user_settings SET openai_key = NULL WHERE openai_key LIKE 'sk-ant-%'`);

  // Desktop mode: ensure a single local user exists and is fully unlocked.
  // (Phase 2 will gate this behind an Ed25519 license; for now it's open so the
  // app is usable while the desktop build comes together.)
  if (DESKTOP_MODE) {
    let u = dbGet(`SELECT id FROM users WHERE email = 'local@desktop'`);
    if (!u) {
      db.run(`INSERT INTO users (email, pwd_hash, created_at, tier) VALUES ('local@desktop', '-', '${new Date().toISOString()}', 'paid')`);
      u = dbGet(`SELECT id FROM users WHERE email = 'local@desktop'`);
    }
    LOCAL_USER_ID = u.id;
    loadLicense();
    log('Desktop mode: single local user id', LOCAL_USER_ID, '— licensed:', !!_license);
  }

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

// ── local-only recording control (Stream Deck / MCP) ─────────────
// Deliberately unauthenticated: this only ever lets a process on the SAME machine tell an
// already-open, already-logged-in browser tab to start/stop listening. It is not reachable from
// Meeto's hosted multi-user service - isLoopback() is the trust boundary, not a session cookie.
const localEventClients = new Set();
function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
function broadcastLocalEvent(eventName) {
  const payload = `event: ${eventName}\ndata: {}\n\n`;
  for (const clientRes of localEventClients) {
    try { clientRes.write(payload); } catch (e) { localEventClients.delete(clientRes); }
  }
}

function hashPwd(pwd) {
  return crypto.createHash('sha256').update('meeto-v1:' + pwd).digest('hex');
}
function makeToken(userId) {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, { userId, expiry: Date.now() + SESSION_MS });
  return t;
}
function checkToken(req) {
  if (DESKTOP_MODE) return LOCAL_USER_ID;  // single local user — no auth in the desktop app
  const m = (req.headers.cookie || '').match(/meetintel_sid=([a-f0-9]{64})/);
  const token = m ? m[1] : (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || Date.now() > s.expiry) { sessions.delete(token); return null; }
  s.expiry = Date.now() + SESSION_MS;
  return s.userId;
}
// Secure flag must follow the ACTUAL request protocol, not PUBLIC_URL.
// Behind Cloudflare the request arrives with X-Forwarded-Proto: https; a
// direct http://localhost hit has none. Marking the cookie Secure on a plain
// HTTP request makes the browser silently drop it → login bounces forever.
function reqIsHttps(req) {
  const xfp = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (xfp) return xfp === 'https';
  return !!(req.connection && req.connection.encrypted);
}
function setSessionCookie(res, token, req) {
  const secure = reqIsHttps(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `meetintel_sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}${secure}`);
}
function clearSessionCookie(res, req) {
  const secure = reqIsHttps(req) ? '; Secure' : '';
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

// Run one LLM completion through the user's configured provider/key.
// Returns assistant text, or null on any failure (caller falls back gracefully).
// Forces a cheap model for cost control unless the user already runs a cheap one.
async function llmComplete(userId, { system, messages, max_tokens = 512 }) {
  const s = dbGet(`SELECT ai_provider, ai_model, anthropic_key, openai_key FROM user_settings WHERE user_id = ${userId}`);
  if (!s) return null;
  const provider = s.ai_provider || 'openai';
  const body = JSON.stringify({ system, messages, max_tokens });
  const CHEAP_ANTHROPIC = 'claude-haiku-4-5-20251001', CHEAP_OPENAI = 'gpt-4o-mini';
  try {
    const useAnthropic = provider === 'anthropic' || (s.openai_key || '').startsWith('sk-ant-');
    if (useAnthropic) {
      const key = provider === 'anthropic' ? s.anthropic_key : s.openai_key;
      if (!key) return null;
      const parsed = JSON.parse(body); parsed.model = CHEAP_ANTHROPIC;
      const r = await proxyAnthropic(JSON.stringify(parsed), key);
      if (r.status !== 200) return null;
      return JSON.parse(r.body)?.content?.[0]?.text || null;
    } else {
      if (!s.openai_key) return null;
      const r = await proxyOpenAI(body, s.openai_key, CHEAP_OPENAI);
      if (r.status !== 200) return null;
      return JSON.parse(r.body)?.content?.[0]?.text || null;
    }
  } catch { return null; }
}

// ── Local AI models (Transformers.js, fully offline after first download) ──
// Models are cached in the persistent ./data volume so they download once.
let _tf = null;
async function getTransformers() {
  if (_tf) return _tf;
  _tf = await import('@xenova/transformers');
  _tf.env.cacheDir = MODELS_DIR;
  _tf.env.allowRemoteModels = true;
  return _tf;
}

// ── Local Whisper STT (no API key, no per-use cost) ────────────
let _whisper = null, _whisperLoading = false;
async function getWhisper() {
  if (_whisper) return _whisper;
  if (_whisperLoading) {
    await new Promise(resolve => { const t = setInterval(() => { if (!_whisperLoading) { clearInterval(t); resolve(); } }, 200); });
    return _whisper;
  }
  _whisperLoading = true;
  log('Loading Whisper model (first run downloads ~150 MB, then cached)…');
  try {
    const { pipeline } = await getTransformers();
    _whisper = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
    log('Whisper model ready.');
  } finally { _whisperLoading = false; }
  return _whisper;
}

// ── domain vocabulary correction ("grammar file" for Whisper) ──
// Whisper base.en mishears proper nouns/jargon (e.g. "Palantir" -> "palamis").
// We derive a lexicon from the user's context + docs and fuzzy-correct the
// transcript toward it. Local, free, high-precision (conservative thresholds);
// the LLM refine pass handles the rest. See client: context sent to /transcribe.
const STT_COMMON_WORDS = new Set(('the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did going got me my your our their here say said go do done very really kind sort thing things lot okay yeah yes no maybe gonna wanna got let going need').split(' '));

function sttSoundex(s) {
  s = s.toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';
  const codes = { B:1,F:1,P:1,V:1, C:2,G:2,J:2,K:2,Q:2,S:2,X:2,Z:2, D:3,T:3, L:4, M:5,N:5, R:6 };
  let out = s[0], prev = codes[s[0]] || 0;
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = codes[s[i]] || 0;
    if (c && c !== prev) out += c;
    if (s[i] !== 'H' && s[i] !== 'W') prev = c;
  }
  return (out + '000').slice(0, 4);
}
function sttLeven(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
// Build a lexicon of {disp, lc, sx} from context text.
function buildSttLexicon(context) {
  if (!context || typeof context !== 'string') return [];
  const tokens = context.match(/[A-Za-z][A-Za-z'&./-]*[A-Za-z]|[A-Z]{2,}/g) || [];
  const byLc = new Map();
  for (const w of tokens) {
    const lc = w.toLowerCase();
    const isAcronym = w.length >= 2 && w.length <= 6 && w === w.toUpperCase() && /[A-Z]/.test(w);
    if (!isAcronym && (lc.length < 4 || STT_COMMON_WORDS.has(lc))) continue;
    // prefer a capitalized/acronym display form if we see one
    const existing = byLc.get(lc);
    const better = !existing || (w[0] === w[0].toUpperCase() && existing.disp[0] !== existing.disp[0].toUpperCase());
    if (better) byLc.set(lc, { disp: w, lc, sx: sttSoundex(lc) });
  }
  return [...byLc.values()];
}
// Correct a transcript word-by-word against the lexicon. Conservative.
function correctTranscript(text, context) {
  if (!text || !context) return text;
  const lex = buildSttLexicon(context);
  if (!lex.length) return text;
  return text.replace(/[A-Za-z][A-Za-z'-]*/g, (tok) => {
    const lc = tok.toLowerCase();
    if (lc.length < 4 || STT_COMMON_WORDS.has(lc)) return tok;
    const sx = sttSoundex(lc);
    let best = null, bestD = Infinity;
    for (const v of lex) {
      if (v.lc === lc) return v.disp;                     // exact -> normalize casing
      if (lc[0] !== v.lc[0]) continue;                    // anchor on first letter
      if (Math.abs(v.lc.length - lc.length) > 3) continue;
      const d = sttLeven(lc, v.lc);
      const phonetic = v.sx.slice(0, 3) === sx.slice(0, 3); // strong phonetic anchor
      // phonetic match -> tolerate more edits; otherwise only fix 1-char typos
      const thr = phonetic ? Math.max(2, Math.round(v.lc.length * 0.45)) : 1;
      if (d <= thr && d < bestD) { best = v; bestD = d; }
    }
    return best ? best.disp : tok;
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
    const { pipeline } = await getTransformers();
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

// ── Ed25519 desktop license (offline-verifiable; unforgeable) ──────
// Keys are minted by the owner with the PRIVATE key (tools/sign-license.js);
// the app verifies with this embedded PUBLIC key. Format:
//   MEETINTEL2-<payloadB64url>.<ed25519SigB64url>
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAx2WzvIFxDl4HTErb8FJTlzLnP0cbB2KMd5K5S3N4IOM=
-----END PUBLIC KEY-----`;
const LICENSE_FILE = path.join(DATA_DIR, 'license.key');
let _license = null; // cached verified payload (desktop only)

function verifyLicenseV2(key) {
  try {
    const m = (key || '').trim().match(/^MEETINTEL2-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    const [, payloadB64, sigB64] = m;
    const ok = crypto.verify(null, Buffer.from(payloadB64),
      crypto.createPublicKey(LICENSE_PUBLIC_KEY), Buffer.from(sigB64, 'base64url'));
    if (!ok) return null;
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch(e) { return null; }
}
function loadLicense() {
  try { if (fs.existsSync(LICENSE_FILE)) _license = verifyLicenseV2(fs.readFileSync(LICENSE_FILE, 'utf8')); }
  catch(e) { _license = null; }
  return _license;
}
// Hosted/web mode is never license-gated (it uses the trial system). Desktop is,
// except in an unpackaged dev build (DESKTOP_DEV) so the app is testable locally.
function isLicensed() { return (DESKTOP_MODE && !DESKTOP_DEV) ? !!(_license || loadLicense()) : true; }

// ── Intel ticker: EIA market prices, energy news, stock quotes ──
// All results land in intel_cache (scope='global' for the standing boardroom
// ticker; the later meeting-scoped research agent will use scope='meeting').
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.end();
  });
}
function cacheGet(scope, category, key) {
  const row = dbGet(`SELECT payload, expires_at FROM intel_cache WHERE scope=? AND category=? AND key=? ORDER BY fetched_at DESC LIMIT 1`, [scope, category, key]);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  try { return JSON.parse(row.payload); } catch(e) { return null; }
}
function cacheGetAll(scope, category) {
  // Latest row per key (rows come back newest-first, so the first hit per key wins).
  const r = db.exec(`SELECT key, payload, fetched_at FROM intel_cache WHERE scope='${scope}' AND category='${category}' ORDER BY fetched_at DESC`);
  const out = {};
  if (!r.length) return out;
  for (const [key, payload, fetched_at] of r[0].values) {
    if (out[key]) continue;
    try { out[key] = { ...JSON.parse(payload), fetchedAt: fetched_at }; } catch(e) {}
  }
  return out;
}
function cacheSet(scope, category, key, payload, source, ttlMs) {
  const now = new Date();
  const expires = ttlMs ? new Date(now.getTime() + ttlMs).toISOString() : null;
  const stmt = db.prepare('INSERT INTO intel_cache (scope, meeting_id, category, key, payload, source, fetched_at, expires_at) VALUES (?,?,?,?,?,?,?,?)');
  stmt.run([scope, null, category, key, JSON.stringify(payload), source || null, now.toISOString(), expires]);
  stmt.free();
  saveDb();
}
function getEiaApiKey(userId) {
  const s = dbGet(`SELECT eia_api_key FROM user_settings WHERE user_id = ${userId}`);
  return (s && s.eia_api_key) ? s.eia_api_key : (loadEnvVar('EIA_API_KEY') || 'DEMO_KEY');
}

// Direct-from-EIA markets (endpoint/series), plus differential-estimate markets computed
// from them. Ported from a sibling app's CommodityPriceService.cs/CommodityMarkets.cs —
// same offsets/multipliers, since those were themselves tuned estimates, not derived here.
const EIA_MARKETS = {
  WTI:         { name: 'WTI Crude',            category: 'Oil', unit: '$/bbl', eiaEndpoint: 'petroleum/pri/spt',    eiaSeries: 'RWTC' },
  BRENT:       { name: 'Brent Crude',          category: 'Oil', unit: '$/bbl', eiaEndpoint: 'petroleum/pri/spt',    eiaSeries: 'RBRTE' },
  HENRY_HUB:   { name: 'Henry Hub',            category: 'Gas', unit: '$/MCF', eiaEndpoint: 'natural-gas/pri/fut',  eiaSeries: 'RNGC1' },
  WTI_MIDLAND: { name: 'WTI Midland',          category: 'Oil', unit: '$/bbl', estimate: b => b.wti   != null ? b.wti - 1.50 : null },
  LLS:         { name: 'Louisiana Light Sweet',category: 'Oil', unit: '$/bbl', estimate: b => b.brent != null ? b.brent - 0.50 : (b.wti != null ? b.wti + 1.00 : null) },
  ANS:         { name: 'ANS (Alaska)',         category: 'Oil', unit: '$/bbl', estimate: b => b.wti   != null ? b.wti + 2.00 : null },
  MARS:        { name: 'Mars Blend',           category: 'Oil', unit: '$/bbl', estimate: b => b.wti   != null ? b.wti - 4.00 : null },
  WAHA:        { name: 'Waha Hub',             category: 'Gas', unit: '$/MCF', estimate: b => b.hh    != null ? b.hh * 0.72 : null },
  PERMIAN_GAS: { name: 'Permian/El Paso',      category: 'Gas', unit: '$/MCF', estimate: b => b.hh    != null ? b.hh * 0.78 : null },
  SOCAL:       { name: 'SoCal Gas',            category: 'Gas', unit: '$/MCF', estimate: b => b.hh    != null ? b.hh * 0.88 : null },
  CHICAGO:     { name: 'Chicago Citygate',     category: 'Gas', unit: '$/MCF', estimate: b => b.hh    != null ? b.hh * 1.03 : null },
  DOMINION:    { name: 'Dominion South',       category: 'Gas', unit: '$/MCF', estimate: b => b.hh    != null ? b.hh * 0.62 : null },
  NGL_CONWAY:  { name: 'NGL Conway',           category: 'NGL', unit: '$/gal', estimate: b => b.wti   != null ? b.wti * 0.45 / 42 : null },
  NGL_MB:      { name: 'NGL Mont Belvieu',     category: 'NGL', unit: '$/gal', estimate: b => b.wti   != null ? b.wti * 0.52 / 42 : null },
};
const EIA_TICKER_DEFAULTS = ['WTI', 'BRENT', 'HENRY_HUB', 'NGL_CONWAY'];

async function fetchEiaSeries(apiKey, endpoint, series) {
  const url = `https://api.eia.gov/v2/${endpoint}/data/?api_key=${encodeURIComponent(apiKey)}`
    + `&frequency=daily&data[]=value&facets[series][]=${series}`
    + `&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=10`;
  const { status, body } = await httpsGet(url);
  if (status !== 200) throw new Error('EIA HTTP ' + status);
  const rows = JSON.parse(body)?.response?.data || [];
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    const n = typeof row.value === 'number' ? row.value : parseFloat(row.value);
    if (!isNaN(n)) return n;
  }
  return null;
}

async function refreshMarketPrices(force, apiKey) {
  const last = dbGet(`SELECT fetched_at FROM intel_cache WHERE scope='global' AND category='commodity_price' ORDER BY fetched_at DESC LIMIT 1`);
  if (!force && last && (Date.now() - new Date(last.fetched_at).getTime()) < 4 * 60 * 60 * 1000) return;

  let wti = null, brent = null, hh = null;
  try { wti = await fetchEiaSeries(apiKey, 'petroleum/pri/spt', 'RWTC'); } catch(e) { log('EIA WTI fetch failed:', e.message); }
  try { brent = await fetchEiaSeries(apiKey, 'petroleum/pri/spt', 'RBRTE'); } catch(e) { log('EIA Brent fetch failed:', e.message); }
  try { const raw = await fetchEiaSeries(apiKey, 'natural-gas/pri/fut', 'RNGC1'); hh = raw != null ? raw * 1.02 : null; } catch(e) { log('EIA Henry Hub fetch failed:', e.message); }
  if (wti == null && brent == null && hh == null) { log('EIA: no prices retrieved, skipping refresh'); return; }

  const base = { wti, brent, hh };
  const direct = { WTI: wti, BRENT: brent, HENRY_HUB: hh };
  for (const code of Object.keys(EIA_MARKETS)) {
    const def = EIA_MARKETS[code];
    const price = (code in direct) ? direct[code] : (def.estimate ? def.estimate(base) : null);
    if (price == null) continue;
    const source = (code in direct) ? 'eia_api' : 'estimate';
    cacheSet('global', 'commodity_price', code, {
      code, name: def.name, category: def.category, unit: def.unit,
      price: Math.round(price * 10000) / 10000, source
    }, source, null);
  }
  log(`EIA market prices refreshed: WTI=${wti} Brent=${brent} HH=${hh}`);
}

// Energy news: merge a few RSS feeds (regex-based item extraction — simple enough
// XML that a real parser dependency isn't worth adding for three feeds).
const ENERGY_NEWS_FEEDS = [
  'https://www.eia.gov/rss/todayinenergy.xml',
  'https://oilprice.com/rss/main',
  'https://www.rigzone.com/news/rss/rigzone_latest.aspx'
];
function parseRssItems(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const grab = tag => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim() : '';
    };
    const title = grab('title');
    if (title) items.push({ title, link: grab('link'), date: grab('pubDate') });
  }
  return items;
}
async function fetchEnergyNews() {
  const items = [];
  for (const url of ENERGY_NEWS_FEEDS) {
    if (items.length >= 10) break;
    try {
      const { status, body } = await httpsGet(url, { 'User-Agent': 'Meetintel/1.0 (board-member energy ticker)' });
      if (status !== 200) continue;
      items.push(...parseRssItems(body).slice(0, 6));
    } catch(e) { log('Energy news feed failed:', url, e.message); }
  }
  return items.slice(0, 10);
}

// Stock quotes: Yahoo Finance's unofficial chart endpoint needs no API key, so the
// BKV badge works out of the box — but it's undocumented and can change/rate-limit
// without notice. Swapping in a real provider (Finnhub/Bloomberg/etc.) is Phase 4 work.
async function fetchStockQuote(symbol) {
  const { status, body } = await httpsGet(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
    { 'User-Agent': 'Mozilla/5.0' }
  );
  if (status !== 200) throw new Error('Yahoo Finance HTTP ' + status);
  const meta = JSON.parse(body)?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error('No quote data for ' + symbol);
  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const change = prevClose != null ? price - prevClose : null;
  const changePercent = (prevClose) ? (change / prevClose) * 100 : null;
  return { symbol, price, change, changePercent, asOf: new Date().toISOString() };
}
async function refreshStockPrice(symbol) {
  try {
    const quote = await fetchStockQuote(symbol);
    cacheSet('global', 'stock', symbol, quote, 'yahoo_unofficial', null);
    log(`Stock price refreshed: ${symbol} $${quote.price}`);
  } catch(e) { log(`Stock price fetch failed for ${symbol}:`, e.message); }
}

// ── server ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const skipLog = ['/auth/status', '/'].includes(url) || url.startsWith('/static');
  if (!skipLog) log(`${req.method} ${url}`);
  if (req.method === 'GET' && url === '/landing') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8'));
  }

  if (req.method === 'GET' && url === '/auth/status') {
    const userId = checkToken(req);
    return json(res, 200, { authenticated: !!userId });
  }

  if (req.method === 'GET' && url === '/version') {
    return json(res, 200, { version: VERSION, build: BUILD, started: STARTED });
  }

  // License status (public so the activation page can read it). Web mode is
  // always "licensed" (trial system handles access there).
  if (req.method === 'GET' && url === '/license/status') {
    if (!DESKTOP_MODE) return json(res, 200, { licensed: true, mode: 'web' });
    const lic = _license || loadLicense();
    return json(res, 200, lic
      ? { licensed: true, plan: lic.plan, email: lic.email || null, updatesUntil: lic.updatesUntil || null }
      : { licensed: false });
  }

  // Activate a desktop license (public in desktop mode; verifies Ed25519, stores it).
  if (req.method === 'POST' && url === '/license/activate' && DESKTOP_MODE) {
    const body = JSON.parse(await readBody(req));
    const lic = verifyLicenseV2(body.key || '');
    if (!lic) return json(res, 400, { error: 'Invalid or unrecognized license key.' });
    try { fs.writeFileSync(LICENSE_FILE, (body.key || '').trim()); } catch(e) { return json(res, 500, { error: 'Could not save license.' }); }
    _license = lic;
    log('Desktop license activated:', lic.plan, lic.email || '');
    return json(res, 200, { ok: true, plan: lic.plan });
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
    setSessionCookie(res, token, req);
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
    setSessionCookie(res, token, req);
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
    clearSessionCookie(res, req);
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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

  // ── local-only recording control (Stream Deck / MCP) - public, but loopback-only ─────
  if (url === '/api/local/events' && req.method === 'GET') {
    if (!isLoopback(req)) { res.writeHead(403); return res.end('forbidden'); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    localEventClients.add(res);
    req.on('close', () => localEventClients.delete(res));
    return;
  }

  if (url === '/api/local/start-recording' && req.method === 'POST') {
    if (!isLoopback(req)) return json(res, 403, { error: 'forbidden' });
    broadcastLocalEvent('start-recording');
    // listeners tells the caller whether any open tab actually received this - the broadcast
    // is fire-and-forget, so `ok: true` alone can't distinguish "a tab is listening" from
    // "the server is up but nothing is open to hear it".
    return json(res, 200, { ok: true, listeners: localEventClients.size });
  }

  if (url === '/api/local/stop-recording' && req.method === 'POST') {
    if (!isLoopback(req)) return json(res, 403, { error: 'forbidden' });
    broadcastLocalEvent('stop-recording');
    return json(res, 200, { ok: true, listeners: localEventClients.size });
  }

  // ── main app ─────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/') {
    const htmlHdr = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, must-revalidate' };
    // Desktop, unlicensed → activation page (the free trial lives on the web demo).
    if (DESKTOP_MODE && !isLicensed()) {
      res.writeHead(200, htmlHdr);
      return res.end(fs.readFileSync(path.join(__dirname, 'activate.html'), 'utf8').replace(/__BUILD__/g, BUILD));
    }
    if (!checkToken(req)) {
      res.writeHead(200, htmlHdr);
      return res.end(fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8').replace(/__BUILD__/g, BUILD));
    }
    res.writeHead(200, htmlHdr);
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
      .replace(/__BUILD__/g, `${VERSION} build ${BUILD}`)
      .replace(/__DESKTOP__/g, DESKTOP_MODE ? '1' : '0'));
  }

  // ── all routes below require auth ────────────────────────────
  const userId = checkToken(req);
  if (!userId) return json(res, 401, { error: 'Unauthorized' });

  const user = dbGet(`SELECT * FROM users WHERE id = ${userId}`);
  if (!user) return json(res, 401, { error: 'User not found' });

  // ── admin ────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
    const s = dbGet(`SELECT ai_provider, ai_model, anthropic_key, openai_key, eia_api_key FROM user_settings WHERE user_id = ${userId}`);
    const ts = trialStatus(user);
    return json(res, 200, {
      provider: s?.ai_provider || 'openai',
      model: s?.ai_model || 'gpt-4o',
      hasAnthropicKey: !!(s?.anthropic_key) || (s?.openai_key || '').startsWith('sk-ant-'),
      hasOpenaiKey: isRealOpenAIKey(s?.openai_key),
      hasEiaKey: !!(s?.eia_api_key),
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
    if (body.eiaApiKey) updates.push(`eia_api_key = '${body.eiaApiKey.trim().replace(/'/g, "''")}'`);
    if (updates.length) { db.run(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ${userId}`); saveDb(); }
    return json(res, 200, { ok: true });
  }

  // ── Intel ticker: EIA market prices, energy news, stock quotes ─
  if (req.method === 'GET' && url === '/api/market-prices') {
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
    const latest = cacheGetAll('global', 'commodity_price');
    const markets = EIA_TICKER_DEFAULTS.map(code => latest[code] || {
      code, name: EIA_MARKETS[code].name, unit: EIA_MARKETS[code].unit, price: null
    });
    return json(res, 200, { markets });
  }

  if (req.method === 'POST' && url === '/api/market-prices/refresh') {
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
    try { await refreshMarketPrices(true, getEiaApiKey(userId)); return json(res, 200, { ok: true }); }
    catch(e) { return json(res, 500, { error: e.message }); }
  }

  if (req.method === 'GET' && url === '/api/energy-news') {
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
    let cached = cacheGet('global', 'news', 'energy_headlines');
    if (!cached) {
      cached = { items: await fetchEnergyNews() };
      cacheSet('global', 'news', 'energy_headlines', cached, 'rss', 15 * 60 * 1000);
    }
    return json(res, 200, cached);
  }

  // Compact, cache-only snapshot for the insight-card LLM prompt — no network
  // call here, just formats whatever's already in intel_cache, so it's cheap
  // to call on every analysis cycle. This is what lets the board member give a
  // real, current-as-of BKV price/commodity numbers instead of guessing.
  if (req.method === 'GET' && url === '/api/intel-snapshot') {
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
    const markets = cacheGetAll('global', 'commodity_price');
    const parts = [];
    const bkv = cacheGet('global', 'stock', 'BKV');
    if (bkv && bkv.price != null) {
      const pct = bkv.changePercent;
      parts.push(`BKV Corp stock $${bkv.price.toFixed(2)}${pct != null ? ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)' : ''}`);
    }
    for (const code of EIA_TICKER_DEFAULTS) {
      const m = markets[code];
      if (!m || m.price == null) continue;
      parts.push(`${m.name} $${Number(m.price).toFixed(2)}${m.unit ? '/' + m.unit.replace('$/', '') : ''}`);
    }
    return json(res, 200, { text: parts.join(' · '), asOf: new Date().toISOString() });
  }

  if (req.method === 'GET' && url.startsWith('/api/stock-price/')) {
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
    const symbol = decodeURIComponent(url.split('/')[3] || 'BKV').toUpperCase();
    const cached = cacheGet('global', 'stock', symbol);
    if (cached) return json(res, 200, cached);
    try {
      const quote = await fetchStockQuote(symbol);
      cacheSet('global', 'stock', symbol, quote, 'yahoo_unofficial', null);
      return json(res, 200, quote);
    } catch(e) { return json(res, 500, { error: e.message }); }
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

  // Replace just the transcript (used when generating it from a recording —
  // does NOT touch total_cards/ended_at so it won't clobber existing meeting data).
  if (req.method === 'POST' && url === '/meeting/transcript') {
    const body = JSON.parse(await readBody(req));
    db.run(`UPDATE meetings SET transcript=?, word_count=? WHERE id=? AND user_id=${userId}`,
      [body.transcript || '', body.wordCount || 0, body.id]);
    saveDb(); return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/meeting/end') {
    const body = JSON.parse(await readBody(req));
    db.run(`UPDATE meetings SET transcript=?, word_count=?, total_cards=?, ended_at=? WHERE id=? AND user_id=${userId}`,
      [body.transcript || '', body.wordCount || 0, body.totalCards || 0, new Date().toISOString(), body.id]);
    saveDb(); return json(res, 200, { ok: true });
  }

  // ── A/V recording (desktop only: large files stored on local disk) ──
  // Upload: streamed straight to disk so a long meeting never buffers in RAM.
  if (req.method === 'POST' && url === '/recording/upload') {
    if (!DESKTOP_MODE) return json(res, 404, { error: 'not_found' });
    if (!isLicensed()) return json(res, 402, { error: 'license_required' });
    const meetingId = parseInt(new URL(req.url, 'http://x').searchParams.get('meetingId') || '0');
    if (!meetingId) return json(res, 400, { error: 'missing meetingId' });
    const own = dbGet(`SELECT id FROM meetings WHERE id=${meetingId} AND user_id=${userId}`);
    if (!own) return json(res, 404, { error: 'meeting not found' });
    const filename = `meeting-${meetingId}.webm`;
    const dest = path.join(RECORDINGS_DIR, filename);
    const ws = fs.createWriteStream(dest);
    req.pipe(ws);
    ws.on('finish', () => {
      db.run(`UPDATE meetings SET recording_path=? WHERE id=${meetingId}`, [filename]);
      saveDb();
      let size = 0; try { size = fs.statSync(dest).size; } catch(e) {}
      log(`Recording saved: ${dest} (${Math.round(size/1024/1024*10)/10} MB)`);
      return json(res, 200, { ok: true, path: filename, bytes: size });
    });
    ws.on('error', e => { log('Recording write error:', e.message); try { json(res, 500, { error: e.message }); } catch(_) {} });
    req.on('error', e => { log('Recording upload req error:', e.message); ws.destroy(); });
    return;
  }

  // Stream a saved recording back to the player, with HTTP Range support so
  // the <video> element can seek without downloading the whole file.
  if (req.method === 'GET' && url.startsWith('/recording/')) {
    if (!DESKTOP_MODE) return json(res, 404, { error: 'not_found' });
    const id = parseInt(url.split('/')[2]);
    const row = dbGet(`SELECT recording_path FROM meetings WHERE id=${id} AND user_id=${userId}`);
    if (!row || !row.recording_path) return json(res, 404, { error: 'no recording' });
    const file = path.join(RECORDINGS_DIR, row.recording_path);
    if (!fs.existsSync(file)) return json(res, 404, { error: 'file missing' });
    const stat = fs.statSync(file);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      let start = m[1] ? parseInt(m[1]) : 0;
      let end = m[2] ? parseInt(m[2]) : stat.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, {
        'Content-Type': 'video/webm',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'POST' && url === '/card/save') {
    const body = JSON.parse(await readBody(req));
    const ids = [];
    const stmt = db.prepare(`INSERT INTO cards (meeting_id, captured_at, tag, title, body, transcript_snapshot) VALUES (?,?,?,?,?,?)`);
    body.cards.forEach(c => {
      stmt.run([body.meetingId, new Date().toISOString(), c.tag, c.title, c.body, body.transcriptSnapshot || '']);
      ids.push(db.exec('SELECT last_insert_rowid()')[0].values[0][0]); // map each card to its db id
    });
    stmt.free(); saveDb(); return json(res, 200, { ok: true, ids });
  }

  // Persist a card's pinned/deleted state, or a merged body (scoped to the user's own meetings).
  if (req.method === 'POST' && url === '/card/update') {
    const { id, pinned, deleted, body: cardBody } = JSON.parse(await readBody(req));
    const cid = parseInt(id);
    if (!cid) return json(res, 400, { error: 'bad id' });
    const own = dbGet(`SELECT c.id FROM cards c JOIN meetings m ON m.id = c.meeting_id WHERE c.id = ${cid} AND m.user_id = ${userId}`);
    if (!own) return json(res, 404, { error: 'not found' });
    const sets = [], params = [];
    if (pinned !== undefined) sets.push(`pinned = ${pinned ? 1 : 0}`);
    if (deleted !== undefined) sets.push(`deleted = ${deleted ? 1 : 0}`);
    if (cardBody !== undefined) { sets.push(`body = ?`); params.push(String(cardBody)); }
    if (sets.length) { db.run(`UPDATE cards SET ${sets.join(', ')} WHERE id = ${cid}`, params); saveDb(); }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/meetings') {
    const r = db.exec(`SELECT m.id, m.title, m.started_at, m.ended_at, m.word_count, m.total_cards, COUNT(c.id) as card_count FROM meetings m LEFT JOIN cards c ON c.meeting_id = m.id WHERE m.user_id=${userId} GROUP BY m.id ORDER BY m.started_at DESC`);
    const rows = r.length ? r[0].values.map(r => ({ id:r[0], title:r[1], started_at:r[2], ended_at:r[3], word_count:r[4], total_cards:r[5], card_count:r[6] })) : [];
    return json(res, 200, rows);
  }

  if (req.method === 'GET' && url.startsWith('/meeting/')) {
    const id = parseInt(url.split('/')[2]);
    const m = db.exec(`SELECT * FROM meetings WHERE id=${id} AND user_id=${userId}`);
    const c = db.exec(`SELECT * FROM cards WHERE meeting_id=${id} AND COALESCE(deleted,0)=0 ORDER BY COALESCE(pinned,0) DESC, captured_at ASC`);
    if (!m.length || !m[0].values.length) return json(res, 404, { error: 'Not found' });
    const meeting = {}; m[0].columns.forEach((col, i) => meeting[col] = m[0].values[0][i]);
    const cardCols = c.length ? c[0].columns : [];
    const cards = c.length ? c[0].values.map(r => { const card = {}; cardCols.forEach((col, i) => card[col] = r[i]); return card; }) : [];
    return json(res, 200, { meeting, cards });
  }

  if (req.method === 'DELETE' && url.startsWith('/meeting/')) {
    const id = parseInt(url.split('/')[2]);
    // Remove the recording file too (scoped to the user's own meeting).
    const own = dbGet(`SELECT recording_path FROM meetings WHERE id=${id} AND user_id=${userId}`);
    if (own && own.recording_path) {
      try { fs.unlinkSync(path.join(RECORDINGS_DIR, own.recording_path)); } catch(e) {}
    }
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
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
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

  // ── Transcription (local Whisper — offline, no API key, no per-use cost) ──
  if (req.method === 'POST' && url === '/transcribe') {
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
    const ts = trialStatus(user);
    if (!ts.ok) return json(res, 402, { error: 'trial_expired' });
    const body = JSON.parse(await readBody(req));
    const { audio, sampleRate = 16000, context = '' } = body;
    if (!audio || !audio.length) return json(res, 200, { text: '' });
    try {
      const whisper = await getWhisper();
      const buf = Buffer.from(audio, 'base64');
      // slice() copies bytes into a new ArrayBuffer at offset 0 — avoids Float32Array alignment error
      const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const audioData = new Float32Array(aligned);
      const audioSeconds = audioData.length / sampleRate;
      const result = await whisper(audioData, { sampling_rate: sampleRate });
      const raw = result.text || '';
      // local "grammar file": fuzzy-correct toward the user's domain vocabulary
      const text = correctTranscript(raw, context);
      if (text !== raw) log('Transcribe corrected: ' + JSON.stringify(raw) + ' → ' + JSON.stringify(text));
      log('Transcribe: ' + audioData.length + ' samples @ ' + sampleRate + ' Hz → ' + JSON.stringify(text));
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
      return json(res, 500, { error: 'transcription_failed', message: e.message });
    }
  }

  // LLM refine pass: clean up ASR errors using the context as a glossary.
  // Layered on top of the local vocabulary correction; uses a cheap model.
  if (req.method === 'POST' && url === '/transcribe/refine') {
    if (DESKTOP_MODE && !isLicensed()) return json(res, 402, { error: 'license_required' });
    const ts = trialStatus(user);
    if (!ts.ok) return json(res, 402, { error: 'trial_expired' });
    ensureUserSettings(userId);
    const { text = '', context = '' } = JSON.parse(await readBody(req));
    const wc = text.trim().split(/\s+/).filter(Boolean).length;
    if (wc < 4) return json(res, 200, { text });               // not worth a call
    const system = 'You fix speech-to-text transcription errors. Return ONLY the corrected transcript text, nothing else. '
      + 'Use the provided context as a glossary to fix misheard names, jargon, and acronyms. Preserve the speaker\'s exact '
      + 'wording, meaning, fillers and punctuation — do NOT summarize, rephrase, translate, answer, or add anything. '
      + 'If unsure about a word, leave it unchanged.';
    const userMsg = (context ? 'Context/glossary:\n' + context.slice(0, 4000) + '\n\n' : '')
      + 'Transcript to correct:\n' + text;
    const corrected = await llmComplete(userId, {
      system, messages: [{ role: 'user', content: userMsg }],
      max_tokens: Math.min(1024, Math.ceil(text.length / 2) + 64)
    });
    const out = (corrected && corrected.trim()) ? corrected.trim() : text;
    if (out !== text) log('Refine: ' + JSON.stringify(text) + ' → ' + JSON.stringify(out));
    return json(res, 200, { text: out });
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
      log(`Meetintel v${VERSION} build ${BUILD} running at http://0.0.0.0:${PORT}`);
      resolve();
      // Pre-warm the local Whisper model in the background so the first
      // transcription isn't blocked on a cold download/load.
      getWhisper().catch(e => log('Whisper pre-warm failed:', e.message));
      // Board-room ticker: EIA prices refresh every 4h, BKV stock every 5min.
      // Background jobs use the env-var/DEMO_KEY default (not tied to a request's user).
      setTimeout(() => refreshMarketPrices(false, loadEnvVar('EIA_API_KEY') || 'DEMO_KEY').catch(e => log('EIA prewarm failed:', e.message)), 30_000);
      setInterval(() => refreshMarketPrices(false, loadEnvVar('EIA_API_KEY') || 'DEMO_KEY').catch(e => log('EIA refresh failed:', e.message)), 4 * 60 * 60 * 1000);
      setTimeout(() => refreshStockPrice('BKV'), 35_000);
      setInterval(() => refreshStockPrice('BKV'), 5 * 60 * 1000);
    });
  });
});

module.exports = { serverReady };
