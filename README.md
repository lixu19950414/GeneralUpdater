# File Updater

Electron desktop app that patches and updates external application files by comparing them against a remote JSON manifest. Detects new, changed, and orphaned files via MD5 hashing, then downloads what's needed with concurrent transfers.

## Project Structure

```
├── src/                      Electron app source
│   ├── main.js               Main process, IPC handlers, settings
│   ├── preload.js            Context-isolated IPC bridge
│   ├── updater-core.js       Scan & download engine (3 concurrent workers)
│   ├── renderer/             UI (HTML + vanilla JS + CSS)
│   └── utils/                Downloader, hasher, manifest fetcher
├── manifest-generator/       CLI tool to create manifest.json from a folder
├── test-server/              Local HTTP server + sample files for testing
├── build/                    Top-level build script
└── dist/                     Packaged output (git-ignored)
```

## Prerequisites

- Node.js v20+
- npm

Install dependencies:

```bash
npm install
```

## Development

Run the app in dev mode:

```bash
npm start
```

### Test Server

Start a local HTTP server with sample files:

```bash
node test-server/serve.js
```

This serves `manifest.json` and test files at `http://localhost:8080`.

## Building

Build both the Electron app and the manifest generator exe:

```bash
bash build/build.sh
```

Or build them individually:

```bash
# Electron app only → dist/
npm run build

# Manifest generator exe only → manifest-generator/generate-manifest.exe
bash manifest-generator/build.sh
```

## Manifest Format

```json
{
  "version": "1.0.0",
  "name": "My App",
  "baseDownloadUrl": "https://cdn.example.com/files/",
  "files": [
    { "path": "bin/app.exe", "md5": "abc123...", "size": 12345, "url": "bin/app.exe" }
  ]
}
```

Generate one from any folder:

```bash
# With Node.js
node manifest-generator/generate-manifest.js ./my-app --name "My App" --version "2.0.0" --base-url "https://cdn.example.com/files/"

# With standalone exe (no Node.js required)
generate-manifest.exe ./my-app --name "My App" --version "2.0.0" --base-url "https://cdn.example.com/files/"
```

## How It Works

1. User enters a manifest URL and selects a local target folder
2. App fetches the manifest and scans local files, computing MD5 hashes
3. Files are categorized as **up-to-date**, **needs-update**, **new**, or **orphan**
4. User starts the update — files download with 3 concurrent workers, verified by MD5
5. Optionally deletes orphan files not present in the manifest
