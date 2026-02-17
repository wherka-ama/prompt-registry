/**
 * OctoStream Privacy Module Tests
 *
 * Tests for GDPR-compliant rating/feedback encryption, integrity, and anonymization.
 */

import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import {
  canonicalizePayload,
  signPayload,
  verifyPayload,
  encryptComment,
  decryptComment,
  hashUserId,
  generateEncryptionKeyPair,
  loadPublicKey,
  loadPrivateKey,
  createRatingPayload,
  processRatingPayload,
  toJsonl,
  fromJsonl,
  toJsonlBatch,
  fromJsonlBatch,
  aggregateRatings,
  generateTimestampedSignature,
  verifyTimestampedSignature,
  type RatingPayload,
} from '../src/octostream-privacy';

describe('octostream-privacy', () => {
  const testSecret = 'test-webhook-secret-for-hmac-signing';
  const testSalt = 'test-anonymization-salt-value';

  // ============================================================================
  // Canonicalization
  // ============================================================================
  describe('canonicalizePayload', () => {
    it('should produce deterministic JSON output', () => {
      const payload = {
        v: 1,
        bundleId: 'test-bundle',
        rating: 5,
        comment: 'encrypted-data-here',
        ts: '2024-01-15T10:30:00Z',
        userHash: 'abc123',
      };

      const result1 = canonicalizePayload(payload);
      const result2 = canonicalizePayload(payload);

      assert.equal(result1, result2, 'Canonicalization should be deterministic');
    });

    it('should order keys alphabetically', () => {
      const payload = {
        ts: '2024-01-15T10:30:00Z',
        rating: 5,
        v: 1,
        bundleId: 'test-bundle',
      };

      const result = canonicalizePayload(payload);

      // Keys should be ordered: bundleId, rating, ts, v
      assert.ok(result.indexOf('bundleId') < result.indexOf('rating'));
      assert.ok(result.indexOf('rating') < result.indexOf('ts'));
      assert.ok(result.indexOf('ts') < result.indexOf('v'));
    });

    it('should omit undefined fields', () => {
      const payload = {
        v: 1,
        bundleId: 'test-bundle',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
      };

      const result = canonicalizePayload(payload);

      assert.ok(!result.includes('comment'), 'Should not include comment field');
      assert.ok(!result.includes('userHash'), 'Should not include userHash field');
    });
  });

  // ============================================================================
  // Integrity (HMAC)
  // ============================================================================
  describe('signPayload', () => {
    it('should generate base64-encoded HMAC signature', () => {
      const payload = {
        v: 1,
        bundleId: 'test-bundle',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
      };

      const sig = signPayload(payload, testSecret);

      // Should be valid base64
      const decoded = Buffer.from(sig, 'base64');
      assert.ok(decoded.length > 0, 'Signature should decode to non-empty buffer');
      // HMAC-SHA256 produces 32 bytes
      assert.equal(decoded.length, 32, 'HMAC-SHA256 should be 32 bytes');
    });

    it('should produce different signatures for different payloads', () => {
      const payload1 = {
        v: 1,
        bundleId: 'bundle-a',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
      };
      const payload2 = {
        v: 1,
        bundleId: 'bundle-b',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
      };

      const sig1 = signPayload(payload1, testSecret);
      const sig2 = signPayload(payload2, testSecret);

      assert.notEqual(sig1, sig2, 'Different payloads should have different signatures');
    });

    it('should produce different signatures for different secrets', () => {
      const payload = {
        v: 1,
        bundleId: 'test-bundle',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
      };

      const sig1 = signPayload(payload, 'secret-a');
      const sig2 = signPayload(payload, 'secret-b');

      assert.notEqual(sig1, sig2, 'Different secrets should produce different signatures');
    });
  });

  describe('verifyPayload', () => {
    it('should verify valid payload signature', () => {
      const payload: RatingPayload = {
        v: 1,
        bundleId: 'test-bundle',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
        sig: '',
      };

      payload.sig = signPayload(payload, testSecret);

      const isValid = verifyPayload(payload, testSecret);

      assert.equal(isValid, true, 'Valid signature should verify');
    });

    it('should reject tampered payload', () => {
      const payload: RatingPayload = {
        v: 1,
        bundleId: 'test-bundle',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
        sig: '',
      };

      payload.sig = signPayload(payload, testSecret);

      // Tamper with the rating
      payload.rating = 1;

      const isValid = verifyPayload(payload, testSecret);

      assert.equal(isValid, false, 'Tampered payload should not verify');
    });

    it('should reject payload with wrong secret', () => {
      const payload: RatingPayload = {
        v: 1,
        bundleId: 'test-bundle',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
        sig: '',
      };

      payload.sig = signPayload(payload, testSecret);

      const isValid = verifyPayload(payload, 'wrong-secret');

      assert.equal(isValid, false, 'Wrong secret should not verify');
    });
  });

  // ============================================================================
  // Encryption (RSA)
  // ============================================================================
  describe('encryptComment / decryptComment', () => {
    const { publicKey, privateKey } = generateEncryptionKeyPair(2048);

    it('should encrypt and decrypt comment successfully', () => {
      const comment = 'This is a private feedback comment';

      const encrypted = encryptComment(comment, publicKey);
      const decrypted = decryptComment(encrypted, privateKey);

      assert.equal(decrypted, comment, 'Decrypted comment should match original');
    });

    it('should produce different ciphertext for same comment (OAEP padding)', () => {
      const comment = 'Same comment';

      const encrypted1 = encryptComment(comment, publicKey);
      const encrypted2 = encryptComment(comment, publicKey);

      // OAEP uses random padding, so ciphertexts should differ
      assert.notEqual(encrypted1, encrypted2, 'Same comment should produce different ciphertexts');

      // But both should decrypt to the same value
      assert.equal(decryptComment(encrypted1, privateKey), comment);
      assert.equal(decryptComment(encrypted2, privateKey), comment);
    });

    it('should handle unicode characters', () => {
      const comment = 'Unicode: 你好 🎉 émoji ñoño';

      const encrypted = encryptComment(comment, publicKey);
      const decrypted = decryptComment(encrypted, privateKey);

      assert.equal(decrypted, comment, 'Should handle unicode correctly');
    });

    it('should handle empty string', () => {
      const comment = '';

      const encrypted = encryptComment(comment, publicKey);
      const decrypted = decryptComment(encrypted, privateKey);

      assert.equal(decrypted, comment, 'Should handle empty string');
    });

    it('should fail to decrypt with wrong private key', () => {
      const { privateKey: wrongKey } = generateEncryptionKeyPair(2048);
      const comment = 'Secret comment';

      const encrypted = encryptComment(comment, publicKey);

      assert.throws(() => {
        decryptComment(encrypted, wrongKey);
      }, /Error/, 'Should fail to decrypt with wrong key');
    });

    it('should handle large comments up to RSA limit', () => {
      // RSA-2048 with OAEP-SHA256 can handle ~190 bytes
      const maxLength = 190;
      const comment = 'a'.repeat(maxLength);

      const encrypted = encryptComment(comment, publicKey);
      const decrypted = decryptComment(encrypted, privateKey);

      assert.equal(decrypted, comment, 'Should handle maximum length comment');
    });
  });

  // ============================================================================
  // User Anonymization
  // ============================================================================
  describe('hashUserId', () => {
    it('should produce consistent hash for same input', () => {
      const userId = 'github-user-123';

      const hash1 = hashUserId(userId, testSalt);
      const hash2 = hashUserId(userId, testSalt);

      assert.equal(hash1, hash2, 'Same input should produce same hash');
    });

    it('should produce different hash for different user', () => {
      const hash1 = hashUserId('user-a', testSalt);
      const hash2 = hashUserId('user-b', testSalt);

      assert.notEqual(hash1, hash2, 'Different users should have different hashes');
    });

    it('should produce different hash for different salt', () => {
      const userId = 'user-123';

      const hash1 = hashUserId(userId, 'salt-a');
      const hash2 = hashUserId(userId, 'salt-b');

      assert.notEqual(hash1, hash2, 'Different salts should produce different hashes');
    });

    it('should produce 64 character hex string (SHA-256)', () => {
      const hash = hashUserId('user-123', testSalt);

      assert.equal(hash.length, 64, 'SHA-256 hex should be 64 characters');
      assert.ok(/^[a-f0-9]+$/.test(hash), 'Should be valid hex string');
    });
  });

  // ============================================================================
  // Key Management
  // ============================================================================
  describe('generateEncryptionKeyPair', () => {
    it('should generate valid RSA key pair', () => {
      const { publicKey, privateKey } = generateEncryptionKeyPair(2048);

      assert.ok(publicKey.includes('BEGIN PUBLIC KEY'), 'Should have PEM public key header');
      assert.ok(publicKey.includes('END PUBLIC KEY'), 'Should have PEM public key footer');
      assert.ok(privateKey.includes('BEGIN PRIVATE KEY'), 'Should have PEM private key header');
      assert.ok(privateKey.includes('END PRIVATE KEY'), 'Should have PEM private key footer');
    });

    it('should generate keys that can encrypt/decrypt', () => {
      const { publicKey, privateKey } = generateEncryptionKeyPair(2048);

      const message = 'Test message';
      const encrypted = encryptComment(message, publicKey);
      const decrypted = decryptComment(encrypted, privateKey);

      assert.equal(decrypted, message, 'Generated keys should work for encryption');
    });
  });

  describe('loadPublicKey', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should load key from environment variable', () => {
      const { publicKey } = generateEncryptionKeyPair(2048);
      process.env.TEST_PUBLIC_KEY = publicKey;

      const loaded = loadPublicKey('TEST_PUBLIC_KEY');

      assert.equal(loaded, publicKey, 'Should load from environment');
    });

    it('should use fallback when env var not set', () => {
      const { publicKey } = generateEncryptionKeyPair(2048);

      const loaded = loadPublicKey('NONEXISTENT_VAR', publicKey);

      assert.equal(loaded, publicKey, 'Should use fallback key');
    });

    it('should prefer environment over fallback', () => {
      const { publicKey: envKey } = generateEncryptionKeyPair(2048);
      const { publicKey: fallbackKey } = generateEncryptionKeyPair(2048);
      process.env.PREFER_ENV = envKey;

      const loaded = loadPublicKey('PREFER_ENV', fallbackKey);

      assert.equal(loaded, envKey, 'Should prefer environment variable');
    });

    it('should throw when no key available', () => {
      assert.throws(() => {
        loadPublicKey('NONEXISTENT_VAR');
      }, /not found/i, 'Should throw when no key available');
    });
  });

  describe('loadPrivateKey', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should load private key from environment variable', () => {
      const { privateKey } = generateEncryptionKeyPair(2048);
      process.env.TEST_PRIVATE_KEY = privateKey;

      const loaded = loadPrivateKey('TEST_PRIVATE_KEY');

      assert.equal(loaded, privateKey, 'Should load from environment');
    });

    it('should throw when private key not available', () => {
      delete process.env.RATINGS_PRIVATE_KEY;

      assert.throws(() => {
        loadPrivateKey('RATINGS_PRIVATE_KEY');
      }, /not found/i, 'Should throw when private key not available');
    });
  });

  // ============================================================================
  // Payload Creation (Producer side)
  // ============================================================================
  describe('createRatingPayload', () => {
    const { publicKey } = generateEncryptionKeyPair(2048);

    it('should create valid signed payload with all fields', () => {
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 5,
        comment: 'Great bundle!',
        userId: 'user-123',
        salt: testSalt,
        publicKey,
        secret: testSecret,
      });

      assert.equal(payload.v, 1, 'Should have version 1');
      assert.equal(payload.bundleId, 'test-bundle');
      assert.equal(payload.rating, 5);
      assert.ok(payload.ts, 'Should have timestamp');
      assert.ok(payload.comment, 'Should have encrypted comment');
      assert.ok(payload.userHash, 'Should have user hash');
      assert.ok(payload.sig, 'Should have signature');

      // Verify signature
      assert.ok(verifyPayload(payload, testSecret), 'Signature should be valid');
    });

    it('should create payload without optional fields', () => {
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 4,
        secret: testSecret,
      });

      assert.equal(payload.rating, 4);
      assert.equal(payload.comment, undefined, 'Should not have comment');
      assert.equal(payload.userHash, undefined, 'Should not have user hash');
      assert.ok(verifyPayload(payload, testSecret), 'Signature should be valid');
    });

    it('should not encrypt comment if no public key provided', () => {
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 5,
        comment: 'Plain text comment',
        secret: testSecret,
      });

      assert.equal(payload.comment, undefined, 'Should not include unencrypted comment');
    });

    it('should hash user ID when salt provided', () => {
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 5,
        userId: 'github-user-789',
        salt: testSalt,
        secret: testSecret,
      });

      assert.ok(payload.userHash, 'Should have user hash');
      assert.equal(payload.userHash, hashUserId('github-user-789', testSalt));
    });
  });

  // ============================================================================
  // Payload Processing (Consumer side)
  // ============================================================================
  describe('processRatingPayload', () => {
    const { publicKey, privateKey } = generateEncryptionKeyPair(2048);

    it('should process and validate valid payload', () => {
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 5,
        comment: 'Excellent!',
        publicKey,
        secret: testSecret,
      });

      const result = processRatingPayload({
        payload,
        secret: testSecret,
        privateKey,
      });

      assert.equal(result.isValid, true);
      assert.equal(result.rating, 5);
      assert.equal(result.comment, 'Excellent!');
      assert.equal(result.bundleId, 'test-bundle');
    });

    it('should mark tampered payload as invalid', () => {
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 5,
        secret: testSecret,
      });

      // Tamper with payload
      payload.rating = 1;

      const result = processRatingPayload({
        payload,
        secret: testSecret,
      });

      assert.equal(result.isValid, false);
    });

    it('should show [ENCRYPTED] when comment exists but no private key', () => {
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 5,
        comment: 'Secret',
        publicKey,
        secret: testSecret,
      });

      const result = processRatingPayload({
        payload,
        secret: testSecret,
        // no privateKey
      });

      assert.equal(result.comment, '[ENCRYPTED]');
    });

    it('should handle decryption failure gracefully', () => {
      const { publicKey: otherPublic } = generateEncryptionKeyPair(2048);
      const payload = createRatingPayload({
        bundleId: 'test-bundle',
        rating: 5,
        comment: 'Secret',
        publicKey: otherPublic,
        secret: testSecret,
      });

      // Try to decrypt with different private key
      const result = processRatingPayload({
        payload,
        secret: testSecret,
        privateKey,
      });

      assert.equal(result.comment, '[DECRYPTION_FAILED]');
    });
  });

  // ============================================================================
  // JSONL Utilities
  // ============================================================================
  describe('toJsonl / fromJsonl', () => {
    it('should serialize and deserialize single payload', () => {
      const payload: RatingPayload = {
        v: 1,
        bundleId: 'test',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
        sig: 'test-sig',
      };

      const jsonl = toJsonl(payload);
      const parsed = fromJsonl(jsonl);

      assert.deepEqual(parsed, payload);
    });

    it('should not contain newlines', () => {
      const payload: RatingPayload = {
        v: 1,
        bundleId: 'test',
        rating: 5,
        ts: '2024-01-15T10:30:00Z',
        sig: 'test-sig',
      };

      const jsonl = toJsonl(payload);

      assert.ok(!jsonl.includes('\n'), 'JSONL line should not contain newlines');
    });
  });

  describe('toJsonlBatch / fromJsonlBatch', () => {
    it('should serialize and deserialize batch', () => {
      const payloads: RatingPayload[] = [
        { v: 1, bundleId: 'bundle-a', rating: 5, ts: '2024-01-15T10:30:00Z', sig: 'sig-a' },
        { v: 1, bundleId: 'bundle-b', rating: 4, ts: '2024-01-15T10:31:00Z', sig: 'sig-b' },
        { v: 1, bundleId: 'bundle-c', rating: 3, ts: '2024-01-15T10:32:00Z', sig: 'sig-c' },
      ];

      const jsonl = toJsonlBatch(payloads);
      const parsed = fromJsonlBatch(jsonl);

      assert.equal(parsed.length, 3);
      assert.deepEqual(parsed, payloads);
    });

    it('should handle empty array', () => {
      const jsonl = toJsonlBatch([]);
      const parsed = fromJsonlBatch(jsonl);

      assert.equal(parsed.length, 0);
    });

    it('should ignore empty lines when parsing', () => {
      const jsonl = `
        {"v":1,"bundleId":"a","rating":5,"ts":"2024-01-15T10:30:00Z","sig":"sig"}

        {"v":1,"bundleId":"b","rating":4,"ts":"2024-01-15T10:31:00Z","sig":"sig"}
      `;

      const parsed = fromJsonlBatch(jsonl);

      assert.equal(parsed.length, 2);
    });
  });

  // ============================================================================
  // Aggregation
  // ============================================================================
  describe('aggregateRatings', () => {
    const { publicKey } = generateEncryptionKeyPair(2048);

    it('should aggregate valid ratings by rating value', () => {
      const payloads = [
        createRatingPayload({ bundleId: 'bundle-x', rating: 5, publicKey, secret: testSecret }),
        createRatingPayload({ bundleId: 'bundle-x', rating: 5, publicKey, secret: testSecret }),
        createRatingPayload({ bundleId: 'bundle-x', rating: 4, publicKey, secret: testSecret }),
        createRatingPayload({ bundleId: 'bundle-x', rating: 3, publicKey, secret: testSecret }),
      ];

      const agg = aggregateRatings({ payloads, secret: testSecret });

      assert.equal(agg.bundleId, 'bundle-x');
      assert.equal(agg.totalCount, 4);
      assert.equal(agg.averageRating, 4.25);
      assert.equal(agg.byRating[5].count, 2);
      assert.equal(agg.byRating[4].count, 1);
      assert.equal(agg.byRating[3].count, 1);
    });

    it('should exclude invalid payloads', () => {
      const valid = createRatingPayload({ bundleId: 'bundle-x', rating: 5, publicKey, secret: testSecret });
      const invalid = createRatingPayload({ bundleId: 'bundle-x', rating: 4, publicKey, secret: testSecret });
      invalid.rating = 1; // Tamper

      const agg = aggregateRatings({ payloads: [valid, invalid], secret: testSecret });

      assert.equal(agg.totalCount, 1);
      assert.equal(agg.averageRating, 5);
    });

    it('should handle empty result when all invalid', () => {
      const payload = createRatingPayload({ bundleId: 'bundle-x', rating: 5, publicKey, secret: testSecret });
      payload.rating = 999; // Tamper

      const agg = aggregateRatings({ payloads: [payload], secret: testSecret });

      assert.equal(agg.totalCount, 0);
      assert.equal(agg.averageRating, 0);
    });

    it('should include encrypted comments in aggregation', () => {
      const payloads = [
        createRatingPayload({ bundleId: 'bundle-x', rating: 5, comment: 'Great!', publicKey, secret: testSecret }),
        createRatingPayload({ bundleId: 'bundle-x', rating: 5, comment: 'Awesome!', publicKey, secret: testSecret }),
      ];

      const agg = aggregateRatings({ payloads, secret: testSecret });

      assert.equal(agg.byRating[5].encryptedComments.length, 2);
    });
  });

  // ============================================================================
  // Timestamped Signatures
  // ============================================================================
  describe('generateTimestampedSignature / verifyTimestampedSignature', () => {
    it('should generate and verify valid timestamped signature', () => {
      const payload = '{"bundleId":"test","rating":5}';

      const sig = generateTimestampedSignature(payload, testSecret);
      const isValid = verifyTimestampedSignature(
        payload,
        sig.signature,
        testSecret,
        sig.timestamp
      );

      assert.equal(isValid, true);
    });

    it('should reject signature with wrong secret', () => {
      const payload = '{"bundleId":"test","rating":5}';

      const sig = generateTimestampedSignature(payload, testSecret);
      const isValid = verifyTimestampedSignature(
        payload,
        sig.signature,
        'wrong-secret',
        sig.timestamp
      );

      assert.equal(isValid, false);
    });

    it('should reject expired timestamp', () => {
      const payload = '{"bundleId":"test","rating":5}';
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 min ago

      const sig = generateTimestampedSignature(payload, testSecret);
      const isValid = verifyTimestampedSignature(
        payload,
        sig.signature,
        testSecret,
        oldTimestamp,
        300 // 5 min tolerance
      );

      assert.equal(isValid, false);
    });

    it('should reject malformed signature format', () => {
      const payload = '{"bundleId":"test","rating":5}';
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const isValid = verifyTimestampedSignature(
        payload,
        'invalid-sig-format',
        testSecret,
        timestamp
      );

      assert.equal(isValid, false);
    });

    it('should accept recent timestamp within tolerance', () => {
      const payload = '{"bundleId":"test","rating":5}';
      const recentTimestamp = (Math.floor(Date.now() / 1000) - 30).toString(); // 30 sec ago

      const sig = generateTimestampedSignature(payload, testSecret);
      // Override timestamp with recent one for test
      const signedPayload = `t=${recentTimestamp}.${payload}`;
      const signature = 'sha256=' + require('crypto')
        .createHmac('sha256', testSecret)
        .update(signedPayload)
        .digest('hex');

      const isValid = verifyTimestampedSignature(
        payload,
        signature,
        testSecret,
        recentTimestamp,
        300
      );

      assert.equal(isValid, true);
    });
  });
});
