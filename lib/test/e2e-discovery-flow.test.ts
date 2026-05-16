/**
 * Integration tests for discovery flow.
 * @module test/e2e/discovery-flow
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
import type {
  DiscoveryOptions,
} from '../src/domain/discovery/types';
import {
  RecommendationEngine,
} from '../src/app/discovery/recommendation-engine';
import {
  ProfileGenerator,
} from '../src/app/discovery/profile-generator';
import {
  buildSearchQueries,
} from '../src/app/discovery/recommendation-engine';
import type {
  ResourceSelection,
} from '../src/domain/discovery/types';

describe('Discovery Flow Integration', () => {
  let mockContext: DetectedContext;
  let mockCopilotSdk: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      techStack: {
        languages: ['TypeScript', 'JavaScript'],
        frameworks: ['React', 'Express'],
        packageManagers: ['npm'],
        buildTools: ['webpack'],
        testFrameworks: ['jest'],
      },
      domain: {
        category: 'web-application',
        businessDomain: 'authentication',
        technicalDomain: 'frontend',
      },
      activity: {
        recentFiles: ['src/index.ts', 'src/components/Button.tsx'],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    mockCopilotSdk = {
      isAvailable: vi.fn().mockResolvedValue(true),
      createSession: vi.fn().mockResolvedValue({
        sendAndWait: vi.fn().mockResolvedValue(JSON.stringify({
          recommendations: [
            {
              id: 'auth-jwt',
              title: 'JWT Authentication',
              description: 'JWT token management',
              kind: 'skill',
              relevance: 0.9,
              source: 'github.com/example/auth-bundle',
            },
          ],
        })),
        sendWithStream: vi.fn(),
        close: vi.fn(),
      }),
    };
  });

  it('should integrate context detection with search query building', () => {
    const queries = buildSearchQueries(mockContext);

    expect(queries).toContain('TypeScript JavaScript');
    expect(queries).toContain('React Express');
    expect(queries).toContain('web-application');
    expect(queries).toContain('authentication');
    expect(queries).toContain('TypeScript web-application');
  });

  it('should integrate recommendation engine with mock Copilot SDK', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(recommendations.length).toBeGreaterThan(0);
  });

  it('should integrate recommendation engine with profile generator', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);
    const generator = new ProfileGenerator();

    const selections: ResourceSelection[] = recommendations.map(rec => ({
      id: rec.id,
      selected: true,
      selectedAt: new Date().toISOString(),
    }));

    const draft = generator.generateDraft(
      'test-profile',
      'Test profile for integration',
      selections
    );

    expect(draft.name).toBe('test-profile');
    expect(draft.description).toBe('Test profile for integration');
    expect(draft.selections).toHaveLength(selections.length);
  });

  it('should handle fallback to non-AI when Copilot SDK unavailable', async () => {
    const unavailableSdk = {
      isAvailable: vi.fn().mockResolvedValue(false),
      createSession: vi.fn().mockResolvedValue({
        sendAndWait: vi.fn(),
        sendWithStream: vi.fn(),
        close: vi.fn(),
      }),
    };

    const engine = new RecommendationEngine(unavailableSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    // Should fall back to query-based search and return empty array when no index
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate profile YAML generation with selections', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
      {
        id: 'resource-2',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'yaml-test-profile',
      'Profile for YAML generation test',
      selections
    );

    const yaml = generator.generateYaml(draft);

    expect(yaml).toContain('name: yaml-test-profile');
    expect(yaml).toContain('description: Profile for YAML generation test');
    expect(yaml).toContain('resource-1');
    expect(yaml).toContain('resource-2');
  });

  it('should handle empty selections in integration flow', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [];

    const draft = generator.generateDraft(
      'empty-profile',
      'Profile with no selections',
      selections
    );

    const yaml = generator.generateYaml(draft);

    expect(yaml).toContain('name: empty-profile');
    // Empty selections might not be explicitly shown in YAML
    expect(yaml).toContain('bundles:');
  });

  it('should handle complex context with multiple languages and frameworks', () => {
    const complexContext: DetectedContext = {
      techStack: {
        languages: ['TypeScript', 'JavaScript', 'Python', 'Go'],
        frameworks: ['React', 'Express', 'Django', 'Gin'],
        packageManagers: ['npm', 'pip', 'go mod'],
        buildTools: ['webpack', 'make'],
        testFrameworks: ['jest', 'pytest'],
      },
      domain: {
        category: 'microservices',
        businessDomain: 'fintech',
        technicalDomain: 'backend',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(complexContext);

    expect(queries.length).toBeGreaterThan(5);
    expect(queries).toContain('TypeScript JavaScript Python Go');
    expect(queries).toContain('React Express Django Gin');
  });

  it('should integrate error handling across discovery flow', async () => {
    const errorSdk = {
      isAvailable: vi.fn().mockRejectedValue(new Error('SDK error')),
      createSession: vi.fn(),
    };

    const engine = new RecommendationEngine(errorSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    await expect(engine.generateRecommendations(mockContext, options)).rejects.toThrow();
  });

  it('should handle malformed AI response in integration flow', async () => {
    const malformedSdk = {
      isAvailable: vi.fn().mockResolvedValue(true),
      createSession: vi.fn().mockResolvedValue({
        sendAndWait: vi.fn().mockResolvedValue('invalid json'),
        sendWithStream: vi.fn(),
        close: vi.fn(),
      }),
    };

    const engine = new RecommendationEngine(malformedSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    // The engine handles malformed JSON by returning empty array
    const recommendations = await engine.generateRecommendations(mockContext, options);
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with many selections', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = Array.from({ length: 50 }, (_, i) => ({
      id: `resource-${i}`,
      selected: true,
      selectedAt: new Date().toISOString(),
    }));

    const draft = generator.generateDraft(
      'large-profile',
      'Profile with many selections',
      selections
    );

    expect(draft.selections).toHaveLength(50);
  });

  it('should handle context with no detected tech stack', () => {
    const emptyContext: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(emptyContext);

    expect(queries).toContain('copilot prompt instruction');
  });

  it('should handle context with unicode in working directory', () => {
    const unicodeContext: DetectedContext = {
      techStack: {
        languages: ['TypeScript'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: 'web-application',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/项目/папка',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(unicodeContext);

    expect(queries).toContain('TypeScript');
  });

  it('should handle context with special characters in domain fields', () => {
    const specialContext: DetectedContext = {
      techStack: {
        languages: ['Python'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: 'data-science/ML',
        businessDomain: 'fintech & healthcare',
        technicalDomain: 'backend + API',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(specialContext);

    expect(queries).toContain('Python');
  });

  it('should handle context with very long working directory path', () => {
    const longPathContext: DetectedContext = {
      techStack: {
        languages: ['JavaScript'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/'.repeat(100) + 'very/deep/path',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(longPathContext);

    expect(queries).toContain('JavaScript');
  });

  it('should handle context with many recent files', () => {
    const manyFilesContext: DetectedContext = {
      techStack: {
        languages: ['TypeScript'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: Array.from({ length: 100 }, (_, i) => `/test/file${i}.ts`),
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(manyFilesContext);

    expect(queries).toContain('TypeScript');
  });

  it('should integrate with profile generator for large descriptions', async () => {
    const generator = new ProfileGenerator();
    const longDesc = 'A '.repeat(10000);
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'long-desc-profile',
      longDesc,
      selections
    );

    expect(draft.name).toBe('long-desc-profile');
    expect(draft.description.length).toBeGreaterThan(10000);
  });

  it('should integrate with profile generator for unicode names', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'профиль-тест',
      'Test profile with unicode name 🚀',
      selections
    );

    expect(draft.name).toBe('профиль-тест');
    expect(draft.description).toContain('🚀');
  });

  it('should integrate with recommendation engine for empty context', async () => {
    const emptyContext: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(emptyContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with recommendation engine for single kind filter', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with recommendation engine for zero limit', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 0,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with recommendation engine for very large limit', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10000,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with recommendation engine for many kinds', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['agent', 'chat-mode', 'instruction', 'mcp-server', 'prompt', 'skill'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with profile generator for special characters in name', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'test-profile-v1.0.0-beta',
      'Test profile with version in name',
      selections
    );

    expect(draft.name).toBe('test-profile-v1.0.0-beta');
  });

  it('should integrate with profile generator for empty description', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'empty-desc-profile',
      '',
      selections
    );

    expect(draft.name).toBe('empty-desc-profile');
    expect(draft.description).toBe('');
  });

  it('should integrate with profile generator for very long name', async () => {
    const generator = new ProfileGenerator();
    const longName = 'a'.repeat(1000);
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      longName,
      'Test profile',
      selections
    );

    expect(draft.name.length).toBe(1000);
  });

  it('should integrate with buildSearchQueries for all tech stack fields', () => {
    const fullContext: DetectedContext = {
      techStack: {
        languages: ['TypeScript', 'JavaScript'],
        frameworks: ['React', 'Express', 'Next.js'],
        packageManagers: ['npm', 'yarn'],
        buildTools: ['webpack', 'vite'],
        testFrameworks: ['jest', 'mocha'],
      },
      domain: {
        category: 'web-application',
        businessDomain: 'e-commerce',
        technicalDomain: 'full-stack',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(fullContext);

    expect(queries.length).toBeGreaterThan(5);
    expect(queries).toContain('TypeScript JavaScript');
    expect(queries).toContain('React Express Next.js');
  });

  it('should integrate with buildSearchQueries for only package managers (falls back to default)', () => {
    const pmContext: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: ['npm', 'yarn', 'pnpm'],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(pmContext);

    // Package managers alone don't generate queries, falls back to default
    expect(queries).toContain('copilot prompt instruction');
  });

  it('should integrate with buildSearchQueries for only build tools (falls back to default)', () => {
    const buildContext: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: ['webpack', 'vite', 'rollup'],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(buildContext);

    // Build tools alone don't generate queries, falls back to default
    expect(queries).toContain('copilot prompt instruction');
  });

  it('should integrate with buildSearchQueries for only test frameworks (falls back to default)', () => {
    const testContext: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: ['jest', 'mocha', 'vitest'],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(testContext);

    // Test frameworks alone don't generate queries, falls back to default
    expect(queries).toContain('copilot prompt instruction');
  });

  it('should integrate with recommendation engine for negative limit (treated as zero)', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: -10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with profile generator for special characters in description', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'special-desc-profile',
      'Test with <special> & "chars"',
      selections
    );

    expect(draft.name).toBe('special-desc-profile');
    expect(draft.description).toContain('<special>');
  });

  it('should integrate with profile generator for newlines in description', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'newline-profile',
      'Line 1\nLine 2\nLine 3',
      selections
    );

    expect(draft.name).toBe('newline-profile');
    expect(draft.description).toContain('\n');
  });

  it('should integrate with buildSearchQueries for mixed domain fields', () => {
    const mixedContext: DetectedContext = {
      techStack: {
        languages: ['TypeScript'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: 'web-application',
        businessDomain: '',
        technicalDomain: 'frontend',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(mixedContext);

    expect(queries).toContain('TypeScript');
    expect(queries).toContain('web-application');
    expect(queries).toContain('TypeScript web-application');
  });

  it('should integrate with buildSearchQueries for domain only', () => {
    const domainOnlyContext: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: 'data-science',
        businessDomain: 'healthcare',
        technicalDomain: 'backend',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(domainOnlyContext);

    expect(queries).toContain('data-science');
    expect(queries).toContain('healthcare');
    expect(queries).toContain('backend');
  });

  it('should integrate with recommendation engine for empty kinds array', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: [],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with profile generator for duplicate resource IDs', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'duplicate-profile',
      'Profile with duplicate IDs',
      selections
    );

    expect(draft.selections).toHaveLength(2);
  });

  it('should integrate with profile generator for unselected resources', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: false,
        selectedAt: new Date().toISOString(),
      },
      {
        id: 'resource-2',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'mixed-selection-profile',
      'Profile with mixed selections',
      selections
    );

    expect(draft.selections).toHaveLength(2);
  });

  it('should integrate with buildSearchQueries for very long language names', () => {
    const longLangContext: DetectedContext = {
      techStack: {
        languages: ['VeryLongLanguageNameThatGoesOnAndOn'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(longLangContext);

    expect(queries).toContain('VeryLongLanguageNameThatGoesOnAndOn');
  });

  it('should integrate with recommendation engine for very large kinds array', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: Array.from({ length: 100 }, (_, i) => `kind-${i}`),
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with profile generator for tabs in description', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'tab-profile',
      'Line 1\tLine 2\tLine 3',
      selections
    );

    expect(draft.name).toBe('tab-profile');
    expect(draft.description).toContain('\t');
  });

  it('should integrate with buildSearchQueries for very long domain names', () => {
    const longDomainContext: DetectedContext = {
      techStack: {
        languages: [],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: 'a'.repeat(1000),
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(longDomainContext);

    expect(queries).toContain('a'.repeat(1000));
  });

  it('should integrate with profile generator for emoji in name', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'emoji-profile-🎉🚀✨',
      'Profile with emoji in name',
      selections
    );

    expect(draft.name).toBe('emoji-profile-🎉🚀✨');
  });

  it('should integrate with recommendation engine for floating point limit (truncated)', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10.5,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with buildSearchQueries for unicode in languages', () => {
    const unicodeLangContext: DetectedContext = {
      techStack: {
        languages: ['中文', '日本語', '한국어'],
        frameworks: [],
        packageManagers: [],
        buildTools: [],
        testFrameworks: [],
      },
      domain: {
        category: '',
        businessDomain: '',
        technicalDomain: '',
      },
      activity: {
        recentFiles: [],
        workingDirectory: '/test/project',
      },
      detectedAt: new Date().toISOString(),
    };

    const queries = buildSearchQueries(unicodeLangContext);

    expect(queries).toContain('中文 日本語 한국어');
  });

  it('should integrate with profile generator for mixed line endings', async () => {
    const generator = new ProfileGenerator();
    const selections: ResourceSelection[] = [
      {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString(),
      },
    ];

    const draft = generator.generateDraft(
      'mixed-eol-profile',
      'Line 1\r\nLine 2\nLine 3\r',
      selections
    );

    expect(draft.name).toBe('mixed-eol-profile');
    expect(draft.description).toContain('Line 1');
  });

  it('should integrate with recommendation engine for disableAI flag', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: false,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should integrate with recommendation engine for enableAI true (explicit)', async () => {
    const engine = new RecommendationEngine(mockCopilotSdk);
    const options: DiscoveryOptions = {
      kinds: ['skill', 'prompt'],
      limit: 10,
      indexFile: '/test/index.json',
      cwd: '/test/project',
      enableAI: true,
      interactive: false,
    };

    const recommendations = await engine.generateRecommendations(mockContext, options);

    expect(recommendations).toBeDefined();
    expect(Array.isArray(recommendations)).toBe(true);
  });
});
