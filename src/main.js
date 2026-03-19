const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { fetchManifest } = require('./utils/manifest');
const { UpdaterCore } = require('./updater-core');

Menu.setApplicationMenu(null);

// ── Persistent settings ──
const exeDir = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : path.resolve(__dirname, '..');
const settingsPath = path.join(exeDir, 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(data) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
}

let mainWindow;
let updaterCore = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 540,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

// ── IPC handlers ──

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('fetch-manifest', async (_event, url) => {
  return fetchManifest(url);
});

ipcMain.handle('scan-local', async (_event, { manifest, targetDir }) => {
  updaterCore = new UpdaterCore(manifest, targetDir, (channel, data) => {
    mainWindow.webContents.send(channel, data);
  });
  return updaterCore.scan();
});

ipcMain.handle('start-update', async (_event, { deleteOrphans }) => {
  if (!updaterCore) throw new Error('Run scan first');
  return updaterCore.startUpdate({ deleteOrphans });
});

ipcMain.handle('cancel-update', async () => {
  if (updaterCore) updaterCore.cancel();
});

ipcMain.handle('load-settings', async () => {
  return loadSettings();
});

ipcMain.handle('save-settings', async (_event, data) => {
  saveSettings(data);
});

ipcMain.handle('scan-executables', async (_event, { targetDir }) => {
  const results = [];
  function walk(dir, relBase) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = relBase ? relBase + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.exe') || lower.endsWith('.cmd')) {
          results.push(rel);
        }
      }
    }
  }
  walk(targetDir, '');
  results.sort();
  return results;
});

ipcMain.handle('run-executable', async (_event, { targetDir, relativePath }) => {
  const absPath = path.join(targetDir, relativePath.replace(/\//g, path.sep));
  if (!fs.existsSync(absPath)) throw new Error('File not found: ' + relativePath);
  const isCmd = absPath.toLowerCase().endsWith('.cmd');
  const child = isCmd
    ? spawn('cmd.exe', ['/c', absPath], {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(absPath),
      })
    : spawn(absPath, [], {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(absPath),
      });
  child.unref();
  return { ok: true };
});
