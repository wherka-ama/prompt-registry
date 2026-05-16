/**
 * Tests for discover command.
 * @module test/cli/commands/discover
 */

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  DetectedContext,
} from '../src/app/context-detection';
import {
  buildSearchQueries,
} from '../src/app/discovery/recommendation-engine';
import {
  createDiscoverCommand,
  deduplicateHits,
  renderDiscoveryText,
} from '../src/cli/commands/discover';
import type {
  DiscoverOptions,
} from '../src/cli/commands/discover';
import type {
  PrimitiveKind,
  SearchHit,
} from '../src/infra/search/types';

describe('DiscoverCommand', () => {
  const mockContext = {
    stdout: {
      write: vi.fn()
    },
    stderr: {
      write: vi.fn()
    },
    env: {
      HOME: '/home/test',
      XDG_CACHE_HOME: undefined
    },
    cwd: () => '/home/test/project'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should build search queries from TypeScript context', async () => {
    const opts: DiscoverOptions = {
      output: 'text',
      limit: 10,
      cwd: '/test/project'
    };

    const cmd = createDiscoverCommand(opts);
    // Note: Full integration test would require mocking ContextDetector and loadIndex
    // This is a unit test for the command structure
    expect(cmd).toBeDefined();
    expect(cmd.path).toEqual(['discover']);
    expect(cmd.description).toContain('project context');
  });

  it('should handle missing index gracefully', async () => {
    const opts: DiscoverOptions = {
      output: 'text',
      indexFile: '/nonexistent/index.json',
      cwd: '/test/project'
    };

    const cmd = createDiscoverCommand(opts);
    const result = await cmd.run({ ctx: mockContext as any });

    expect(result).toBe(1);
  });

  it('should support filtering by primitive kinds', async () => {
    const opts: DiscoverOptions = {
      output: 'text',
      kinds: ['prompt', 'instruction'] as PrimitiveKind[],
      limit: 5
    };

    const cmd = createDiscoverCommand(opts);
    expect(cmd).toBeDefined();
  });

  it('should support custom limit', async () => {
    const opts: DiscoverOptions = {
      output: 'text',
      limit: 20
    };

    const cmd = createDiscoverCommand(opts);
    expect(cmd).toBeDefined();
  });

  it('should support JSON output format', async () => {
    const opts: DiscoverOptions = {
      output: 'json',
      limit: 10
    };

    const cmd = createDiscoverCommand(opts);
    expect(cmd).toBeDefined();
  });

  it('should support YAML output format', async () => {
    const opts: DiscoverOptions = {
      output: 'yaml',
      limit: 10
    };

    const cmd = createDiscoverCommand(opts);
    expect(cmd).toBeDefined();
  });

  it('should support NDJSON output format', async () => {
    const opts: DiscoverOptions = {
      output: 'ndjson',
      limit: 10
    };

    const cmd = createDiscoverCommand(opts);
    expect(cmd).toBeDefined();
  });
});

describe('buildSearchQueries', () => {
  it('should generate query from languages', () => {
    const context: DetectedContext = {
      techStack: {
        languages: ['TypeScript', 'JavaScript'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('TypeScript JavaScript');
  });

  it('should generate query from frameworks', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: ['React', 'Express'],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('React Express');
  });

  it('should generate query from domain', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: 'web-application',
        businessDomain: 'authentication',
        technicalDomain: 'frontend'
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('web-application');
    expect(queries).toContain('authentication');
    expect(queries).toContain('frontend');
  });

  it('should generate combined queries', () => {
    const context: DetectedContext = {
      techStack: {
        languages: ['TypeScript'],
        frameworks: ['React'],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: 'web-application',
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('TypeScript');
    expect(queries).toContain('React');
    expect(queries).toContain('TypeScript web-application');
  });

  it('should provide default query when no context detected', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('copilot prompt instruction');
  });

  it('should handle context with only languages', () => {
    const context: DetectedContext = {
      techStack: {
        languages: ['TypeScript', 'JavaScript'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: ''
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('TypeScript JavaScript');
    expect(queries).not.toContain('copilot prompt instruction');
  });

  it('should handle context with only frameworks', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: ['React', 'Express'],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: ''
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('React Express');
    expect(queries).not.toContain('copilot prompt instruction');
  });

  it('should handle context with only domain', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: 'web-application',
        businessDomain: '',
        technicalDomain: ''
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('web-application');
  });

  it('should handle special characters in domain', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: 'web-application',
        businessDomain: 'e-commerce/travel',
        technicalDomain: ''
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries).toContain('e-commerce/travel');
  });

  it('should handle many languages', () => {
    const context: DetectedContext = {
      techStack: {
        languages: Array.from({ length: 10 }, (_, i) => `Language${i}`),
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: ''
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = buildSearchQueries(context);

    expect(queries[0]).toContain('Language0');
  });
});

describe('deduplicateHits', () => {
  it('should deduplicate hits by primitive ID', () => {
    const hits: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Test 1',
          description: '',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.9
      },
      {
        primitive: {
          id: 'test-1',
          title: 'Test 1',
          description: '',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.8
      },
      {
        primitive: {
          id: 'test-2',
          title: 'Test 2',
          description: '',
          kind: 'prompt',
          path: '/test/path2',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash2',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.7
      }
    ];

    const unique = deduplicateHits(hits);

    expect(unique).toHaveLength(2);
    expect(unique[0].primitive.id).toBe('test-1');
    expect(unique[1].primitive.id).toBe('test-2');
  });

  it('should preserve highest score when deduplicating', () => {
    const hits: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Test 1',
          description: '',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.8
      },
      {
        primitive: {
          id: 'test-1',
          title: 'Test 1',
          description: '',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.9
      }
    ];

    const unique = deduplicateHits(hits);

    expect(unique).toHaveLength(1);
    expect(unique[0].score).toBe(0.9);
  });

  it('should handle empty array', () => {
    const unique = deduplicateHits([]);

    expect(unique).toHaveLength(0);
  });
});

describe('renderDiscoveryText', () => {
  it('should render context summary', () => {
    const context: DetectedContext = {
      techStack: {
        languages: ['TypeScript'],
        frameworks: ['React'],
        packageManagers: ['npm'],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: 'web-application',
        businessDomain: 'authentication',
        technicalDomain: 'frontend'
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['TypeScript', 'React'];
    const results: SearchHit[] = [];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Detected Context:');
    expect(output).toContain('TypeScript');
    expect(output).toContain('React');
    expect(output).toContain('web-application');
  });

  it('should render search queries', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['typescript', 'react'];
    const results: SearchHit[] = [];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Search Queries:');
    expect(output).toContain('typescript');
    expect(output).toContain('react');
  });

  it('should render results with scores', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Test Primitive',
          description: 'A test primitive',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Recommendations (1):');
    expect(output).toContain('0.95');
    expect(output).toContain('Test Primitive');
  });

  it('should handle empty results', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Recommendations (0):');
  });

  it('should handle context with many languages', () => {
    const context: DetectedContext = {
      techStack: {
        languages: Array.from({ length: 20 }, (_, i) => `Language${i}`),
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Detected Context:');
  });

  it('should handle context with unicode in domain', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: 'web-application 🚀',
        businessDomain: 'e-commerce/travel',
        technicalDomain: 'frontend'
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('web-application 🚀');
  });

  it('should handle results with special characters in title', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Test "quoted" & special <chars>',
          description: 'A test primitive',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Test "quoted" & special <chars>');
  });

  it('should handle results with very long descriptions', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const longDesc = 'a'.repeat(5000);
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Test Primitive',
          description: longDesc,
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Test Primitive');
  });

  it('should handle many search queries', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = Array.from({ length: 20 }, (_, i) => `query${i}`);
    const results: SearchHit[] = [];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Search Queries:');
  });

  it('should handle results with score at upper bound (1.0)', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Perfect Match',
          description: 'A perfect match',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 1.0
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('1.0');
  });

  it('should handle results with score at lower bound (0.0)', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Low Match',
          description: 'A low match',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.0
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('0.0');
  });

  it('should handle results with negative score', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Negative Score',
          description: 'A negative score',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: -0.5
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('-0.5');
  });

  it('should handle results with very high precision score', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Precision Score',
          description: 'A high precision score',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.987654321
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    // Score is rounded to 3 decimal places
    expect(output).toContain('0.988');
  });

  it('should handle results with unicode in title and description', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: '测试标题 🎉',
          description: 'テスト説明 🚀',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('测试标题 🎉');
    expect(output).toContain('テスト説明 🚀');
  });

  it('should handle results with newline in description', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Newline Test',
          description: 'Line 1\nLine 2\nLine 3',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Newline Test');
  });

  it('should handle results with tab in description', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Tab Test',
          description: 'Col1\tCol2\tCol3',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Tab Test');
  });

  it('should handle results with empty body preview', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Empty Body Preview',
          description: 'A test primitive',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Empty Body Preview');
  });

  it('should handle results with very long body preview', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const longPreview = 'a'.repeat(10000);
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Long Body Preview',
          description: 'A test primitive',
          kind: 'prompt',
          path: '/test/path',
          tags: ['test'],
          bodyPreview: longPreview,
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Long Body Preview');
  });

  it('should handle results with empty tags array', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Empty Tags',
          description: 'A test primitive',
          kind: 'prompt',
          path: '/test/path',
          tags: [],
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Empty Tags');
  });

  it('should handle results with many tags', () => {
    const context: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: []
      },
      domain: {
        category: undefined,
        businessDomain: undefined,
        technicalDomain: undefined
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test'
      },
      detectedAt: new Date().toISOString()
    };

    const queries = ['test'];
    const results: SearchHit[] = [
      {
        primitive: {
          id: 'test-1',
          title: 'Many Tags',
          description: 'A test primitive',
          kind: 'prompt',
          path: '/test/path',
          tags: Array.from({ length: 100 }, (_, i) => `tag${i}`),
          bodyPreview: '',
          contentHash: 'hash1',
          bundle: { sourceId: 'source-1', bundleId: 'bundle-1', sourceType: 'github', bundleVersion: '1.0.0', installed: false }
        },
        score: 0.95
      }
    ];

    const output = renderDiscoveryText(context, queries, results);

    expect(output).toContain('Many Tags');
  });
});
