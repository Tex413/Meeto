// Runs Whisper transcription and MiniLM embedding off the main thread, so the
// rest of the server (answering a "Meeteor" question, the ticker, SSE) stays
// responsive while a CPU-bound inference job is running. One dedicated worker,
// not a pool — a single Whisper inference already uses onnxruntime-node's
// internal multi-threading, so running two at once would contend for cores
// rather than parallelize. The win here is not blocking the main thread, not
// concurrency. See server.js's runInWorker() for the main-thread side.
const { parentPort, workerData } = require('worker_threads');

const MODELS_DIR = workerData.modelsDir;

let _tf = null;
async function getTransformers() {
  if (_tf) return _tf;
  _tf = await import('@xenova/transformers');
  _tf.env.cacheDir = MODELS_DIR;
  _tf.env.allowRemoteModels = true;
  return _tf;
}

// Quantized (int8) — was fp32 before this moved off the main thread, which was
// most of the real transcription latency. The embedder was already quantized.
let _whisper = null;
async function getWhisper() {
  if (_whisper) return _whisper;
  const { pipeline } = await getTransformers();
  _whisper = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', { quantized: true });
  return _whisper;
}

let _embedder = null;
async function getEmbedder() {
  if (_embedder) return _embedder;
  const { pipeline } = await getTransformers();
  _embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  return _embedder;
}
async function computeEmbedding(text) {
  const e = await getEmbedder();
  const out = await e(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

async function handleJob(job) {
  if (job.type === 'transcribe') {
    const whisper = await getWhisper();
    const { audioData, sampleRate } = job.payload;
    const result = await whisper(audioData, { sampling_rate: sampleRate });
    return { text: result.text || '' };
  }
  if (job.type === 'embed') {
    return { embedding: await computeEmbedding(job.payload.text) };
  }
  throw new Error('Unknown job type: ' + job.type);
}

parentPort.on('message', async job => {
  try {
    const result = await handleJob(job);
    parentPort.postMessage({ id: job.id, result });
  } catch(e) {
    parentPort.postMessage({ id: job.id, error: e.message });
  }
});

// Warm both models at startup so the first real job isn't slowed by a cold load
// (mirrors the pre-warm that used to happen inline on the main thread).
(async () => {
  try {
    await getWhisper();
    await getEmbedder();
    parentPort.postMessage({ type: 'ready' });
  } catch(e) {
    parentPort.postMessage({ type: 'ready-error', error: e.message });
  }
})();
