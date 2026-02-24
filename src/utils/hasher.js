const crypto = require('crypto');
const fs = require('fs');

/**
 * Compute MD5 hash of a file using streaming reads.
 * @param {string} filePath
 * @returns {Promise<string>} hex-encoded MD5
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { hashFile };
