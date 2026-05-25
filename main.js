const { app, BrowserWindow, session } = require('electron');
const { execSync } = require('child_process');
const path = require('path');

// Free port 7432 if another process is holding it (e.g. a stale node server.js)
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
freePort(7432);

const { serverReady } = require('./server');

let mainWindow;

app.whenReady().then(async () => {
  // Grant microphone (and camera) permission to the renderer
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'microphone', 'camera', 'audioCapture'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'microphone', 'camera', 'audioCapture'].includes(permission);
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Meeto',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  await serverReady;
  mainWindow.loadURL('http://localhost:7432');
  mainWindow.webContents.openDevTools({ mode: 'detach' });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
