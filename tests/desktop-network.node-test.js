'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const http = require('node:http');
const Module = require('node:module');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ROOT, startServer, tempDataDir } = require('./fixtures/server-harness');

// This machine's own LAN addresses: what another computer on the network would connect to.
const LAN_ADDRESSES = Object.values(os.networkInterfaces()).flat()
  .filter(entry => entry.family === 'IPv4' && !entry.internal)
  .map(entry => entry.address);

// Resolves 'connected', or the error code that stopped the connection.
function connect(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const finish = outcome => { socket.destroy(); resolve(outcome); };
    socket.setTimeout(10_000, () => finish('timeout'));
    socket.once('connect', () => finish('connected'));
    socket.once('error', error => finish(error.code));
  });
}

test('desktop mode refuses non-loopback connections and still serves loopback', async t => {
  assert.ok(LAN_ADDRESSES.length > 0, 'this test needs a non-loopback IPv4 interface');
  const server = await startServer(t, { dataDir: tempDataDir(t), env: { DESKTOP_MODE: '1' } });

  for (const address of LAN_ADDRESSES) {
    assert.equal(await connect(address, server.port), 'ECONNREFUSED', address);
  }
  assert.equal((await server.send('GET', '/version')).status, 200);
  assert.match(server.output(), new RegExp(`running at http://127\\.0\\.0\\.1:${server.port}`));
});

// Hosted and Docker installs depend on this, and it shows the addresses above are reachable when not restricted.
test('hosted mode still accepts non-loopback connections', async t => {
  const server = await startServer(t, { dataDir: tempDataDir(t) });

  for (const address of LAN_ADDRESSES) {
    assert.equal(await connect(address, server.port), 'connected', address);
  }
  assert.equal(await connect('127.0.0.1', server.port), 'connected');
});

test('a busy port fails startup and leaves the process holding it running', async t => {
  const holder = http.createServer((req, res) => res.end('holder'));
  await new Promise(resolve => holder.listen(0, '127.0.0.1', resolve));
  t.after(() => holder.close());
  const { port } = holder.address();

  await assert.rejects(
    startServer(t, { dataDir: tempDataDir(t), env: { DESKTOP_MODE: '1', PORT: String(port) } }),
    /server exited [\s\S]*EADDRINUSE/,
  );
  assert.equal(await connect('127.0.0.1', port), 'connected');
});

// Runs the real main.js with Electron and the embedded server replaced, recording what it does.
async function launchDesktop(t, { hasLock = true, startError = null } = {}) {
  const calls = { quit: 0, errors: [], loaded: [], switches: [], processCommands: [], serverRequired: 0, focused: 0 };
  const handlers = {};
  class BrowserWindow {
    constructor() { this.webContents = { openDevTools() {} }; }
    setMenuBarVisibility() {}
    loadURL(url) { calls.loaded.push(url); }
    isMinimized() { return false; }
    focus() { calls.focused += 1; }
  }
  const electron = {
    app: {
      isPackaged: true,
      getPath: () => os.tmpdir(),
      requestSingleInstanceLock: () => hasLock,
      commandLine: { appendSwitch: (...args) => calls.switches.push(args) },
      whenReady: () => Promise.resolve(),
      on: (name, handler) => { handlers[name] = handler; },
      quit: () => { calls.quit += 1; },
    },
    BrowserWindow,
    dialog: { showErrorBox: (title, message) => calls.errors.push(message) },
    session: {
      defaultSession: {
        setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDisplayMediaRequestHandler() {},
      },
    },
    desktopCapturer: {},
  };
  const server = () => {
    calls.serverRequired += 1;
    const serverReady = startError ? Promise.reject(startError) : Promise.resolve();
    return { serverReady };
  };

  for (const name of ['execSync', 'exec', 'execFile', 'execFileSync', 'spawn', 'spawnSync']) {
    t.mock.method(childProcess, name, (...args) => { calls.processCommands.push(args[0]); return Buffer.from(''); });
  }
  const load = Module._load;
  t.mock.method(Module, '_load', function (request, ...rest) {
    if (request === 'electron') return electron;
    if (request === './server') return server();
    return load.call(this, request, ...rest);
  });
  const savedEnv = { ...process.env };
  delete process.env.PORT;
  t.after(() => { process.env = savedEnv; });
  const main = path.join(ROOT, 'main.js');
  delete require.cache[main];
  require(main);
  await new Promise(resolve => setImmediate(resolve));
  return { calls, handlers };
}

test('the desktop app starts without running any process command and pins localhost to its own server', async t => {
  const { calls, handlers } = await launchDesktop(t);

  assert.deepEqual(calls.processCommands, []);
  assert.deepEqual(calls.switches, [['host-resolver-rules', 'MAP localhost 127.0.0.1']]);
  assert.deepEqual(calls.loaded, ['http://localhost:7433']);
  handlers['second-instance']();
  assert.equal(calls.focused, 1);
});

test('a second launch quits without starting a server or touching the first', async t => {
  const { calls } = await launchDesktop(t, { hasLock: false });

  assert.deepEqual(
    [calls.quit, calls.serverRequired, calls.loaded, calls.processCommands], [1, 0, [], []],
  );
});

test('the desktop app reports a busy port and quits without loading whatever holds it', async t => {
  const startError = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
  const { calls } = await launchDesktop(t, { startError });

  assert.deepEqual(calls.loaded, []);
  assert.equal(calls.quit, 1);
  assert.match(calls.errors[0], /port 7433 is already in use/);
});
