/**
 * OctoStream GDPR Privacy Module
 *
 * Provides encryption, integrity verification, and anonymization for rating/feedback data.
 * Designed for privacy-by-compliance with GDPR data minimization principles.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  publicEncrypt,
  privateDecrypt,
  generateKeyPairSync,
  constants,
} from 'crypto';

// ============================================================================
// Data Types
// ============================================================================

/**
 * Structured rating payload for GDPR-compliant event publishing.
 * Contains rating value and optionally encrypted comment.
 * Integrity signature ensures payload hasn't been tampered with.
 */
export interface RatingPayload {
  /** Schema version for forward compatibility */
  v: number;
  /** Bundle identifier being rated */
  bundleId: string;
  /** Rating value (typically 1-5) */
  rating: number;
  /** Encrypted comment (optional) - encrypted with public key */
  comment?: string;
  /** Timestamp in ISO 8601 format */
  ts: string;
  /** Anonymous user hash (no PII) - sha256(userId + salt) */
  userHash?: string;
  /** Integrity signature (HMAC-SHA256 of canonical payload) */
  sig: string;
}

/**
 * Canonical payload components used for signature generation.
 * Excludes the signature itself to prevent circular dependency.
 */
export interface CanonicalPayload {
  v: number;
  bundleId: string;
  rating: number;
  comment?: string;
  ts: string;
  userHash?: string;
}

/**
 * Decrypted comment data available only to authorized processors.
 */
export interface DecryptedFeedback {
  rating: number;
  comment: string;
  bundleId: string;
  timestamp: string;
  userHash: string | null;
  isValid: boolean;
}

/**
 * Aggregated feedback grouped by rating (anonymized for public display).
 */
export interface AggregatedFeedback {
  bundleId: string;
  totalCount: number;
  averageRating: number;
  byRating: Record<number, {
    count: number;
    /** Encrypted comments that can be decrypted by authorized processors */
    encryptedComments: string[];
  }>;
}

// ============================================================================
// Integrity (HMAC-based verification)
// ============================================================================

/**
 * Creates canonical JSON string for signing.
 * Deterministic ordering ensures consistent signatures.
 */
export function canonicalizePayload(payload: CanonicalPayload): string {
  const ordered = {
    v: payload.v,
    bundleId: payload.bundleId,
    rating: payload.rating,
    ...(payload.comment !== undefined && { comment: payload.comment }),
    ts: payload.ts,
    ...(payload.userHash !== undefined && { userHash: payload.userHash }),
  };
  return JSON.stringify(ordered, Object.keys(ordered).sort());
}

/**
 * Generates HMAC-SHA256 signature for payload integrity.
 *
 * @param payload - The canonical payload (without signature)
 * @param secret - Shared secret for HMAC (should be configured in extension + workflow)
 * @returns Base64-encoded HMAC signature
 */
export function signPayload(payload: CanonicalPayload, secret: string): string {
  const canonical = canonicalizePayload(payload);
  return createHmac('sha256', secret).update(canonical).digest('base64');
}

/**
 * Verifies payload integrity using HMAC-SHA256.
 *
 * @param payload - Complete payload with signature
 * @param secret - Shared secret for HMAC verification
 * @returns true if signature is valid
 */
export function verifyPayload(payload: RatingPayload, secret: string): boolean {
  const { sig, ...canonical } = payload;
  const expectedSig = signPayload(canonical, secret);
  try {
    return timingSafeEqualBase64(sig, expectedSig);
  } catch {
    return false;
  }
}

/**
 * Timing-safe comparison for base64 strings to prevent timing attacks.
 */
function timingSafeEqualBase64(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'base64');
  const bufB = Buffer.from(b, 'base64');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return createHash('sha256').update(bufA).digest().equals(
    createHash('sha256').update(bufB).digest()
  );
}

// ============================================================================
// Encryption (RSA for comments)
// ============================================================================

/**
 * Encrypts a comment using RSA-OAEP with SHA-256.
 * Only holders of the private key can decrypt.
 *
 * @param comment - Plain text comment to encrypt
 * @param publicKey - RSA public key (PEM format)
 * @returns Base64-encoded encrypted data
 */
export function encryptComment(comment: string, publicKey: string): string {
  const buffer = Buffer.from(comment, 'utf-8');
  const encrypted = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    buffer
  );
  return encrypted.toString('base64');
}

/**
 * Decrypts a comment using RSA-OAEP with SHA-256.
 * Requires the private key corresponding to the encryption public key.
 *
 * @param encryptedComment - Base64-encoded encrypted data
 * @param privateKey - RSA private key (PEM format)
 * @returns Decrypted plain text comment
 */
export function decryptComment(encryptedComment: string, privateKey: string): string {
  const buffer = Buffer.from(encryptedComment, 'base64');
  const decrypted = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    buffer
  );
  return decrypted.toString('utf-8');
}

// ============================================================================
// User Anonymization
// ============================================================================

/**
 * Generates an anonymized user hash.
 * One-way function ensures user cannot be identified from the hash.
 *
 * @param userId - Original user identifier (e.g., GitHub user ID)
 * @param salt - Cryptographic salt (should be consistent across system)
 * @returns SHA-256 hash as hex string
 */
export function hashUserId(userId: string, salt: string): string {
  return createHash('sha256').update(userId + salt).digest('hex');
}

// ============================================================================
// Key Management
// ============================================================================

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Generates an RSA key pair for encrypting/decrypting comments.
 * In production, the private key should be stored in GitHub Secrets.
 *
 * @param keySize - RSA key size (default 2048, recommend 4096 for production)
 * @returns Object containing PEM-encoded public and private keys
 */
export function generateEncryptionKeyPair(keySize: number = 2048): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: keySize,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * Loads public key from environment variable or uses provided fallback.
 * The public key can be distributed with the extension since it's safe to share.
 *
 * @param envVarName - Environment variable name to check
 * @param fallbackKey - Optional fallback public key (e.g., embedded in extension)
 * @returns Public key in PEM format
 * @throws Error if no key is available
 */
export function loadPublicKey(envVarName: string = 'RATINGS_PUBLIC_KEY', fallbackKey?: string): string {
  const fromEnv = process.env[envVarName];
  if (fromEnv) {
    return fromEnv;
  }
  if (fallbackKey) {
    return fallbackKey;
  }
  throw new Error(
    `Public key not found. Set ${envVarName} environment variable or provide a fallback key.`
  );
}

/**
 * Loads private key from environment variable (for processing jobs only).
 * Should NEVER be distributed with the extension or exposed to clients.
 *
 * @param envVarName - Environment variable name (default: 'RATINGS_PRIVATE_KEY')
 * @returns Private key in PEM format
 * @throws Error if private key is not available
 */
export function loadPrivateKey(envVarName: string = 'RATINGS_PRIVATE_KEY'): string {
  const key = process.env[envVarName];
  if (!key) {
    throw new Error(
      `Private key not found. Set ${envVarName} environment variable.`
    );
  }
  return key;
}

// ============================================================================
// Payload Builder (Producer side - VSCode extension)
// ============================================================================

export interface CreateRatingPayloadOptions {
  bundleId: string;
  rating: number;
  comment?: string;
  userId?: string;
  salt?: string;
  publicKey?: string;
  secret: string;
}

/**
 * Creates a complete, signed RatingPayload ready for publishing.
 * Handles encryption of comments and anonymization of user IDs.
 *
 * @param options - Payload creation options
 * @returns Complete RatingPayload with integrity signature
 */
export function createRatingPayload(options: CreateRatingPayloadOptions): RatingPayload {
  const { bundleId, rating, comment, userId, salt, publicKey, secret } = options;

  // Encrypt comment if provided and public key is available
  let encryptedComment: string | undefined;
  if (comment && publicKey) {
    encryptedComment = encryptComment(comment, publicKey);
  }

  // Generate anonymous user hash if userId provided
  let userHash: string | undefined;
  if (userId && salt) {
    userHash = hashUserId(userId, salt);
  }

  const canonical: CanonicalPayload = {
    v: 1,
    bundleId,
    rating,
    ...(encryptedComment && { comment: encryptedComment }),
    ts: new Date().toISOString(),
    ...(userHash && { userHash }),
  };

  const sig = signPayload(canonical, secret);

  return {
    ...canonical,
    sig,
  };
}

// ============================================================================
// Payload Processor (Consumer side - GitHub Actions workflow)
// ============================================================================

export interface ProcessRatingOptions {
  payload: RatingPayload;
  secret: string;
  privateKey?: string;
}

/**
 * Processes and validates a RatingPayload, optionally decrypting the comment.
 * Used by the aggregation job to verify integrity and extract feedback.
 *
 * @param options - Processing options
 * @returns DecryptedFeedback with validation status
 */
export function processRatingPayload(options: ProcessRatingOptions): DecryptedFeedback {
  const { payload, secret, privateKey } = options;

  // Verify integrity
  const isValid = verifyPayload(payload, secret);

  // Decrypt comment if available and private key provided
  let decryptedComment = '';
  if (payload.comment && privateKey) {
    try {
      decryptedComment = decryptComment(payload.comment, privateKey);
    } catch (error) {
      // Decryption failed - comment remains encrypted
      decryptedComment = '[DECRYPTION_FAILED]';
    }
  } else if (payload.comment) {
    decryptedComment = '[ENCRYPTED]';
  }

  return {
    rating: payload.rating,
    comment: decryptedComment,
    bundleId: payload.bundleId,
    timestamp: payload.ts,
    userHash: payload.userHash ?? null,
    isValid,
  };
}

// ============================================================================
// JSONL Utilities
// ============================================================================

/**
 * Serializes a RatingPayload to a single JSONL line.
 *
 * @param payload - RatingPayload to serialize
 * @returns JSON string (single line, no newlines)
 */
export function toJsonl(payload: RatingPayload): string {
  return JSON.stringify(payload);
}

/**
 * Parses a JSONL line into a RatingPayload.
 *
 * @param line - JSON string (single line)
 * @returns Parsed RatingPayload
 * @throws Error if JSON is invalid
 */
export function fromJsonl(line: string): RatingPayload {
  return JSON.parse(line) as RatingPayload;
}

/**
 * Serializes multiple RatingPayloads to JSONL format.
 *
 * @param payloads - Array of RatingPayloads
 * @returns JSONL string (newline-separated)
 */
export function toJsonlBatch(payloads: RatingPayload[]): string {
  return payloads.map(toJsonl).join('\n');
}

/**
 * Parses a JSONL batch into RatingPayloads.
 *
 * @param jsonl - JSONL string (newline-separated)
 * @returns Array of RatingPayloads
 */
export function fromJsonlBatch(jsonl: string): RatingPayload[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(fromJsonl);
}

// ============================================================================
// Aggregation (for compute-ratings workflow)
// ============================================================================

export interface AggregateOptions {
  /** RatingPayloads to aggregate (with encrypted comments) */
  payloads?: RatingPayload[];
  /** Pre-decrypted feedbacks to aggregate (alternative to payloads) */
  feedbacks?: DecryptedFeedback[];
  /** Secret for payload verification (required when using payloads) */
  secret?: string;
  privateKey?: string;
  /** If true, include decrypted comments in aggregation (requires private key) */
  includeDecryptedComments?: boolean;
}

/**
 * Aggregates multiple RatingPayloads or DecryptedFeedbacks into anonymized feedback statistics.
 * Only valid payloads are included in aggregation.
 *
 * @param options - Aggregation options
 * @returns AggregatedFeedback grouped by rating
 */
export function aggregateRatings(options: AggregateOptions): AggregatedFeedback {
  const { payloads, feedbacks, secret, privateKey, includeDecryptedComments } = options;

  // Handle feedbacks mode (pre-decrypted)
  if (feedbacks && feedbacks.length > 0) {
    const bundleId = feedbacks[0].bundleId;
    const byRating: Record<number, { count: number; encryptedComments: string[] }> = {};
    let totalRating = 0;

    for (const feedback of feedbacks) {
      const rating = feedback.rating;

      if (!byRating[rating]) {
        byRating[rating] = { count: 0, encryptedComments: [] };
      }

      byRating[rating].count += 1;
      totalRating += rating;

      // Store decrypted comment with marker
      if (feedback.comment) {
        byRating[rating].encryptedComments.push(`[DECRYPTED]${feedback.comment}`);
      }
    }

    return {
      bundleId,
      totalCount: feedbacks.length,
      averageRating: totalRating / feedbacks.length,
      byRating,
    };
  }

  // Handle payloads mode (with verification and optional decryption)
  if (!payloads || payloads.length === 0) {
    return {
      bundleId: '',
      totalCount: 0,
      averageRating: 0,
      byRating: {},
    };
  }

  if (!secret) {
    throw new Error('secret is required when aggregating payloads');
  }

  const validPayloads = payloads.filter((p) => verifyPayload(p, secret));

  if (validPayloads.length === 0) {
    return {
      bundleId: '',
      totalCount: 0,
      averageRating: 0,
      byRating: {},
    };
  }

  const bundleId = validPayloads[0].bundleId;
  const byRating: Record<number, { count: number; encryptedComments: string[] }> = {};
  let totalRating = 0;

  for (const payload of validPayloads) {
    const rating = payload.rating;

    if (!byRating[rating]) {
      byRating[rating] = { count: 0, encryptedComments: [] };
    }

    byRating[rating].count += 1;
    totalRating += rating;

    // Store encrypted comment or decrypted if requested and available
    if (payload.comment) {
      if (includeDecryptedComments && privateKey) {
        try {
          const decrypted = decryptComment(payload.comment, privateKey);
          // Store with a marker to indicate it's decrypted
          byRating[rating].encryptedComments.push(`[DECRYPTED]${decrypted}`);
        } catch {
          byRating[rating].encryptedComments.push(payload.comment);
        }
      } else {
        byRating[rating].encryptedComments.push(payload.comment);
      }
    }
  }

  return {
    bundleId,
    totalCount: validPayloads.length,
    averageRating: totalRating / validPayloads.length,
    byRating,
  };
}

// ============================================================================
// Timestamped integrity signature (inspired by webhook signature patterns)
// ============================================================================

export interface TimestampedSignatureResult {
  signature: string;
  timestamp: string;
  algorithm: string;
}

/**
 * Generates a timestamped HMAC signature for payload integrity with replay protection.
 * Similar pattern to webhook signatures but for our encrypted payload use case.
 * Format: sha256=<hex_hmac>
 *
 * @param payload - String payload to sign
 * @param secret - Shared secret
 * @returns Signature result with algorithm and timestamp
 */
export function generateTimestampedSignature(payload: string, secret: string): TimestampedSignatureResult {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `t=${timestamp}.${payload}`;
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');

  return {
    signature: `sha256=${signature}`,
    timestamp,
    algorithm: 'sha256',
  };
}

/**
 * Verifies a timestamped HMAC signature with replay protection.
 *
 * @param payload - Original payload string
 * @param signature - Signature header value (e.g., "sha256=abc123...")
 * @param secret - Shared secret
 * @param timestamp - Timestamp header value (Unix epoch seconds)
 * @param toleranceSeconds - Maximum age of timestamp (default 300 = 5 min)
 * @returns true if signature is valid and within tolerance
 */
export function verifyTimestampedSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  toleranceSeconds: number = 300
): boolean {
  // Check timestamp to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > toleranceSeconds) {
    return false;
  }

  // Verify signature format
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  // Recompute signature
  const signedPayload = `t=${timestamp}.${payload}`;
  const expected = 'sha256=' + createHmac('sha256', secret).update(signedPayload).digest('hex');

  return timingSafeEqualHex(signature.slice(7), expected.slice(7));
}

/**
 * Timing-safe comparison for hex strings.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return createHash('sha256').update(bufA).digest().equals(
    createHash('sha256').update(bufB).digest()
  );
}
