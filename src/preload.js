const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updaterAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  fetchManifest: (url) => ipcRenderer.invoke('fetch-manifest', url),
  scanLocal: (manifest, targetDir) =>
    ipcRenderer.invoke('scan-local', { manifest, targetDir }),
  startUpdate: (deleteOrphans) =>
    ipcRenderer.invoke('start-update', { deleteOrphans }),
  cancelUpdate: () => ipcRenderer.invoke('cancel-update'),

  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),

  scanExecutables: (targetDir) => ipcRenderer.invoke('scan-executables', { targetDir }),
  runExecutable: (targetDir, relativePath) =>
    ipcRenderer.invoke('run-executable', { targetDir, relativePath }),
  stopExecutable: (targetDir, relativePath) =>
    ipcRenderer.invoke('stop-executable', { targetDir, relativePath }),
  checkExeRunning: (targetDir, relativePath) =>
    ipcRenderer.invoke('check-exe-running', { targetDir, relativePath }),

  // Main → renderer events
  onLog: (cb) => ipcRenderer.on('log', (_e, data) => cb(data)),
  onFileProgress: (cb) => ipcRenderer.on('file-progress', (_e, data) => cb(data)),
  onOverallProgress: (cb) => ipcRenderer.on('overall-progress', (_e, data) => cb(data)),
  onFileStatusChange: (cb) => ipcRenderer.on('file-status-change', (_e, data) => cb(data)),
  onScanProgress: (cb) => ipcRenderer.on('scan-progress', (_e, data) => cb(data)),
});
