'use strict';
// Smoke test for inference-worker.js: runs the real worker with a models dir, sends it
// a 16-bit PCM WAV through the worker's own job protocol, and checks the transcript
// and a MiniLM embedding. Usage: node scripts/smoke-inference.js <modelsDir> <wav> <keyword>[,<keyword>...]
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 300000;
const TARGET_RATE = 16000;

function fail(msg) {
  console.error('SMOKE FAIL: ' + msg);
  process.exit(1);
}

// Minimal RIFF reader: 16-bit PCM, any channel count, mixed to mono and resampled to 16 kHz.
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') fail('not a WAV file');
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') data = buf.subarray(body, Math.min(body + size, buf.length));
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) fail('WAV missing fmt or data chunk');
  if (fmt.format !== 1 || fmt.bits !== 16) fail('WAV must be 16-bit PCM');
  const frames = Math.floor(data.length / 2 / fmt.channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((i * fmt.channels + c) * 2);
    mono[i] = sum / fmt.channels / 32768;
  }
  const outLen = Math.floor(frames * TARGET_RATE / fmt.rate);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * fmt.rate / TARGET_RATE;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, frames - 1);
    out[i] = mono[i0] + (mono[i1] - mono[i0]) * (src - i0);
  }
  return out;
}

const [modelsDir, wavFile, keywordArg] = process.argv.slice(2);
if (!modelsDir || !wavFile || !keywordArg) fail('usage: smoke-inference.js <modelsDir> <wav> <keyword,...>');
const keywords = keywordArg.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
const audioData = readWav(wavFile);

const worker = new Worker(path.join(__dirname, '..', 'inference-worker.js'), {
  workerData: { modelsDir: path.resolve(modelsDir) },
});
const timer = setTimeout(() => fail('timed out after ' + TIMEOUT_MS + ' ms'), TIMEOUT_MS);
const pending = new Map();
let nextId = 1;

function runJob(type, payload) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

worker.on('error', e => fail('worker crashed: ' + e.message));
worker.on('message', msg => {
  if (msg.type === 'ready-error') return fail('model init failed: ' + msg.error);
  if (msg.type === 'ready') return onReady().catch(e => fail(e.message));
  const job = pending.get(msg.id);
  if (!job) return;
  pending.delete(msg.id);
  if (msg.error) job.reject(new Error(msg.error));
  else job.resolve(msg.result);
});

async function onReady() {
  const { text } = await runJob('transcribe', { audioData, sampleRate: TARGET_RATE });
  console.log('transcript: ' + text.trim());
  const lower = text.toLowerCase();
  const missing = keywords.filter(k => !lower.includes(k));
  if (missing.length) fail('transcript missing keywords: ' + missing.join(', '));

  const { embedding } = await runJob('embed', { text: 'Quarterly planning meeting' });
  if (embedding.length !== 384) fail('embedding length ' + embedding.length + ', expected 384');
  if (!embedding.every(Number.isFinite)) fail('embedding has non-finite values');
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (Math.abs(norm - 1) > 0.01) fail('embedding norm ' + norm + ', expected about 1');

  console.log('SMOKE OK: transcript keywords found, embedding 384 finite, norm ' + norm.toFixed(4));
  clearTimeout(timer);
  process.exit(0);
}
