const api = window.updaterAPI;

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

const $overallSection = document.getElementById('overall-section');
const $overallBar = document.getElementById('overall-bar');
const $overallStats = document.getElementById('overall-stats');

const $fileTbody = document.getElementById('file-tbody');
const $logOutput = document.getElementById('log-output');

// ── State ──
let manifest = null;
let scanResult = null;
let fileRows = {};  // path → <tr> element

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
  const canInput = state === 'idle';
  $manifestUrl.disabled = !canInput;
  $btnBrowse.disabled = !canInput;
  $btnScan.disabled = !(canInput && $manifestUrl.value && $folderPath.value);
  $btnUpdate.disabled = state !== 'scanned';
  $btnCancel.disabled = state !== 'updating';
}

function statusBadge(status) {
  const label = status.replace(/-/g, ' ').replace(/_/g, ' ');
  return `<span class="status-badge status-${status}">${label}</span>`;
}

function clearFileTable() {
  $fileTbody.innerHTML = '';
  fileRows = {};
}

function addFileRow(filePath, size, status) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="col-status">${statusBadge(status)}</td>
    <td class="col-file" title="${filePath}">${filePath}</td>
    <td class="col-size">${formatSize(size)}</td>
    <td class="col-progress">
      <div class="file-progress-bar-container">
        <div class="file-progress-bar" style="width:0%"></div>
      </div>
    </td>`;
  $fileTbody.appendChild(tr);
  fileRows[filePath] = tr;
}

function updateFileStatus(filePath, status) {
  const tr = fileRows[filePath];
  if (!tr) return;
  tr.querySelector('.col-status').innerHTML = statusBadge(status);
}

function updateFileProgress(filePath, percent) {
  const tr = fileRows[filePath];
  if (!tr) return;
  const bar = tr.querySelector('.file-progress-bar');
  bar.style.width = percent + '%';
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
  $manifestInfo.classList.add('hidden');
  $overallSection.classList.add('hidden');
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
  log(
    `Scan complete: ${counts['up-to-date']} up-to-date, ${counts['needs-update']} need update, ${counts.new} new` +
      (scanResult.orphans.length ? `, ${scanResult.orphans.length} orphans` : ''),
    'info'
  );

  setButtonStates('scanned');
});

// ── Start Update ──
$btnUpdate.addEventListener('click', async () => {
  setButtonStates('updating');
  $overallSection.classList.remove('hidden');
  $overallBar.style.width = '0%';
  $overallStats.textContent = '';
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

  setButtonStates('idle');
});

// ── Cancel ──
$btnCancel.addEventListener('click', () => {
  log('Cancelling…', 'warn');
  api.cancelUpdate();
});

// ── IPC event listeners ──
api.onLog((data) => {
  log(data.message, data.level || '');
});

api.onFileProgress((data) => {
  updateFileProgress(data.path, data.percent);
});

api.onOverallProgress((data) => {
  $overallBar.style.width = data.percent + '%';
  $overallStats.textContent =
    `${data.completed}/${data.total} files — ${formatSize(data.bytesDownloaded)} / ${formatSize(data.bytesTotal)}`;
});

api.onFileStatusChange((data) => {
  updateFileStatus(data.path, data.status);
});

api.onScanProgress((data) => {
  log(`Scanning ${data.current}/${data.total}: ${data.path}`, '');
});

// ── Init ──
(async () => {
  const settings = await api.loadSettings();
  if (settings.manifestUrl) $manifestUrl.value = settings.manifestUrl;
  if (settings.folderPath) $folderPath.value = settings.folderPath;
  setButtonStates('idle');

  // Auto scan if both fields are filled
  if ($manifestUrl.value.trim() && $folderPath.value.trim()) {
    $btnScan.click();
  }
})();
