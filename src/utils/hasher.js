const crypto = require('crypto');
const fs = require('fs');

/**
 * Compute SHA256 hash of a file using streaming reads.
 * @param {string} filePath
 * @returns {Promise<string>} hex-encoded SHA256
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { hashFile };
