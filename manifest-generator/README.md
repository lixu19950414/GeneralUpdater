# Manifest Generator

Standalone CLI tool that scans a folder, computes MD5 hashes for all files, and outputs a `manifest.json` compatible with the updater app. No external dependencies — uses only Node.js built-ins.

## Usage

### With Node.js

```
node generate-manifest.js <folder> [options]
```

### Standalone exe (no Node.js required)

```
generate-manifest.exe <folder> [options]
```

To build the exe from source:

```bash
bash build.sh
```

This uses Node.js [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) to produce `generate-manifest.exe`. Requires Node.js v20+ and `npx` (for `postject`).

### Arguments

| Argument | Description |
|---|---|
| `<folder>` | Directory to scan (required) |

### Options

| Option | Description | Default |
|---|---|---|
| `--name <name>` | Application name | Folder name |
| `--version <version>` | Version string | `"1.0.0"` |
| `--base-url <url>` | `baseDownloadUrl` value | `""` |
| `--output, -o <path>` | Output file path | `manifest.json` |

### Example

```bash
node generate-manifest.js ./my-app --name "My App" --version "2.0.0" --base-url "https://cdn.example.com/files/" -o manifest.json

# or with the standalone exe
generate-manifest.exe ./my-app --name "My App" --version "2.0.0" --base-url "https://cdn.example.com/files/" -o manifest.json
```

## Output Format

```json
{
  "version": "2.0.0",
  "name": "My App",
  "baseDownloadUrl": "https://cdn.example.com/files/",
  "files": [
    { "path": "bin/app.exe", "md5": "abc123...", "size": 12345, "url": "bin/app.exe" }
  ]
}
```

- `path` and `url` use forward slashes, relative to the scanned folder
- Files are sorted alphabetically by path
