#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Step 1: Generate SEA blob ==="
node --experimental-sea-config sea-config.json

echo "=== Step 2: Copy node.exe → generate-manifest.exe ==="
NODE_EXE="$(command -v node)"
cp "$NODE_EXE" generate-manifest.exe

echo "=== Step 3: Remove signature (optional) ==="
if command -v signtool &>/dev/null; then
  signtool remove /s generate-manifest.exe || echo "signtool remove failed, continuing anyway"
else
  echo "signtool not found, skipping signature removal"
fi

echo "=== Step 4: Inject blob with postject ==="
npx --yes postject generate-manifest.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

echo "=== Step 5: Clean up ==="
rm -f sea-prep.blob

echo ""
echo "Done! Built: generate-manifest.exe"
ls -lh generate-manifest.exe
