'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'server-preload.js');
const INHERITED_SETTINGS = [
  'PUBLIC_URL', 'APP_URL', 'LOCAL_CONTROL_TOKEN', 'DESKTOP_MODE', 'DESKTOP_DEV', 'DATA_DIR', 'PORT',
];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function tempDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeteor-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

function send(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) { /* not every route answers with JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`timeout: ${method} ${url}`)));
    const payload = body === undefined || typeof body === 'string' ? body : JSON.stringify(body);
    req.end(payload);
  });
}

// Starts the real server.js against an isolated data directory and stops it when the test ends.
async function startServer(t, { dataDir, env = {} }) {
  const port = await freePort();
  const childEnv = { ...process.env };
  for (const name of INHERITED_SETTINGS) delete childEnv[name];
  Object.assign(childEnv, { DATA_DIR: dataDir, PORT: String(port) }, env);
  const child = spawn(process.execPath, ['--require', PRELOAD, path.join(ROOT, 'server.js')], { env: childEnv });
  let output = '';
  const exited = new Promise(resolve => child.on('exit', resolve));
  const stop = async () => { child.kill(); await exited; };
  t.after(stop);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + output)), 20_000);
    const watch = chunk => {
      output += chunk;
      if (!output.includes('running at http://')) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}:\n${output}`)); });
  });
  return {
    port,
    stop,
    output: () => output,
    send: (method, url, options) => send(port, method, url, options),
  };
}

module.exports = { ROOT, startServer, tempDataDir };
