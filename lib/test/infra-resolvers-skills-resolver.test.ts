import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import nock from 'nock';
import {
  LocalAwesomeCopilotBundleResolver,
  LocalSkillsBundleResolver,
  SkillsBundleResolver,
} from '../src/infra/resolvers/skills-resolver';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmp: string;
const realFs = createNodeFsAdapter();

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-skills-resolver-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const mockHttpClient = {
  fetch: async ({ url, headers }: { url: string; headers?: Record<string, string> }) => {
    const response = await fetch(url, { headers });
    const body = await response.arrayBuffer();
    return {
      statusCode: response.status,
      body: new Uint8Array(body),
    };
  },
};

const mockTokenProvider = {
  getToken: async () => null,
};

describe('SkillsBundleResolver', () => {
  it('returns null when skill directory not found', async () => {
    const resolver = new SkillsBundleResolver({
      repoSlug: 'test/repo',
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
    });

    nock('https://api.github.com')
      .get('/repos/test/repo/contents/skills/test-skill')
      .reply(404);

    const result = await resolver.resolve({ bundleId: 'test-skill', bundleVersion: 'latest' });
    expect(result).toBeNull();
  });

  it('returns null when skill directory is empty', async () => {
    const resolver = new SkillsBundleResolver({
      repoSlug: 'test/repo',
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
    });

    nock('https://api.github.com')
      .get('/repos/test/repo/contents/skills/test-skill')
      .reply(200, []);

    const result = await resolver.resolve({ bundleId: 'test-skill', bundleVersion: 'latest' });
    expect(result).toBeNull();
  });
});

describe('LocalSkillsBundleResolver', () => {
  it('returns null when skill directory does not exist', async () => {
    const resolver = new LocalSkillsBundleResolver({
      rootPath: tmp,
      fs: realFs,
    });

    const result = await resolver.resolve({ bundleId: 'test-skill', bundleVersion: 'latest' });
    expect(result).toBeNull();
  });

  it('builds zip bundle from local files', async () => {
    const resolver = new LocalSkillsBundleResolver({
      rootPath: tmp,
      fs: realFs,
    });

    const skillDir = path.join(tmp, 'skills', 'test-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Test Skill');

    const result = await resolver.resolve({ bundleId: 'test-skill', bundleVersion: 'latest' });
    expect(result).not.toBeNull();
    expect(result?.inlineBytes).toBeDefined();
    if (result?.inlineBytes) {
      expect(result.inlineBytes.length).toBeGreaterThan(0);
    }
    expect(result?.ref.sourceType).toBe('local-skills');
  });

  it('handles subdirectories', async () => {
    const resolver = new LocalSkillsBundleResolver({
      rootPath: tmp,
      fs: realFs,
    });

    const skillDir = path.join(tmp, 'skills', 'test-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Test Skill');
    await fs.mkdir(path.join(skillDir, 'api'), { recursive: true });
    await fs.writeFile(path.join(skillDir, 'api', 'code.ts'), '// API code');

    const result = await resolver.resolve({ bundleId: 'test-skill', bundleVersion: 'latest' });
    expect(result).not.toBeNull();
  });

  it('uses custom skills path', async () => {
    const resolver = new LocalSkillsBundleResolver({
      rootPath: tmp,
      skillsPath: 'custom-skills',
      fs: realFs,
    });

    const skillDir = path.join(tmp, 'custom-skills', 'test-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Test Skill');

    const result = await resolver.resolve({ bundleId: 'test-skill', bundleVersion: 'latest' });
    expect(result).not.toBeNull();
  });
});

describe('LocalAwesomeCopilotBundleResolver', () => {
  it('returns null when collection file does not exist', async () => {
    const resolver = new LocalAwesomeCopilotBundleResolver({
      rootPath: tmp,
      fs: realFs,
    });

    const result = await resolver.resolve({ bundleId: 'test', bundleVersion: 'latest' });
    expect(result).toBeNull();
  });

  it('builds zip bundle from local collection', async () => {
    const resolver = new LocalAwesomeCopilotBundleResolver({
      rootPath: tmp,
      fs: realFs,
    });

    const collectionsDir = path.join(tmp, 'collections');
    await fs.mkdir(collectionsDir, { recursive: true });
    await fs.writeFile(path.join(collectionsDir, 'test.collection.yml'), 'id: test\nname: Test\nitems:\n  - path: prompts/test.md\n    kind: prompt');
    await fs.mkdir(path.join(tmp, 'prompts'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'prompts', 'test.md'), '# Test Prompt');

    const result = await resolver.resolve({ bundleId: 'test', bundleVersion: 'latest' });
    expect(result).not.toBeNull();
    expect(result?.inlineBytes).toBeDefined();
    if (result?.inlineBytes) {
      expect(result.inlineBytes.length).toBeGreaterThan(0);
    }
    expect(result?.ref.sourceType).toBe('local-awesome-copilot');
  });

  it('skips missing items', async () => {
    const resolver = new LocalAwesomeCopilotBundleResolver({
      rootPath: tmp,
      fs: realFs,
    });

    const collectionsDir = path.join(tmp, 'collections');
    await fs.mkdir(collectionsDir, { recursive: true });
    await fs.writeFile(path.join(collectionsDir, 'test.collection.yml'), 'id: test\nname: Test\nitems:\n  - path: prompts/test.md\n    kind: prompt\n  - path: prompts/missing.md\n    kind: prompt');
    await fs.mkdir(path.join(tmp, 'prompts'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'prompts', 'test.md'), '# Test Prompt');

    const result = await resolver.resolve({ bundleId: 'test', bundleVersion: 'latest' });
    expect(result).not.toBeNull();
  });

  it('uses custom collections path', async () => {
    const resolver = new LocalAwesomeCopilotBundleResolver({
      rootPath: tmp,
      collectionsPath: 'custom-collections',
      fs: realFs,
    });

    const collectionsDir = path.join(tmp, 'custom-collections');
    await fs.mkdir(collectionsDir, { recursive: true });
    await fs.writeFile(path.join(collectionsDir, 'test.collection.yml'), 'id: test\nname: Test\nitems:\n  - path: prompts/test.md\n    kind: prompt');
    await fs.mkdir(path.join(tmp, 'prompts'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'prompts', 'test.md'), '# Test Prompt');

    const result = await resolver.resolve({ bundleId: 'test', bundleVersion: 'latest' });
    expect(result).not.toBeNull();
  });
});
