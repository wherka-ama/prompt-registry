#!/bin/sh
# Build SEA binaries for multiple platforms using Docker

set -e

# Platforms to build
PLATFORMS="linux/amd64 linux/arm64 darwin/amd64 darwin/arm64"

# Output directory
OUTPUT_DIR="./dist/sea"
mkdir -p "$OUTPUT_DIR"

echo "Building SEA binaries for multiple platforms..."

for PLATFORM in $PLATFORMS; do
  echo "Building for $PLATFORM..."
  
  # Extract OS and ARCH from platform string
  OS=$(echo "$PLATFORM" | cut -d'/' -f1)
  ARCH=$(echo "$PLATFORM" | cut -d'/' -f2)
  
  # Determine output filename
  OUTPUT_NAME="prompt-registry-${OS}-${ARCH}"
  if [ "$OS" = "linux" ]; then
    OUTPUT_NAME="prompt-registry-${ARCH}"
  fi
  
  # Build using Docker
  docker buildx build \
    --platform "$PLATFORM" \
    --file Dockerfile \
    --output "type=local,dest=$OUTPUT_DIR/$OUTPUT_NAME" \
    --progress=plain \
    .
  
  echo "Built: $OUTPUT_DIR/$OUTPUT_NAME"
done

echo "All binaries built successfully in $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"
