/**
 * Coverage tests for infra/resolvers/hub-resolver.ts.
 *
 * Tests LocalHubResolver (testable with just the FS abstraction) and
 * CompositeHubResolver dispatch logic.
 * GitHubHubResolver / UrlHubResolver HTTP paths are not exercised here
 * because they require network mocking; those paths are covered
 * indirectly via integration tests.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CompositeHubResolver,
  GitHubHubResolver,
  LocalHubResolver,
} from '../src/infra/resolvers/hub-resolver';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

const MINIMAL_HUB_YAML = [
  'version: "1.0.0"',
  'metadata:',
  '  name: Test Hub',
  '  description: ""',
  '  maintainer: ""',
  '  updatedAt: "2026-01-01T00:00:00Z"',
  'sources: []',
  'profiles: []'
].join('\n');

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-hubresolver-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('LocalHubResolver', () => {
  it('resolves a hub-config.yml given a direct file path', async () => {
    const cfgPath = path.join(tmpDir, 'hub-config.yml');
    await fs.writeFile(cfgPath, MINIMAL_HUB_YAML, 'utf8');

    const resolver = new LocalHubResolver(createNodeFsAdapter());
    const result = await resolver.resolve({ type: 'local', location: cfgPath });

    expect(result.config.metadata.name).toBe('Test Hub');
    expect(result.config.version).toBe('1.0.0');
    expect(result.reference.location).toBe(cfgPath);
  });

  it('resolves hub-config.yml inside a directory location', async () => {
    const subDir = path.join(tmpDir, 'my-hub');
    await fs.mkdir(subDir);
    await fs.writeFile(path.join(subDir, 'hub-config.yml'), MINIMAL_HUB_YAML, 'utf8');

    const resolver = new LocalHubResolver(createNodeFsAdapter());
    const result = await resolver.resolve({ type: 'local', location: subDir });

    expect(result.config.metadata.name).toBe('Test Hub');
    expect(result.reference.location).toContain('hub-config.yml');
  });

  it('throws when location does not exist', async () => {
    const resolver = new LocalHubResolver(createNodeFsAdapter());
    await expect(
      resolver.resolve({ type: 'local', location: path.join(tmpDir, 'nonexistent') })
    ).rejects.toThrow('not found');
  });

  it('falls back to the directory itself when hub-config.yml is missing inside it', async () => {
    const subDir = path.join(tmpDir, 'no-config');
    await fs.mkdir(subDir);
    await fs.writeFile(path.join(subDir, 'other.yml'), MINIMAL_HUB_YAML, 'utf8');

    const resolver = new LocalHubResolver(createNodeFsAdapter());
    // falls back to subDir as the config path → reads dir as a file → throws on yaml parse
    await expect(
      resolver.resolve({ type: 'local', location: subDir })
    ).rejects.toThrow();
  });

  it('throws when file contains malformed hub config (missing required fields)', async () => {
    const cfgPath = path.join(tmpDir, 'bad.yml');
    await fs.writeFile(cfgPath, 'not: a hub config\n', 'utf8');

    const resolver = new LocalHubResolver(createNodeFsAdapter());
    await expect(
      resolver.resolve({ type: 'local', location: cfgPath })
    ).rejects.toThrow('malformed');
  });
});

describe('GitHubHubResolver', () => {
  const ref = { type: 'github' as const, location: 'owner/private-repo' };

  it('throws with no-token auth hint when 404 and no token available', async () => {
    const http = { fetch: vi.fn().mockResolvedValue({ statusCode: 404, body: new Uint8Array() }) };
    const tokens = { getToken: vi.fn().mockResolvedValue(null) };
    const resolver = new GitHubHubResolver(http, tokens);
    await expect(resolver.resolve(ref)).rejects.toThrow(
      /hub-config\.yml not found at owner\/private-repo \(no token/
    );
  });

  it('throws with token-present auth hint when 404 and token is present', async () => {
    const http = { fetch: vi.fn().mockResolvedValue({ statusCode: 404, body: new Uint8Array() }) };
    const tokens = { getToken: vi.fn().mockResolvedValue('gho_faketoken') };
    const resolver = new GitHubHubResolver(http, tokens);
    await expect(resolver.resolve(ref)).rejects.toThrow(
      /hub-config\.yml not found at owner\/private-repo \(your token may not have read access/
    );
  });

  it('throws for 401 with authentication failed message', async () => {
    const http = { fetch: vi.fn().mockResolvedValue({ statusCode: 401, body: new Uint8Array() }) };
    const tokens = { getToken: vi.fn().mockResolvedValue('bad-token') };
    const resolver = new GitHubHubResolver(http, tokens);
    await expect(resolver.resolve(ref)).rejects.toThrow(/Authentication failed/);
  });
});

describe('CompositeHubResolver', () => {
  const makeRef = (type: 'github' | 'local' | 'url') => ({
    type,
    location: type === 'github' ? 'owner/repo' : (type === 'local' ? '/tmp/hub' : 'https://example.com/hub.yml')
  });

  it('dispatches github refs to the github resolver', async () => {
    const githubResolve = vi.fn().mockResolvedValue({ config: {}, reference: makeRef('github') });
    const localResolve = vi.fn();
    const urlResolve = vi.fn();
    const composite = new CompositeHubResolver(
      { resolve: githubResolve },
      { resolve: localResolve },
      { resolve: urlResolve }
    );
    await composite.resolve(makeRef('github'));
    expect(githubResolve).toHaveBeenCalledOnce();
    expect(localResolve).not.toHaveBeenCalled();
    expect(urlResolve).not.toHaveBeenCalled();
  });

  it('dispatches local refs to the local resolver', async () => {
    const githubResolve = vi.fn();
    const localResolve = vi.fn().mockResolvedValue({ config: {}, reference: makeRef('local') });
    const urlResolve = vi.fn();
    const composite = new CompositeHubResolver(
      { resolve: githubResolve },
      { resolve: localResolve },
      { resolve: urlResolve }
    );
    await composite.resolve(makeRef('local'));
    expect(localResolve).toHaveBeenCalledOnce();
    expect(githubResolve).not.toHaveBeenCalled();
    expect(urlResolve).not.toHaveBeenCalled();
  });

  it('dispatches url refs to the url resolver', async () => {
    const githubResolve = vi.fn();
    const localResolve = vi.fn();
    const urlResolve = vi.fn().mockResolvedValue({ config: {}, reference: makeRef('url') });
    const composite = new CompositeHubResolver(
      { resolve: githubResolve },
      { resolve: localResolve },
      { resolve: urlResolve }
    );
    await composite.resolve(makeRef('url'));
    expect(urlResolve).toHaveBeenCalledOnce();
    expect(githubResolve).not.toHaveBeenCalled();
    expect(localResolve).not.toHaveBeenCalled();
  });

  it('propagates errors from the delegate resolver', async () => {
    const err = new Error('resolver error');
    const composite = new CompositeHubResolver(
      { resolve: vi.fn().mockRejectedValue(err) },
      { resolve: vi.fn() },
      { resolve: vi.fn() }
    );
    await expect(composite.resolve(makeRef('github'))).rejects.toThrow('resolver error');
  });

  it('returns reference with normalized location for local resolver', async () => {
    const cfgPath = path.join(tmpDir, 'hub-config.yml');
    await fs.writeFile(cfgPath, MINIMAL_HUB_YAML, 'utf8');

    const resolver = new LocalHubResolver(createNodeFsAdapter());
    const result = await resolver.resolve({ type: 'local', location: cfgPath });

    expect(result.reference).toEqual({ type: 'local', location: cfgPath });
  });
});
