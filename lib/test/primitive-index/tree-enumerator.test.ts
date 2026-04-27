/**
 * Tests for the git tree enumerator.
 *
 * The enumerator is the "what primitives live in this repo at this sha"
 * operation used by the hub harvester. It must:
 *   - Resolve a ref (branch, tag, sha) to a commit sha via /commits/:ref.
 *   - Fetch the full tree (recursive=1) in a single call when possible.
 *   - Detect truncation and throw a clear error (the harvester can then
 *     fall back to per-subtree walks — deferred to a later iteration).
 *   - Filter blob entries down to candidate primitive files via a
 *     pluggable predicate, so the tree-walk is a single pass.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EtagStore,
} from '../../src/primitive-index/hub/etag-store';
import {
  type FetchLike,
  GitHubApiClient,
} from '../../src/primitive-index/hub/github-api-client';
import {
  enumerateRepoTree,
  isPrimitiveCandidatePath,
  resolveCommitSha,
} from '../../src/primitive-index/hub/tree-enumerator';

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

describe('primitive-index / tree-enumerator', () => {
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
      assert.ok(isPrimitiveCandidatePath(p), `expected true for ${p}`);
    }
    const no = [
      'README.md',
      'src/index.ts',
      'package.json',
      '.github/workflows/ci.yml',
      'deep/node_modules/thing.js'
    ];
    for (const p of no) {
      assert.ok(!isPrimitiveCandidatePath(p), `expected false for ${p}`);
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
    assert.strictEqual(r.commitSha, 'cafe1234');
    assert.deepStrictEqual(
      r.candidates.map((c) => c.path).toSorted(),
      ['collections/x/collection.yml', 'prompts/a.prompt.md']
    );
    assert.strictEqual(r.candidates.find((c) => c.path === 'prompts/a.prompt.md')?.blobSha, 'aaaa');
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
    await assert.rejects(
      enumerateRepoTree(client, { owner: 'o', repo: 'r', ref: 'main' }),
      /truncated/i
    );
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
    assert.strictEqual(sha1, 'sha-1');
    assert.strictEqual(calls, 1);

    // Second call must send If-None-Match and accept the 304 without a
    // fresh body — replayed sha should match.
    const reopened = await EtagStore.open(path.join(tmp, 'etags.json'));
    const sha2 = await resolveCommitSha(client, { owner: 'o', repo: 'r', ref: 'main', etagStore: reopened });
    assert.strictEqual(sha2, 'sha-1');
    assert.strictEqual(calls, 2); // one more call (conditional); server answered 304

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
    assert.deepStrictEqual(r.candidates.map((c) => c.path), ['collections/a/prompts/x.prompt.md']);
  });
});
