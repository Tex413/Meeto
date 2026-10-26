const { app, BrowserWindow, session, desktopCapturer, shell } = require('electron');
const { execSync } = require('child_process');
const path = require('path');

// Configure the embedded server for desktop mode BEFORE requiring it:
//  - single local user, no login (DESKTOP_MODE)
//  - data (SQLite, models, docs, logs) under the user's app-data dir so it
//    persists across updates and never writes into the install directory.
process.env.DESKTOP_MODE = '1';
// In an unpackaged dev build, relax license gates so the app is testable
// without an active license.key. Packaged (production) builds stay gated.
if (!app.isPackaged) process.env.DESKTOP_DEV = '1';
process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
// Use a dedicated port so the desktop app never collides with the hosted
// demo (which occupies 7432 via Docker on the dev machine).
process.env.PORT = process.env.PORT || '7433';

const PORT = parseInt(process.env.PORT);
const APP_ORIGIN = `http://localhost:${PORT}`;
const isAppUrl = u => typeof u === 'string' && (u === APP_ORIGIN || u.startsWith(APP_ORIGIN + '/'));

// Free the port if a stale process is holding it (e.g. a leftover node server.js)
function freePort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`).toString();
    for (const line of out.split('\n')) {
      if (line.includes('LISTENING')) {
        const m = line.trim().match(/(\d+)$/);
        if (m) try { execSync(`taskkill /F /PID ${m[1]}`); } catch(e) {}
      }
    }
  } catch(e) {}
}
freePort(PORT);

const { serverReady } = require('./server');

let mainWindow;

app.whenReady().then(async () => {
  // Grant microphone (and camera) permission to the renderer — only to our own
  // local app origin, never to any other page that might end up in a window.
  const MEDIA_PERMS = ['media', 'microphone', 'camera', 'audioCapture'];
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(isAppUrl(wc && wc.getURL()) && MEDIA_PERMS.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return isAppUrl(requestingOrigin) && MEDIA_PERMS.includes(permission);
  });

  // A/V recording: satisfy navigator.mediaDevices.getDisplayMedia() in the
  // renderer. We grab the primary screen and request 'loopback' so Windows
  // system audio (the other participants on the call) is captured too.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      callback(sources.length ? { video: sources[0], audio: 'loopback' } : {});
    }).catch(() => callback({}));
  }, { useSystemPicker: false });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Meetintel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Keep this window on the local app. window.open / target=_blank links go to
  // the system browser (web URLs only); in-window navigation elsewhere is blocked.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });

  mainWindow.setMenuBarVisibility(false);
  await serverReady;
  mainWindow.loadURL(`http://localhost:${PORT}`);
  if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
