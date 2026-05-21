const api = window.updaterAPI;

// ── Inline SVG icons ──
const ICON_FILE =
  '<svg class="file-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const ICON_EXE =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const ICON_SCRIPT =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

function isSecondaryExe(p) {
  return /\.(cmd|bat|ps1|sh)$/i.test(p);
}

// ── DOM refs ──
const $manifestUrl = document.getElementById('manifest-url');
const $folderPath = document.getElementById('folder-path');
const $btnBrowse = document.getElementById('btn-browse');
const $btnScan = document.getElementById('btn-scan');
const $btnUpdate = document.getElementById('btn-update');
const $btnCancel = document.getElementById('btn-cancel');
const $chkOrphans = document.getElementById('chk-orphans');

const $manifestInfo = document.getElementById('manifest-info');
const $manifestName = document.getElementById('manifest-name');
const $manifestVersion = document.getElementById('manifest-version');
const $manifestFileCount = document.getElementById('manifest-file-count');

const $overallBar = document.getElementById('overall-bar');
const $overallStats = document.getElementById('overall-stats');
const $overallPercent = document.getElementById('overall-percent');
const $statScanned = document.getElementById('stat-scanned');
const $statDownloaded = document.getElementById('stat-downloaded');
const $statSpeed = document.getElementById('stat-speed');
const $statElapsed = document.getElementById('stat-elapsed');
const $scanResultText = document.getElementById('scan-result-text');
const $filesCount = document.getElementById('files-count');
const $filesSummaryText = document.getElementById('files-summary-text');
const $statusText = document.getElementById('status-text');
const $btnClearLogs = document.getElementById('btn-clear-logs');

const $fileTbody = document.getElementById('file-tbody');
const $logOutput = document.getElementById('log-output');

const $exeSection = document.getElementById('exe-section');
const $exeList = document.getElementById('exe-list');

// ── State ──
let manifest = null;
let scanResult = null;
let fileRows = {};   // path → <tr>
let exeCards = {};   // relativePath → { item, btn, folder }
let updateStart = 0;
let lastBytes = 0;
let lastTs = 0;
let elapsedTimer = null;

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
function formatSpeed(bps) {
  return formatSize(bps) + '/s';
}
function setStatus(text) {
  if ($statusText) $statusText.textContent = text;
}
function setFilesSummary(text) {
  if ($filesSummaryText) $filesSummaryText.textContent = text;
}
function resetStats() {
  $overallBar.style.width = '0%';
  $overallPercent.textContent = '0%';
  $statScanned.textContent = '0 / 0 files';
  $statDownloaded.textContent = '0 B / 0 B';
  $statSpeed.textContent = '0 B/s';
  $statElapsed.textContent = '00:00:00';
}

const ICON_STOP =
  '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
const ICON_RUN =
  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

function setExeRunning(relativePath, running) {
  const card = exeCards[relativePath];
  if (!card) return;
  const { btn, item } = card;
  if (running) {
    btn.innerHTML = ICON_STOP + '<span>Stop</span>';
    btn.classList.remove('exe-run');
    btn.classList.add('exe-stop');
    item.classList.add('exe-running');
  } else {
    btn.innerHTML = ICON_RUN + '<span>Run</span>';
    btn.classList.remove('exe-stop');
    btn.classList.add('exe-run');
    item.classList.remove('exe-running');
  }
}

// ── Helpers ──
function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function log(msg, level = '') {
  const line = document.createElement('div');
  line.className = 'log-line' + (level ? ` log-${level}` : '');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  $logOutput.appendChild(line);
  $logOutput.scrollTop = $logOutput.scrollHeight;
}

function setButtonStates(state) {
  const canInput = state === 'idle' || state === 'scanned';
  $manifestUrl.disabled = !canInput;
  $btnBrowse.disabled = !canInput;
  $btnScan.disabled = !((state === 'idle' || state === 'scanned') && $manifestUrl.value && $folderPath.value);
  $btnUpdate.disabled = state !== 'scanned';
  $btnCancel.disabled = state !== 'updating';
  if (state === 'busy') setStatus('Working…');
  else if (state === 'updating') setStatus('Updating…');
  else if (state === 'scanned') setStatus('Scan complete');
  else setStatus('Ready');
}

function statusBadge(status) {
  const label = status.replace(/-/g, ' ').replace(/_/g, ' ');
  return `<span class="status-badge status-${status}">${label}</span>`;
}

function clearFileTable() {
  $fileTbody.innerHTML = '';
  fileRows = {};
}

async function refreshExecutables() {
  const folder = $folderPath.value;
  if (!folder) {
    $exeSection.classList.add('hidden');
    return;
  }
  try {
    const files = await api.scanExecutables(folder);
    $exeList.innerHTML = '';
    exeCards = {};
    if (files.length === 0) {
      $exeSection.classList.add('hidden');
      return;
    }

    for (const rel of files) {
      const secondary = isSecondaryExe(rel);
      const item = document.createElement('div');
      item.className = 'exe-item' + (secondary ? ' exe-secondary' : '');

      const head = document.createElement('div');
      head.className = 'exe-item-head';

      const icon = document.createElement('span');
      icon.className = 'exe-icon';
      icon.innerHTML = secondary ? ICON_SCRIPT : ICON_EXE;

      const name = document.createElement('span');
      name.className = 'exe-name';
      name.textContent = rel.split(/[\\/]/).pop();
      name.title = rel;

      const more = document.createElement('span');
      more.className = 'exe-more';
      more.textContent = '⋯';

      head.appendChild(icon);
      head.appendChild(name);
      head.appendChild(more);

      const btn = document.createElement('button');
      btn.className = 'exe-run';
      btn.innerHTML = ICON_RUN + '<span>Run</span>';

      btn.addEventListener('click', async () => {
        const isRunning = btn.classList.contains('exe-stop');
        if (isRunning) {
          try {
            await api.stopExecutable(folder, rel);
            log(`Stop signal sent: ${rel}`, 'warn');
          } catch (err) {
            log(`Failed to stop ${rel}: ${err.message}`, 'error');
          }
          // Confirm state after short delay
          setTimeout(async () => {
            try {
              const { running } = await api.checkExeRunning(folder, rel);
              setExeRunning(rel, running);
            } catch {}
          }, 600);
        } else {
          try {
            await api.runExecutable(folder, rel);
            log(`Launched: ${rel}`, 'info');
          } catch (err) {
            log(`Failed to launch ${rel}: ${err.message}`, 'error');
          }
          // Confirm state after process has had time to start
          setTimeout(async () => {
            try {
              const { running } = await api.checkExeRunning(folder, rel);
              setExeRunning(rel, running);
            } catch {}
          }, 1500);
        }
      });

      exeCards[rel] = { item, btn, folder };

      item.appendChild(head);
      item.appendChild(btn);
      $exeList.appendChild(item);
    }

    $exeSection.classList.remove('hidden');

    // Sync running state by querying system process list for each exe
    await Promise.all(
      files.map(async (rel) => {
        try {
          const { running } = await api.checkExeRunning(folder, rel);
          if (running) setExeRunning(rel, true);
        } catch {}
      })
    );

  } catch (err) {
    log(`Failed to scan executables: ${err.message}`, 'error');
  }
}

function addFileRow(filePath, size, status) {
  const tr = document.createElement('tr');
  const initialPct = (status === 'up-to-date' || status === 'done') ? 100 : 0;
  tr.innerHTML = `
    <td class="col-status">${statusBadge(status)}</td>
    <td class="col-file" title="${filePath}">
      <span class="file-cell">${ICON_FILE}<span class="file-name">${filePath}</span></span>
    </td>
    <td class="col-size">${formatSize(size)}</td>
    <td class="col-progress">
      <div class="progress-cell">
        <div class="file-progress-bar-container">
          <div class="file-progress-bar" style="width:${initialPct}%"></div>
        </div>
        <span class="progress-pct">${initialPct}%</span>
      </div>
    </td>`;
  $fileTbody.appendChild(tr);
  fileRows[filePath] = tr;
}

function updateFileStatus(filePath, status) {
  const tr = fileRows[filePath];
  if (!tr) return;
  tr.querySelector('.col-status').innerHTML = statusBadge(status);
  updateFileBarOnStatus(tr, status);
}

function updateFileProgress(filePath, percent) {
  const tr = fileRows[filePath];
  if (!tr) return;
  const bar = tr.querySelector('.file-progress-bar');
  bar.style.width = percent + '%';
  const pct = tr.querySelector('.progress-pct');
  if (pct) pct.textContent = Math.round(percent) + '%';
}

function updateFileBarOnStatus(tr, status) {
  const bar = tr.querySelector('.file-progress-bar');
  const pct = tr.querySelector('.progress-pct');
  if (status === 'up-to-date' || status === 'done') {
    if (bar) bar.style.width = '100%';
    if (pct) pct.textContent = '100%';
  }
}

// ── Persist settings ──
function saveInputs() {
  api.saveSettings({
    manifestUrl: $manifestUrl.value,
    folderPath: $folderPath.value,
  });
}

// ── Folder picker ──
$btnBrowse.addEventListener('click', async () => {
  const folder = await api.selectFolder();
  if (folder) {
    $folderPath.value = folder;
    saveInputs();
    setButtonStates('idle');
    refreshExecutables();
  }
});

$manifestUrl.addEventListener('input', () => {
  saveInputs();
  setButtonStates('idle');
});

// ── Scan & Compare ──
$btnScan.addEventListener('click', async () => {
  const url = $manifestUrl.value.trim();
  const dir = $folderPath.value.trim();
  if (!url || !dir) return;

  setButtonStates('busy');
  clearFileTable();
  resetStats();
  $filesCount.textContent = 'Showing 0 of 0 files';
  $scanResultText.textContent = 'Scanning…';
  setFilesSummary('Scanning…');
  log('Fetching manifest…', 'info');

  try {
    manifest = await api.fetchManifest(url);
  } catch (err) {
    log('Failed to fetch manifest: ' + err.message, 'error');
    setButtonStates('idle');
    return;
  }

  $manifestName.textContent = manifest.name || '(unnamed)';
  $manifestVersion.textContent = manifest.version || '—';
  $manifestFileCount.textContent = manifest.files.length;
  $manifestInfo.classList.remove('hidden');
  log(`Manifest: ${manifest.name} v${manifest.version} — ${manifest.files.length} files`, 'info');

  log('Scanning local files…', 'info');
  try {
    scanResult = await api.scanLocal(manifest, dir);
  } catch (err) {
    log('Scan failed: ' + err.message, 'error');
    setButtonStates('idle');
    return;
  }

  // Populate table
  for (const f of scanResult.files) {
    addFileRow(f.path, f.size, f.status);
  }
  for (const o of scanResult.orphans) {
    addFileRow(o, null, 'orphan');
  }

  const counts = { 'up-to-date': 0, 'needs-update': 0, new: 0 };
  for (const f of scanResult.files) {
    if (counts[f.status] !== undefined) counts[f.status]++;
  }

  const totalRows = scanResult.files.length + scanResult.orphans.length;
  $filesCount.textContent = `Showing ${totalRows} of ${totalRows} files`;

  const needsAny = counts['needs-update'] + counts.new;
  if (needsAny === 0) {
    $scanResultText.textContent = 'All files are up to date';
    setFilesSummary('All files are up to date');
  } else {
    $scanResultText.textContent = `${needsAny} need update`;
    setFilesSummary(`${needsAny} file(s) need update`);
  }

  $statScanned.textContent = `${scanResult.files.length} / ${scanResult.files.length} files`;

  log(
    `Scan complete: ${counts['up-to-date']} up-to-date, ${counts['needs-update']} need update, ${counts.new} new` +
      (scanResult.orphans.length ? `, ${scanResult.orphans.length} orphans` : ''),
    'info'
  );

  setButtonStates('scanned');
  refreshExecutables();
});
$btnUpdate.addEventListener('click', async () => {
  setButtonStates('updating');
  $overallBar.style.width = '0%';
  $overallPercent.textContent = '0%';
  $statDownloaded.textContent = '0 B / 0 B';
  $statSpeed.textContent = '0 B/s';
  updateStart = Date.now();
  lastBytes = 0;
  lastTs = updateStart;
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    $statElapsed.textContent = formatDuration(Date.now() - updateStart);
  }, 1000);
  log('Starting update…', 'info');

  try {
    const result = await api.startUpdate($chkOrphans.checked);
    if (result.cancelled) {
      log('Update cancelled.', 'warn');
    } else if (result.errors.length) {
      log(`Update completed with ${result.errors.length} error(s).`, 'error');
    } else {
      log('Update completed successfully.', 'info');
    }
  } catch (err) {
    log('Update error: ' + err.message, 'error');
  }

  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  $statSpeed.textContent = '0 B/s';
  setButtonStates('idle');
  refreshExecutables();
});

// ── Cancel ──
$btnCancel.addEventListener('click', () => {
  log('Cancelling…', 'warn');
  api.cancelUpdate();
});

if ($btnClearLogs) {
  $btnClearLogs.addEventListener('click', () => {
    $logOutput.innerHTML = '';
  });
}

// ── IPC event listeners ──
api.onLog((data) => {
  log(data.message, data.level || '');
});

api.onFileProgress((data) => {
  updateFileProgress(data.path, data.percent);
});

api.onOverallProgress((data) => {
  $overallBar.style.width = data.percent + '%';
  $overallPercent.textContent = Math.round(data.percent) + '%';
  $statScanned.textContent = `${data.completed} / ${data.total} files`;
  $statDownloaded.textContent = `${formatSize(data.bytesDownloaded)} / ${formatSize(data.bytesTotal)}`;
  const now = Date.now();
  const dt = (now - lastTs) / 1000;
  if (dt >= 0.4) {
    const db = data.bytesDownloaded - lastBytes;
    const bps = db > 0 && dt > 0 ? db / dt : 0;
    $statSpeed.textContent = formatSpeed(bps);
    lastBytes = data.bytesDownloaded;
    lastTs = now;
  }
});

api.onFileStatusChange((data) => {
  updateFileStatus(data.path, data.status);
});

api.onScanProgress((data) => {
  log(`Scanning ${data.current}/${data.total}: ${data.path}`, '');
});

// ── Init ──
(async () => {
  resetStats();
  const settings = await api.loadSettings();
  if (settings.manifestUrl) $manifestUrl.value = settings.manifestUrl;
  if (settings.folderPath) $folderPath.value = settings.folderPath;
  setButtonStates('idle');

  if (settings.folderPath) refreshExecutables();

  // Auto scan if both fields are filled
  if ($manifestUrl.value.trim() && $folderPath.value.trim()) {
    $btnScan.click();
  }
})();
