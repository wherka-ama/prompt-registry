import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createProductionContext,
} from '../src/cli/framework';

describe('production Context cwd override', () => {
  it('uses process.cwd() by default', () => {
    const ctx = createProductionContext();
    expect(ctx.cwd()).toBe(process.cwd());
  });

  it('honors an injected cwd without changing the underlying process', () => {
    const before = process.cwd();
    const ctx = createProductionContext({ cwd: '/nowhere/special' });
    expect(ctx.cwd()).toBe('/nowhere/special');
    expect(process.cwd()).toBe(before);
  });
});
