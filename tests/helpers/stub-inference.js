'use strict';

// Test preload (node --require): replaces the model worker so server.js runs without
// downloading or running Whisper. A transcribe job answers after STUB_TRANSCRIBE_MS.
const { EventEmitter } = require('node:events');
const workerThreads = require('node:worker_threads');

const DELAY_MS = Number(process.env.STUB_TRANSCRIBE_MS || 0);

workerThreads.Worker = class StubWorker extends EventEmitter {
  postMessage({ id }) {
    setTimeout(() => this.emit('message', { id, result: { text: 'stub spoken words' } }), DELAY_MS);
  }
};
