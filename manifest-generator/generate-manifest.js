#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- CLI arg parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = { flags: {}, positional: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--name' || arg === '--version' || arg === '--base-url' || arg === '--output' || arg === '-o') {
      const key = arg === '-o' ? '--output' : arg;
      if (i + 1 >= args.length) {
        console.error(`Error: ${arg} requires a value`);
        process.exit(1);
      }
      parsed.flags[key] = args[++i];
    } else if (arg.startsWith('-')) {
      console.error(`Error: unknown flag ${arg}`);
      process.exit(1);
    } else {
      parsed.positional.push(arg);
    }
  }

  return parsed;
}

// --- File hashing (same streaming approach as src/utils/hasher.js) ---

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// --- Recursive directory walk ---

function walkDir(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// --- Main ---

async function main() {
  const { flags, positional } = parseArgs(process.argv);

  if (positional.length === 0) {
    console.error('Usage: node generate-manifest.js <folder> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --name <name>        App name (defaults to folder name)');
    console.error('  --version <version>  Version string (defaults to "1.0.0")');
    console.error('  --base-url <url>     baseDownloadUrl value (defaults to "")');
    console.error('  --output, -o <path>  Output file path (defaults to manifest.json)');
    process.exit(1);
  }

  const folder = path.resolve(positional[0]);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Error: "${folder}" is not a valid directory`);
    process.exit(1);
  }

  const appName = flags['--name'] || path.basename(folder);
  const version = flags['--version'] || '1.0.0';
  const baseUrl = flags['--base-url'] || '';
  const output = flags['--output'] || 'manifest.json';

  const filePaths = walkDir(folder);

  const files = [];
  for (const filePath of filePaths) {
    const relativePath = path.relative(folder, filePath).split(path.sep).join('/');
    const stat = fs.statSync(filePath);
    const md5 = await hashFile(filePath);
    files.push({
      path: relativePath,
      md5,
      size: stat.size,
      url: relativePath,
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const manifest = {
    version,
    name: appName,
    baseDownloadUrl: baseUrl,
    files,
  };

  const json = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(output, json, 'utf-8');

  console.log(`Manifest generated: ${output}`);
  console.log(`  Name:    ${appName}`);
  console.log(`  Version: ${version}`);
  console.log(`  Files:   ${files.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
