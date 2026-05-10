/**
 * Phase 4 / Iter 35 — `createProductionContext({ cwd: ... })` test.
 *
 * Verifies the iter-18 cwd override is honored by ctx.cwd() without
 * touching process.cwd() (which would corrupt unrelated relative paths).
 */
import * as assert from 'node:assert';
import {
  createProductionContext,
} from '../../../src/cli/framework';

describe('Phase 4 / Iter 35 — production Context cwd override', () => {
  it('uses process.cwd() by default', () => {
    const ctx = createProductionContext();
    assert.strictEqual(ctx.cwd(), process.cwd());
  });

  it('honors an injected cwd without changing the underlying process', () => {
    const before = process.cwd();
    const ctx = createProductionContext({ cwd: '/nowhere/special' });
    assert.strictEqual(ctx.cwd(), '/nowhere/special');
    assert.strictEqual(process.cwd(), before, 'process.cwd() must not be mutated');
  });
});
