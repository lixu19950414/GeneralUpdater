#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/build"

echo "========================================"
echo " Building electron-file-updater"
echo "========================================"
echo ""

# --- 1. Electron app ---
echo "--- [1/2] Electron app ---"
cd "$ROOT"
npm run build
echo ""

# --- 2. Manifest generator (SEA exe) ---
echo "--- [2/2] Manifest generator exe ---"
bash "$ROOT/manifest-generator/build.sh"

# Copy exe into build/
cp "$ROOT/manifest-generator/generate-manifest.exe" "$BUILD_DIR/"
echo ""

echo "========================================"
echo " Build complete"
echo "========================================"
echo ""
echo "Outputs:"
echo "  Electron app:         dist/GeneralUpdater-win32-x64/"
echo "  Manifest generator:   build/generate-manifest.exe"
