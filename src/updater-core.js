const fs = require('fs');
const path = require('path');
const { hashFile } = require('./utils/hasher');
const { downloadFile } = require('./utils/downloader');

const CONCURRENCY = 3;

class UpdaterCore {
  /**
   * @param {object} manifest      Validated manifest object
   * @param {string} targetDir     Absolute path to target folder
   * @param {(channel: string, data: any) => void} emit  Send events to renderer
   */
  constructor(manifest, targetDir, emit) {
    this.manifest = manifest;
    this.targetDir = targetDir;
    this.emit = emit;
    this.abortController = null;
    this.scanData = null;
  }

  /**
   * Scan local files and compare against manifest.
   * Returns { files: [{path, size, status, md5}], orphans: [string] }
   */
  async scan() {
    const manifestPaths = new Set();
    const results = [];

    for (let i = 0; i < this.manifest.files.length; i++) {
      const entry = this.manifest.files[i];
      const filePath = entry.path.replace(/\//g, path.sep);
      const absPath = path.join(this.targetDir, filePath);
      manifestPaths.add(filePath);

      this.emit('scan-progress', {
        current: i + 1,
        total: this.manifest.files.length,
        path: entry.path,
      });

      let status;
      if (!fs.existsSync(absPath)) {
        status = 'new';
      } else {
        const localHash = await hashFile(absPath);
        status = localHash.toLowerCase() === entry.md5.toLowerCase()
          ? 'up-to-date'
          : 'needs-update';
      }

      results.push({
        path: entry.path,
        size: entry.size,
        md5: entry.md5,
        url: entry.url,
        status,
      });
    }

    // Detect orphans: local files not in the manifest
    const orphans = [];
    this._walkDir(this.targetDir, '', (relPath) => {
      const normalized = relPath.replace(/\\/g, '/');
      const hasMatch = this.manifest.files.some((f) => f.path === normalized);
      if (!hasMatch) orphans.push(normalized);
    });

    this.scanData = { files: results, orphans };
    return this.scanData;
  }

  /**
   * Execute the update: download changed/new files with concurrency.
   * @param {{ deleteOrphans: boolean }} opts
   * @returns {Promise<{ cancelled: boolean, errors: string[] }>}
   */
  async startUpdate({ deleteOrphans }) {
    if (!this.scanData) throw new Error('Must scan before updating');

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const toDownload = this.scanData.files.filter(
      (f) => f.status === 'needs-update' || f.status === 'new'
    );

    const totalBytes = toDownload.reduce((s, f) => s + f.size, 0);
    let completedFiles = 0;
    let completedBytes = 0;
    const errors = [];
    let cancelled = false;

    const emitOverall = () => {
      this.emit('overall-progress', {
        completed: completedFiles,
        total: toDownload.length,
        bytesDownloaded: completedBytes,
        bytesTotal: totalBytes,
        percent: totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 100,
      });
    };

    emitOverall();

    // Process queue with concurrency limit
    let idx = 0;
    const next = async () => {
      while (idx < toDownload.length) {
        if (signal.aborted) { cancelled = true; return; }

        const file = toDownload[idx++];
        const destPath = path.join(this.targetDir, file.path.replace(/\//g, path.sep));
        const downloadUrl = this._resolveUrl(file.url);

        this.emit('file-status-change', { path: file.path, status: 'downloading' });
        this.emit('log', { message: `Downloading: ${file.path}`, level: 'info' });

        try {
          await downloadFile({
            url: downloadUrl,
            destPath,
            expectedHash: file.md5,
            expectedSize: file.size,
            signal,
            onProgress: (downloaded, total) => {
              const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
              this.emit('file-progress', { path: file.path, percent: pct });
            },
          });

          this.emit('file-status-change', { path: file.path, status: 'done' });
          this.emit('file-progress', { path: file.path, percent: 100 });
          completedFiles++;
          completedBytes += file.size;
          emitOverall();
        } catch (err) {
          if (signal.aborted) {
            cancelled = true;
            this.emit('file-status-change', { path: file.path, status: 'cancelled' });
            return;
          }
          errors.push(`${file.path}: ${err.message}`);
          this.emit('file-status-change', { path: file.path, status: 'error' });
          this.emit('log', { message: `Error: ${file.path} — ${err.message}`, level: 'error' });
          completedFiles++;
          emitOverall();
        }
      }
    };

    // Launch concurrent workers
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(next());
    }
    await Promise.all(workers);

    // Handle orphan deletion
    if (deleteOrphans && !cancelled && this.scanData.orphans.length > 0) {
      this.emit('log', { message: `Deleting ${this.scanData.orphans.length} orphan file(s)…`, level: 'warn' });
      for (const orphanPath of this.scanData.orphans) {
        const absPath = path.join(this.targetDir, orphanPath.replace(/\//g, path.sep));
        try {
          fs.unlinkSync(absPath);
          this.emit('file-status-change', { path: orphanPath, status: 'done' });
          this.emit('log', { message: `Deleted orphan: ${orphanPath}` });
        } catch (err) {
          this.emit('log', { message: `Failed to delete orphan ${orphanPath}: ${err.message}`, level: 'error' });
        }
      }
      // Clean up empty directories (bottom-up)
      this._cleanEmptyDirs(this.targetDir);
    }

    return { cancelled, errors };
  }

  cancel() {
    if (this.abortController) this.abortController.abort();
  }

  // ── Private helpers ──

  _resolveUrl(fileUrl) {
    if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
    const base = (this.manifest.baseDownloadUrl || '').replace(/\/+$/, '');
    return base + '/' + fileUrl;
  }

  _walkDir(dir, relBase, cb) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relBase ? relBase + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        this._walkDir(path.join(dir, entry.name), relPath, cb);
      } else if (entry.isFile()) {
        cb(relPath);
      }
    }
  }

  _cleanEmptyDirs(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sub = path.join(dir, entry.name);
        this._cleanEmptyDirs(sub);
        try {
          const remaining = fs.readdirSync(sub);
          if (remaining.length === 0) fs.rmdirSync(sub);
        } catch {}
      }
    }
  }
}

module.exports = { UpdaterCore };
