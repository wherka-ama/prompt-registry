/**
 * Tests for the index integrity (HMAC) layer.
 *
 * Threat model: someone edits `primitive-index.json` on disk (accidental
 * bit-rot or malicious tamper). We can't prevent the edit, but we can
 * detect it cheaply: every saveWithIntegrity() call appends a SHA-256
 * HMAC of the canonical JSON under a secret. On load, verifyIntegrity()
 * recomputes the HMAC and throws when it doesn't match.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  computeIndexHmac,
  type IntegritySecret,
  saveIndexWithIntegrity,
  verifyIndexIntegrity,
} from '../../src/primitive-index/hub/integrity';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-integ-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const secret: IntegritySecret = { keyId: 'test', key: 'a-test-secret' };

describe('primitive-index / integrity', () => {
  it('computeIndexHmac is deterministic for the same payload', () => {
    const a = computeIndexHmac({ anything: 'works' }, secret);
    const b = computeIndexHmac({ anything: 'works' }, secret);
    assert.strictEqual(a, b);
    assert.ok(/^[a-f0-9]{64}$/i.test(a), 'hex sha256');
  });

  it('different keys yield different HMACs', () => {
    const a = computeIndexHmac({ x: 1 }, { keyId: 'k', key: 'secret-1' });
    const b = computeIndexHmac({ x: 1 }, { keyId: 'k', key: 'secret-2' });
    assert.notStrictEqual(a, b);
  });

  it('save then verify round-trips cleanly', () => {
    const file = path.join(tmp, 'idx.json');
    saveIndexWithIntegrity({ hello: 'world' }, file, secret);
    verifyIndexIntegrity(file, secret); // no throw
  });

  it('detects a tampered payload', () => {
    const file = path.join(tmp, 'idx.json');
    saveIndexWithIntegrity({ hello: 'world' }, file, secret);
    // Flip a byte in the payload
    const raw = fs.readFileSync(file, 'utf8');
    const patched = raw.replace('"world"', '"earth"');
    fs.writeFileSync(file, patched, 'utf8');
    assert.throws(
      () => verifyIndexIntegrity(file, secret),
      /hmac mismatch/i
    );
  });

  it('detects a wrong secret (different keyId)', () => {
    const file = path.join(tmp, 'idx.json');
    saveIndexWithIntegrity({ hello: 'world' }, file, secret);
    assert.throws(
      () => verifyIndexIntegrity(file, { keyId: 'other', key: 'other-secret' }),
      /unknown keyId|hmac mismatch/i
    );
  });

  it('throws with a clear error when the envelope is missing its sig block', () => {
    const file = path.join(tmp, 'idx.json');
    fs.writeFileSync(file, JSON.stringify({ payload: { a: 1 } }), 'utf8');
    assert.throws(
      () => verifyIndexIntegrity(file, secret),
      /missing signature/i
    );
  });
});
