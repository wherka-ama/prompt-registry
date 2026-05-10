import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  EtagStore,
} from '../src/primitive-index/hub/etag-store';
import {
  type FetchLike,
  GitHubApiClient,
} from '../src/primitive-index/hub/github-api-client';
import {
  enumerateRepoTree,
  isPrimitiveCandidatePath,
  resolveCommitSha,
} from '../src/primitive-index/hub/tree-enumerator';

function mockResponse(init: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  return Response.json(init.body ?? {}, {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

describe('tree-enumerator', () => {
  it('isPrimitiveCandidatePath recognises the known kinds (and nothing else)', () => {
    const yes = [
      'prompts/foo.prompt.md',
      'instructions/bar.instructions.md',
      'chatmodes/baz.chatmode.md',
      'agents/qux.agent.md',
      'skills/demo/SKILL.md',
      'mcp.json',
      'collection.yml',
      'deployment-manifest.yml',
      '.vscode/mcp.json'
    ];
    for (const p of yes) {
      expect(isPrimitiveCandidatePath(p)).toBe(true);
    }
    const no = [
      'README.md',
      'src/index.ts',
      'package.json',
      '.github/workflows/ci.yml',
      'deep/node_modules/thing.js'
    ];
    for (const p of no) {
      expect(isPrimitiveCandidatePath(p)).toBe(false);
    }
  });

  it('resolves a branch to a commit sha and enumerates primitive candidates', async () => {
    const fetch: FetchLike = async (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/commits/main')) {
        return mockResponse({ body: { sha: 'cafe1234', commit: { author: { date: '2024-01-01' } } } });
      }
      if (url.pathname.endsWith('/git/trees/cafe1234') && url.searchParams.get('recursive') === '1') {
        return mockResponse({
          body: {
            sha: 'cafe1234',
            truncated: false,
            tree: [
              { path: 'prompts/a.prompt.md', type: 'blob', sha: 'aaaa', size: 10 },
              { path: 'README.md', type: 'blob', sha: 'bbbb', size: 50 },
              { path: 'collections/x/collection.yml', type: 'blob', sha: 'cccc', size: 100 },
              { path: 'collections/x', type: 'tree', sha: 'xxxx' }
            ]
          }
        });
      }
      throw new Error(`unexpected ${url.pathname}`);
    };
    const client = new GitHubApiClient({ token: 't', fetch });
    const r = await enumerateRepoTree(client, { owner: 'o', repo: 'r', ref: 'main' });
    expect(r.commitSha).toBe('cafe1234');
    expect(
      r.candidates.map((c) => c.path).toSorted()
    ).toStrictEqual(
      ['collections/x/collection.yml', 'prompts/a.prompt.md']
    );
    expect(r.candidates.find((c) => c.path === 'prompts/a.prompt.md')?.blobSha).toBe('aaaa');
  });

  it('throws a descriptive error on truncated trees', async () => {
    const fetch: FetchLike = async (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/commits/main')) {
        return mockResponse({ body: { sha: 'sha1' } });
      }
      return mockResponse({
        body: { sha: 'sha1', truncated: true, tree: [] }
      });
    };
    const client = new GitHubApiClient({ token: 't', fetch });
    await expect(
      enumerateRepoTree(client, { owner: 'o', repo: 'r', ref: 'main' })
    ).rejects.toThrow(/truncated/i);
  });

  it('resolveCommitSha uses EtagStore and replays cached sha on 304', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-enum-etag-'));
    let calls = 0;
    const fetchImpl: FetchLike = async (req) => {
      calls += 1;
      if (req.headers.get('if-none-match') === '"etag-1"') {
        return new Response(null, { status: 304 });
      }
      return mockResponse({ body: { sha: 'sha-1' }, headers: { etag: '"etag-1"' } });
    };
    const client = new GitHubApiClient({ token: 't', fetch: fetchImpl });
    const store = await EtagStore.open(path.join(tmp, 'etags.json'));

    const sha1 = await resolveCommitSha(client, { owner: 'o', repo: 'r', ref: 'main', etagStore: store });
    await store.save();
    expect(sha1).toBe('sha-1');
    expect(calls).toBe(1);

    const reopened = await EtagStore.open(path.join(tmp, 'etags.json'));
    const sha2 = await resolveCommitSha(client, { owner: 'o', repo: 'r', ref: 'main', etagStore: reopened });
    expect(sha2).toBe('sha-1');
    expect(calls).toBe(2);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('supports a custom path prefix filter (for awesome-copilot collectionsPath)', async () => {
    const fetch: FetchLike = async (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/commits/main')) {
        return mockResponse({ body: { sha: 'abc' } });
      }
      return mockResponse({
        body: {
          sha: 'abc', truncated: false, tree: [
            { path: 'collections/a/prompts/x.prompt.md', type: 'blob', sha: 'a1', size: 1 },
            { path: 'other/prompts/y.prompt.md', type: 'blob', sha: 'a2', size: 1 }
          ]
        }
      });
    };
    const client = new GitHubApiClient({ token: 't', fetch });
    const r = await enumerateRepoTree(client, {
      owner: 'o', repo: 'r', ref: 'main', pathPrefix: 'collections/'
    });
    expect(r.candidates.map((c) => c.path)).toStrictEqual(['collections/a/prompts/x.prompt.md']);
  });
});
