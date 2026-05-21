const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { fetchManifest } = require('./utils/manifest');
const { UpdaterCore } = require('./updater-core');

// ── Single instance lock ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // Focus existing window if someone tries to open a second instance
  if (mainWindow) {
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

Menu.setApplicationMenu(null);

// ── .cmd parser ──
// Try to extract the real executable + args from a simple launcher .cmd file.
// Returns { exePath, args, cwd } on success, or null if too complex to parse.
function parseCmdFile(cmdPath) {
  let content;
  try {
    const buf = fs.readFileSync(cmdPath);
    // Try UTF-8 first; if it has lots of replacement chars, fall back to default
    content = buf.toString('utf8');
  } catch {
    return null;
  }

  const baseDir = path.dirname(cmdPath);
  const lines = content.split(/\r?\n/);
  let cwd = baseDir;

  // Helper to expand %~dp0 etc. (only common cases)
  const expand = (s) => s
    .replace(/%~dp0\\?/gi, baseDir + path.sep)
    .replace(/%~d0/gi, baseDir.slice(0, 2))
    .replace(/%cd%/gi, cwd);

  // Split a command line into argv honoring double quotes
  const splitArgs = (line) => {
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      out.push(m[1] !== undefined ? m[1] : m[2]);
    }
    return out;
  };

  for (let raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@')) line = line.slice(1).trim();
    if (!line) continue;

    const lower = line.toLowerCase();

    // Skip benign directives
    if (lower === 'echo off' || lower.startsWith('echo ')) continue;
    if (lower.startsWith('rem ') || lower.startsWith('::')) continue;
    if (lower.startsWith('setlocal') || lower.startsWith('endlocal')) continue;
    if (lower.startsWith('title ')) continue;
    if (lower.startsWith('chcp ') || lower.startsWith('color ')) continue;

    // Track cd / pushd to update working dir (best-effort)
    if (lower.startsWith('cd ') || lower.startsWith('cd/d ') || lower.startsWith('cd /d ')) {
      const rest = line.replace(/^cd(\s*\/d)?\s+/i, '').trim().replace(/^"|"$/g, '');
      cwd = path.resolve(baseDir, expand(rest));
      continue;
    }
    if (lower.startsWith('pushd ')) {
      const rest = line.replace(/^pushd\s+/i, '').trim().replace(/^"|"$/g, '');
      cwd = path.resolve(baseDir, expand(rest));
      continue;
    }

    // Anything with flow control / piping is too complex
    if (/[&|<>]/.test(line)) return null;
    if (lower.startsWith('if ') || lower.startsWith('for ') || lower.startsWith('goto ')) return null;
    if (lower.startsWith('call ')) line = line.replace(/^call\s+/i, '');

    // Strip `start "title" ...`
    if (/^start\b/i.test(line)) {
      line = line.replace(/^start\b/i, '').trim();
      // optional /WAIT /B /MIN etc.
      while (/^\/[a-z]+/i.test(line)) line = line.replace(/^\/[a-z]+\s*/i, '');
      // optional "window title"
      if (line.startsWith('"')) {
        const end = line.indexOf('"', 1);
        if (end !== -1) line = line.slice(end + 1).trim();
      }
    }

    if (!line) continue;

    const argv = splitArgs(expand(line));
    if (argv.length === 0) continue;

    let exe = argv[0];
    if (!path.isAbsolute(exe)) exe = path.resolve(cwd, exe);
    if (!fs.existsSync(exe)) {
      // Try with .exe appended
      if (!/\.exe$/i.test(exe) && fs.existsSync(exe + '.exe')) {
        exe = exe + '.exe';
      } else {
        return null;
      }
    }
    if (!/\.exe$/i.test(exe)) return null;

    return { exePath: exe, args: argv.slice(1), cwd };
  }

  return null;
}

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

// ── Per-exe registry (populated on each scan-executables call) ──
// Map<relativePath, { targetDir }> — used to query & kill processes at quit time
const knownExePaths = new Map();

// Query a running process by exe name + required args present in its CommandLine.
// Returns { pid } on match, null if not found.
async function queryRunningProcess(exeName, argsToMatch) {
  return new Promise((resolve) => {
    const safeFilter = `Name='${exeName.replace(/'/g, "''")}'`;
    const psCmd =
      `$r = Get-CimInstance Win32_Process -Filter "${safeFilter}" | ` +
      `Select-Object ProcessId,CommandLine; ` +
      `if ($r) { $r | ConvertTo-Json -Compress } else { '[]' }`;
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    );
    let out = '';
    ps.stdout.on('data', (d) => (out += d.toString()));
    ps.on('close', () => {
      try {
        let rows = JSON.parse(out.trim() || '[]');
        if (!Array.isArray(rows)) rows = [rows];
        const lower = argsToMatch.map((a) => a.toLowerCase());
        for (const row of rows) {
          const cl = (row.CommandLine || '').toLowerCase();
          if (lower.length === 0 || lower.every((a) => cl.includes(a))) {
            resolve({ pid: row.ProcessId });
            return;
          }
        }
      } catch {}
      resolve(null);
    });
    ps.on('error', () => resolve(null));
  });
}

// Kill all known managed processes (called at quit time)
async function killAllProcesses() {
  const tasks = [];
  for (const [rel, { targetDir }] of knownExePaths.entries()) {
    tasks.push(
      (async () => {
        const absPath = path.join(targetDir, rel.replace(/\//g, path.sep));
        const isCmd = absPath.toLowerCase().endsWith('.cmd');
        let exeName, argsToMatch;
        if (isCmd) {
          const parsed = parseCmdFile(absPath);
          if (!parsed) return;
          exeName = path.basename(parsed.exePath);
          argsToMatch = parsed.args;
        } else {
          exeName = path.basename(absPath);
          argsToMatch = [];
        }
        const found = await queryRunningProcess(exeName, argsToMatch);
        if (found) {
          try {
            spawn('taskkill', ['/T', '/F', '/PID', String(found.pid)],
              { stdio: 'ignore', windowsHide: true });
          } catch {}
        }
      })()
    );
  }
  await Promise.all(tasks);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1593,
    height: 1094,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
});

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
  // Register all found paths so we can query/kill them at quit time
  knownExePaths.clear();
  for (const rel of results) knownExePaths.set(rel, { targetDir });
  return results;
});

// ── Executable run / stop / status (process-list–based, no persistent PID tracking) ──

ipcMain.handle('run-executable', async (_event, { targetDir, relativePath }) => {
  const absPath = path.join(targetDir, relativePath.replace(/\//g, path.sep));
  if (!fs.existsSync(absPath)) throw new Error('File not found: ' + relativePath);

  const isCmd = absPath.toLowerCase().endsWith('.cmd');
  const parsed = isCmd ? parseCmdFile(absPath) : null;

  let child;
  if (parsed) {
    child = spawn(parsed.exePath, parsed.args, {
      detached: true, stdio: 'ignore', cwd: parsed.cwd, windowsHide: false,
    });
  } else if (isCmd) {
    // Use `start` so cmd.exe exits immediately and the window appears normally
    child = spawn('cmd.exe', ['/c', 'start', '', absPath], {
      detached: true, stdio: 'ignore', cwd: path.dirname(absPath),
    });
  } else {
    child = spawn(absPath, [], {
      detached: true, stdio: 'ignore', cwd: path.dirname(absPath),
    });
  }
  child.unref();
  return { ok: true };
});

ipcMain.handle('stop-executable', async (_event, { targetDir, relativePath }) => {
  const absPath = path.join(targetDir, relativePath.replace(/\//g, path.sep));
  const isCmd = absPath.toLowerCase().endsWith('.cmd');

  let exeName, argsToMatch;
  if (isCmd) {
    const parsed = parseCmdFile(absPath);
    if (!parsed) return { ok: false, reason: 'cannot parse cmd to locate target process' };
    exeName = path.basename(parsed.exePath);
    argsToMatch = parsed.args;
  } else {
    exeName = path.basename(absPath);
    argsToMatch = [];
  }

  const found = await queryRunningProcess(exeName, argsToMatch);
  if (!found) return { ok: false, reason: 'not running' };

  try {
    spawn('taskkill', ['/T', '/F', '/PID', String(found.pid)],
      { stdio: 'ignore', windowsHide: true });
  } catch {}
  return { ok: true, pid: found.pid };
});

// Check if a specific exe/cmd is currently running by querying the system process list
ipcMain.handle('check-exe-running', async (_event, { targetDir, relativePath }) => {
  const absPath = path.join(targetDir, relativePath.replace(/\//g, path.sep));
  const isCmd = absPath.toLowerCase().endsWith('.cmd');

  let exeName, argsToMatch;
  if (isCmd) {
    const parsed = parseCmdFile(absPath);
    if (!parsed) return { running: false, pid: null };
    exeName = path.basename(parsed.exePath);
    argsToMatch = parsed.args;
  } else {
    exeName = path.basename(absPath);
    argsToMatch = [];
  }

  const found = await queryRunningProcess(exeName, argsToMatch);
  return { running: !!found, pid: found ? found.pid : null };
});
