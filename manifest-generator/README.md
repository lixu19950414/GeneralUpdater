# Manifest Generator

Standalone CLI tool that scans a folder, computes MD5 hashes for all files, and outputs a `manifest.json` compatible with the updater app. No external dependencies — uses only Node.js built-ins.

## Usage

```
node generate-manifest.js <folder> [options]
```

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
