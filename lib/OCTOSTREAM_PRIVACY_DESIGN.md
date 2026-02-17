# OctoStream Privacy Design (GDPR-Compliant)

## Overview

This document describes the privacy-by-design architecture for GDPR-compliant rating and feedback collection in OctoStream. The system ensures that sensitive user feedback is encrypted and anonymized while maintaining data integrity for trustless processing.

## Goals

1. **Data Minimization** - Only collect necessary data, anonymize user identifiers
2. **Encryption at Rest** - Comments encrypted with public key before transmission
3. **Integrity Verification** - Tamper-evident payloads using HMAC signatures
4. **Privacy by Design** - No PII exposed in public discussions
5. **Compliant Aggregation** - Only authorized processors can decrypt and aggregate

## Architecture

```
VSCode Extension (Producer)
├── Collects rating (1-5) and optional comment
├── Encrypts comment with RSA public key
├── Creates anonymous user hash (SHA-256 + salt)
├── Signs payload with HMAC-SHA256
└── Publishes to GitHub Discussion (JSONL format)

GitHub Discussion (Public)
└── Encrypted JSONL lines (no readable PII)

GitHub Actions Workflow (Consumer)
├── Fetches encrypted payloads
├── Verifies HMAC signatures (integrity)
├── Decrypts comments with private key (from secrets)
├── Aggregates by rating (anonymized)
└── Updates ratings.json (public stats only)
```

## Data Format

### RatingPayload (JSONL)

```json
{
  "v": 1,
  "bundleId": "org/bundle-name",
  "rating": 5,
  "comment": "base64(RSA-OAEP-encrypted-comment)",
  "ts": "2024-01-15T10:30:00Z",
  "userHash": "sha256(userId + salt)",
  "sig": "base64(HMAC-SHA256(canonical-payload))"
}
```

### Field Descriptions

- `v` - Schema version for forward compatibility
- `bundleId` - Identifier of the bundle being rated
- `rating` - Numeric rating (typically 1-5)
- `comment` - **Encrypted** feedback (RSA-OAEP with SHA-256)
- `ts` - ISO 8601 timestamp
- `userHash` - Anonymous user identifier (one-way hash)
- `sig` - HMAC signature for integrity verification

## Encryption Scheme

### Comment Encryption

- **Algorithm**: RSA-OAEP with SHA-256
- **Key Size**: 2048-bit (recommend 4096 for production)
- **Payload Limit**: ~190 bytes for RSA-2048
- **Encoding**: Base64 for transport

### Key Management

```
Public Key: Distributed with VSCode extension (safe to share)
            OR fetched from well-known endpoint
            
Private Key: Stored in GitHub Secrets (RATINGS_PRIVATE_KEY)
             Only accessible by trusted workflow
             NEVER exposed to clients
```

## Integrity Verification

### HMAC-SHA256 Signature

1. Create canonical JSON (alphabetically ordered keys)
2. Exclude the `sig` field from signing
3. Compute HMAC-SHA256 with shared secret
4. Base64 encode the 32-byte digest

### Verification Flow

```typescript
const isValid = verifyPayload(payload, sharedSecret);
if (!isValid) {
  // Reject tampered payload
}
```

### Webhook-Style Alternative

For GitHub-compatible verification:

```
Signature: sha256=<hex_hmac>
Timestamp: Unix epoch seconds
Format:    t=<timestamp>.<payload>
```

## User Anonymization

### Hash Function

```typescript
userHash = SHA256(userId + salt)
```

- **Deterministic**: Same user → same hash
- **Non-reversible**: Cannot recover original userId
- **Salted**: Different salt → different hash
- **Fixed Length**: 64 hex characters

## Usage Examples

### Producer (VSCode Extension)

```typescript
import {
  generateEncryptionKeyPair,
  createRatingPayload,
  toJsonl
} from '@prompt-registry/collection-scripts';

// Generate keys (one-time setup)
const { publicKey, privateKey } = generateEncryptionKeyPair(2048);
// Store publicKey in extension, privateKey in GitHub Secrets

// Create payload
const payload = createRatingPayload({
  bundleId: 'amadeus/java-patterns',
  rating: 5,
  comment: 'This helped me refactor my code!',
  userId: 'github-user-123',
  salt: process.env.ANONYMIZATION_SALT,
  publicKey: embeddedPublicKey,
  secret: process.env.HMAC_SECRET,
});

// Post to GitHub Discussion
const jsonl = toJsonl(payload);
await client.addDiscussionComment(discussionId, jsonl);
```

### Consumer (GitHub Actions)

```typescript
import {
  loadPrivateKey,
  processRatingPayload,
  aggregateRatings,
  fromJsonlBatch
} from '@prompt-registry/collection-scripts';

const privateKey = loadPrivateKey('RATINGS_PRIVATE_KEY');

// Process payloads
const payloads = fromJsonlBatch(discussionComments);

const decrypted = payloads.map(p => 
  processRatingPayload({
    payload: p,
    secret: process.env.HMAC_SECRET,
    privateKey
  })
);

// Aggregate for public display
const aggregated = aggregateRatings({
  payloads,
  secret: process.env.HMAC_SECRET,
  privateKey,
  includeDecryptedComments: true  // For internal processing
});

// Output: { bundleId, totalCount, averageRating, byRating: { 5: { count, comments[] } } }
```

## Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Comment tampering | HMAC signature verification |
| Comment disclosure | RSA encryption (only processor can decrypt) |
| Replay attacks | Timestamp + cursor checkpointing |
| User tracking | One-way hash + salt |
| Key exposure | Separate public/private key distribution |

### GDPR Compliance

1. **Data Minimization** - Only store rating + encrypted comment + hash
2. **Pseudonymization** - userHash is not reversible without salt
3. **Encryption** - Comments encrypted at rest and in transit
4. **Right to erasure** - Can delete discussion comments on request
5. **Transparency** - Privacy notice in extension

## Deployment Guide

### 1. Generate Key Pair

```bash
npx ts-node -e "
const { generateEncryptionKeyPair } = require('./dist/octostream-privacy');
const keys = generateEncryptionKeyPair(4096);
console.log('=== PUBLIC KEY (distribute with extension) ===');
console.log(keys.publicKey);
console.log('=== PRIVATE KEY (add to GitHub Secrets) ===');
console.log(keys.privateKey);
"
```

### 2. Configure GitHub Secrets

```
RATINGS_PRIVATE_KEY     # RSA private key (PEM)
HMAC_SECRET            # Shared secret for integrity
ANONYMIZATION_SALT     # Salt for user hashing (optional)
```

### 3. Embed Public Key

Include the public key in the VSCode extension bundle or make it fetchable from a well-known endpoint.

### 4. Set Up Discussion

Create a GitHub Discussion for each shard and configure the workflow to process it.

## API Reference

See `lib/src/octostream-privacy.ts` for full API:

- `createRatingPayload()` - Producer-side payload creation
- `processRatingPayload()` - Consumer-side processing
- `encryptComment()` / `decryptComment()` - RSA encryption
- `signPayload()` / `verifyPayload()` - HMAC integrity
- `hashUserId()` - User anonymization
- `aggregateRatings()` - Batch aggregation
- `toJsonl()` / `fromJsonl()` - Serialization
- `generateWebhookSignature()` / `verifyWebhookSignature()` - GitHub-style signatures

## Testing

Run privacy module tests:

```bash
cd lib
npx mocha --require ts-node/register 'test/octostream-privacy.test.ts'
```

## Future Enhancements

1. **Hybrid Encryption** - Use RSA to encrypt AES key for larger comments
2. **Key Rotation** - Support versioned keys with `kid` field
3. **Blind Signatures** - Anonymous credentials for rating authentication
4. **Differential Privacy** - Add noise to aggregate statistics
5. **Zero-Knowledge Proofs** - Prove valid rating without revealing details
