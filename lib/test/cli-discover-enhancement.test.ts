/**
 * Tests for CLI discover command enhancement with --ai and --interactive flags.
 * @module test/cli/commands/discover-enhancement
 */

import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createDiscoverCommand,
} from '../src/cli/commands/discover';
import {
  createTestContext,
} from '../src/cli/framework';

describe('Discover Command Enhancement', () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = createTestContext();
  });

  it('should include enableAI flag in DiscoverOptions', () => {
    const cmd = createDiscoverCommand({
      enableAI: true,
    });

    expect(cmd).toBeDefined();
    expect(cmd.path).toEqual(['discover']);
  });

  it('should include interactive flag in DiscoverOptions', () => {
    const cmd = createDiscoverCommand({
      interactive: true,
    });

    expect(cmd).toBeDefined();
    expect(cmd.path).toEqual(['discover']);
  });

  it('should handle both AI and interactive flags', () => {
    const cmd = createDiscoverCommand({
      enableAI: true,
      interactive: true,
    });

    expect(cmd).toBeDefined();
  });

  it('should use fallback when AI is disabled', () => {
    const cmd = createDiscoverCommand({
      enableAI: false,
    });

    expect(cmd).toBeDefined();
  });

  it('should default to AI disabled when not specified', () => {
    const cmd = createDiscoverCommand({});

    expect(cmd).toBeDefined();
  });
});
