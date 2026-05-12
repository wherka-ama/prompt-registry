# Multi-stage Dockerfile for building SEA binaries across platforms

# Builder stage - builds the SEA binary
FROM node:20-bullseye AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Bundle with esbuild
RUN node esbuild.config.mjs

# Generate SEA blob
RUN node --experimental-sea-config sea-config.json

# Copy node executable and inject blob
RUN cp "$(command -v node)" /tmp/prompt-registry
RUN npx -y postject /tmp/prompt-registry NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# Make executable
RUN chmod +x /tmp/prompt-registry

# Clean up blob
RUN rm -f sea-prep.blob

# Final stage - minimal runtime
FROM scratch

# Copy the binary from builder
COPY --from=builder /tmp/prompt-registry /prompt-registry

# Set entrypoint
ENTRYPOINT ["/prompt-registry"]
