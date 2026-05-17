#!/bin/sh
# Generate a single executable application (SEA) for prompt-registry CLI

set -e

# Check that the path to the output binary is passed as an argument
if [ -z "$1" ]; then
  echo "Usage: $0 <output_binary_path>"
  exit 1
fi

OUTPUT_PATH="$1"

echo "Building TypeScript..."
npm run build

echo "Bundling with esbuild..."
node esbuild.config.mjs

echo "Generating SEA blob..."
node --experimental-sea-config sea-config.json

echo "Copying Node executable..."
cp "$(command -v node)" "$OUTPUT_PATH"

if [ "$(uname)" = "Darwin" ]; then
  echo "Removing signature (macOS)..."
  codesign --remove-signature "$OUTPUT_PATH" || true
fi

echo "Injecting blob with postject..."
npx -y postject "$OUTPUT_PATH" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

if [ "$(uname)" = "Darwin" ]; then
  echo "Signing binary (macOS)..."
  codesign --sign - "$OUTPUT_PATH" || true
fi

echo "Making executable..."
chmod +x "$OUTPUT_PATH"

echo "Generating checksum..."
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$OUTPUT_PATH" > "$OUTPUT_PATH.sha256"
  echo "Checksum: $(cat "$OUTPUT_PATH.sha256" | cut -d' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$OUTPUT_PATH" > "$OUTPUT_PATH.sha256"
  echo "Checksum: $(cat "$OUTPUT_PATH.sha256" | cut -d' ' -f1)"
fi

echo "Cleaning up..."
rm -f sea-prep.blob

echo "Single executable created at: $OUTPUT_PATH"
echo "File size: $(du -h "$OUTPUT_PATH" | cut -f1)"

