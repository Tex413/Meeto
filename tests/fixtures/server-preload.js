'use strict';

// Preloaded into a real server.js child process: fakes the Whisper worker and refuses real outbound HTTPS.
const { EventEmitter } = require('node:events');
const workerThreads = require('node:worker_threads');
const https = require('node:https');

class FakeWorker extends EventEmitter {
  postMessage({ id, type }) {
    const result = type === 'transcribe' ? { text: process.env.FAKE_TRANSCRIPT || '' } : { embedding: [] };
    setTimeout(() => this.emit('message', { id, result }), Number(process.env.FAKE_TRANSCRIBE_MS || 0));
  }
}
workerThreads.Worker = FakeWorker;

https.request = (options, onResponse) => {
  const request = new EventEmitter();
  request.write = () => {};
  request.end = () => {
    if (options.hostname !== 'api.openai.com') {
      setImmediate(() => request.emit('error', new Error('outbound blocked in tests')));
      return;
    }
    const response = new EventEmitter();
    response.statusCode = 200;
    setImmediate(() => {
      onResponse(response);
      response.emit('data', JSON.stringify({ choices: [{ message: { content: process.env.FAKE_REFINED } }] }));
      response.emit('end');
    });
  };
  return request;
};
