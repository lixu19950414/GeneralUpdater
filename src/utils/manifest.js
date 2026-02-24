const https = require('https');
const http = require('http');

/**
 * Fetch and validate a JSON manifest from a URL.
 * @param {string} url
 * @returns {Promise<object>} Parsed and validated manifest
 */
function fetchManifest(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchManifest(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching manifest`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const manifest = JSON.parse(text);
          validate(manifest);
          resolve(manifest);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function validate(m) {
  if (!m || typeof m !== 'object') throw new Error('Manifest is not an object');
  if (!Array.isArray(m.files)) throw new Error('Manifest missing "files" array');

  for (const f of m.files) {
    if (typeof f.path !== 'string' || !f.path)
      throw new Error('File entry missing "path"');
    if (typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(f.sha256))
      throw new Error(`Invalid sha256 for "${f.path}"`);
    if (typeof f.size !== 'number' || f.size < 0)
      throw new Error(`Invalid size for "${f.path}"`);

    // Path traversal protection
    const normalized = f.path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.includes('..'))
      throw new Error(`Unsafe path: "${f.path}"`);
  }
}

module.exports = { fetchManifest };
