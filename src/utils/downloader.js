const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Download a file to a .tmp path, verify MD5, then atomically rename.
 *
 * @param {object} opts
 * @param {string} opts.url          Full download URL
 * @param {string} opts.destPath     Final file path
 * @param {string} opts.expectedHash Expected MD5 hex
 * @param {number} opts.expectedSize Expected file size in bytes
 * @param {AbortSignal} opts.signal  Cancellation signal
 * @param {(downloaded: number, total: number) => void} opts.onProgress
 * @returns {Promise<void>}
 */
function downloadFile({ url, destPath, expectedHash, expectedSize, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));

    const tmpPath = destPath + '.tmp';

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile({
          url: res.headers.location,
          destPath,
          expectedHash,
          expectedSize,
          signal,
          onProgress,
        }).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }

      const total = parseInt(res.headers['content-length'], 10) || expectedSize;
      let downloaded = 0;
      const hash = crypto.createHash('md5');
      const fileStream = fs.createWriteStream(tmpPath);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        hash.update(chunk);
        if (onProgress) onProgress(downloaded, total);
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        const actualHash = hash.digest('hex');
        if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
          fs.unlinkSync(tmpPath);
          return reject(
            new Error(`Hash mismatch for ${path.basename(destPath)}: expected ${expectedHash.slice(0, 12)}… got ${actualHash.slice(0, 12)}…`)
          );
        }
        // Atomic rename (overwrite if exists)
        try {
          fs.renameSync(tmpPath, destPath);
        } catch {
          // Cross-device fallback: copy then delete tmp
          try {
            fs.copyFileSync(tmpPath, destPath);
            fs.unlinkSync(tmpPath);
          } catch (copyErr) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return reject(new Error(
              `Cannot replace ${path.basename(destPath)} — file may be in use. (${copyErr.code})`
            ));
          }
        }
        resolve();
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(err);
      });

      res.on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(err);
      });
    });

    req.on('error', (err) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    });

    // Wire up cancellation
    if (signal) {
      const onAbort = () => {
        req.destroy();
        try { fs.unlinkSync(tmpPath); } catch {}
        reject(new Error('Cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

module.exports = { downloadFile };
