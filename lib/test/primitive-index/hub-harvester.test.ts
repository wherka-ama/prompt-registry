/**
 * Tests for HubHarvester.
 *
 * The orchestrator wraps:
 *   - iterating over hub sources
 *   - creating a per-source BundleProvider
 *   - driving PrimitiveIndex.harvestFrom for each
 *   - recording start/done/error/skip in the progress log
 *   - honouring shouldResume for smart skip when a bundle is already
 *     fully harvested at the latest commit sha.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  HubSourceSpec,
} from '../../src/domain';
import {
  BlobCache,
  computeGitBlobSha,
} from '../../src/primitive-index/hub/blob-cache';
import {
  BlobFetcher,
} from '../../src/primitive-index/hub/blob-fetcher';
import {
  type FetchLike,
  GitHubApiClient,
} from '../../src/primitive-index/hub/github-api-client';
import {
  HubHarvester,
} from '../../src/primitive-index/hub/hub-harvester';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harv-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function jsonResp(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'content-type': 'application/json' } });
}

function makeFetch(repos: Map<string, { sha: string; tree: { path: string; sha: string; size: number }[]; blobs: Map<string, Buffer> }>): FetchLike {
  return async (req) => {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
    if (!m) {
      return jsonResp({ message: 'no repo' }, 404);
    }
    const key = `${m[1]}/${m[2]}`;
    const repo = repos.get(key);
    if (!repo) {
      return jsonResp({ message: `unknown ${key}` }, 404);
    }
    if (/\/commits\/[^/]+$/.test(m[3])) {
      return jsonResp({ sha: repo.sha });
    }
    if (m[3].startsWith(`/git/trees/${repo.sha}`) && url.searchParams.get('recursive') === '1') {
      return jsonResp({
        sha: repo.sha, truncated: false,
        tree: repo.tree.map((t) => ({ path: t.path, type: 'blob', sha: t.sha, size: t.size }))
      });
    }
    const bm = m[3].match(/\/git\/blobs\/([a-f0-9]+)$/);
    if (bm) {
      const blob = repo.blobs.get(bm[1]);
      if (!blob) {
        return jsonResp({ message: 'not found' }, 404);
      }
      return jsonResp({ sha: bm[1], size: blob.length, content: blob.toString('base64'), encoding: 'base64' });
    }
    return jsonResp({ message: `unexpected ${m[3]}` }, 500);
  };
}

function spec(id: string, owner: string, repo: string): HubSourceSpec {
  return {
    id, name: id, type: 'github',
    url: `https://github.com/${owner}/${repo}`, owner, repo, branch: 'main'
  };
}

describe('primitive-index / hub-harvester', () => {
  it('harvests two sources in serial, records progress for each', async () => {
    const promptBytes = Buffer.from('---\ntitle: Hello\ndescription: hi\n---\n\n# Hello\n', 'utf8');
    const promptSha = computeGitBlobSha(promptBytes);
    const repos = new Map([
      ['o1/r1', {
        sha: 'sha-o1r1',
        tree: [{ path: 'prompts/a.prompt.md', sha: promptSha, size: promptBytes.length }],
        blobs: new Map([[promptSha, promptBytes]])
      }],
      ['o2/r2', {
        sha: 'sha-o2r2',
        tree: [{ path: 'prompts/b.prompt.md', sha: promptSha, size: promptBytes.length }],
        blobs: new Map([[promptSha, promptBytes]])
      }]
    ]);
    const fetch = makeFetch(repos);
    const client = new GitHubApiClient({ token: 't', fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const blobs = new BlobFetcher({ client, cache });

    const harvester = new HubHarvester({
      sources: [spec('src-1', 'o1', 'r1'), spec('src-2', 'o2', 'r2')],
      client, blobs,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });

    const result = await harvester.run();
    assert.strictEqual(result.done, 2);
    assert.strictEqual(result.error, 0);
    assert.strictEqual(result.primitives, 2);
    assert.ok(result.totalMs >= 0);
    assert.strictEqual(result.index.stats().primitives, 2);
  });

  it('skips unchanged sources on a second run (smart rebuild)', async () => {
    const promptBytes = Buffer.from('---\ntitle: Hello\n---\n# Hello\n', 'utf8');
    const promptSha = computeGitBlobSha(promptBytes);
    const repos = new Map([
      ['o/r', {
        sha: 'fixed-sha',
        tree: [{ path: 'prompts/a.prompt.md', sha: promptSha, size: promptBytes.length }],
        blobs: new Map([[promptSha, promptBytes]])
      }]
    ]);
    let commitsCalls = 0;
    const base = makeFetch(repos);
    const counted: FetchLike = async (req) => {
      if (/\/commits\//.test(req.url)) {
        commitsCalls += 1;
      }
      return base(req);
    };
    const client = new GitHubApiClient({ token: 't', fetch: counted });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const blobs = new BlobFetcher({ client, cache });

    const mkHarv = (): HubHarvester => new HubHarvester({
      sources: [spec('src-1', 'o', 'r')],
      client, blobs,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });

    const first = await mkHarv().run();
    assert.strictEqual(first.done, 1);
    assert.strictEqual(first.skip, 0);
    const networkCallsAfterFirst = commitsCalls;
    assert.ok(networkCallsAfterFirst >= 1);

    const second = await mkHarv().run();
    // Second run: one /commits/ call to resolve the sha, then skip.
    assert.strictEqual(second.done, 0);
    assert.strictEqual(second.skip, 1);
    assert.strictEqual(commitsCalls, networkCallsAfterFirst + 1);
    // The index produced by the warm run must still contain the primitive
    // we already harvested on the first pass (carried through the index-
    // snapshot cache). Otherwise 'smart rebuild' would hand us an empty
    // index and kill the UX.
    assert.strictEqual(second.index.stats().primitives, 1);
  });

  it('harvests an awesome-copilot-plugin source (one bundle per plugin)', async () => {
    // Two plugins in the same repo, under plugins/.
    const skillBody = Buffer.from('---\ntitle: Analyzer\ndescription: a skill\n---\n# Skill\n', 'utf8');
    const skillSha = computeGitBlobSha(skillBody);
    const manifest1Body = Buffer.from(JSON.stringify({
      id: 'p1', name: 'p1', description: 'plugin 1',
      items: [{ kind: 'skill', path: './skills/a' }]
    }), 'utf8');
    const m1Sha = computeGitBlobSha(manifest1Body);
    const manifest2Body = Buffer.from(JSON.stringify({
      id: 'p2', name: 'p2', description: 'plugin 2',
      items: [{ kind: 'skill', path: './skills/b' }]
    }), 'utf8');
    const m2Sha = computeGitBlobSha(manifest2Body);

    const repos = new Map([
      ['github/awesome-copilot', {
        sha: 'plugins-sha',
        tree: [
          { path: 'plugins/p1/.github/plugin/plugin.json', sha: m1Sha, size: manifest1Body.length },
          { path: 'plugins/p1/skills/a/SKILL.md', sha: skillSha, size: skillBody.length },
          { path: 'plugins/p2/.github/plugin/plugin.json', sha: m2Sha, size: manifest2Body.length },
          { path: 'plugins/p2/skills/b/SKILL.md', sha: skillSha, size: skillBody.length }
        ],
        blobs: new Map([
          [m1Sha, manifest1Body],
          [m2Sha, manifest2Body],
          [skillSha, skillBody]
        ])
      }]
    ]);
    const fetch = makeFetch(repos);
    const client = new GitHubApiClient({ token: 't', fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const blobs = new BlobFetcher({ client, cache });

    const pluginSpec: HubSourceSpec = {
      id: 'upstream-awesome',
      name: 'github/awesome-copilot (plugins)',
      type: 'awesome-copilot-plugin',
      url: 'https://github.com/github/awesome-copilot',
      owner: 'github', repo: 'awesome-copilot', branch: 'main',
      pluginsPath: 'plugins'
    };
    const h = new HubHarvester({
      sources: [pluginSpec], client, blobs,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    assert.strictEqual(r.error, 0);
    // Each plugin harvests one primitive (the SKILL.md). The harvester
    // records 2 plugin-level "done" events + 1 source-level "done", so
    // result.done reflects the progress-log aggregate and should be ≥ 2.
    assert.ok(r.primitives >= 2, `expected >=2 primitives, got ${r.primitives}`);
    assert.strictEqual(r.index.stats().primitives, 2);
  });

  it('extracts mcp-server primitives from a plugin with mcp.items', async () => {
    const manifestBody = Buffer.from(JSON.stringify({
      id: 'mcp-pl', name: 'mcp-pl', description: 'has mcp',
      items: [],
      mcp: {
        items: {
          context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7'] }
        }
      }
    }), 'utf8');
    const mSha = computeGitBlobSha(manifestBody);
    const repos = new Map([
      ['github/awesome-copilot', {
        sha: 'plugins-sha',
        tree: [
          { path: 'plugins/mcp-pl/.github/plugin/plugin.json', sha: mSha, size: manifestBody.length }
        ],
        blobs: new Map([[mSha, manifestBody]])
      }]
    ]);
    const fetch = makeFetch(repos);
    const client = new GitHubApiClient({ token: 't', fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const blobs = new BlobFetcher({ client, cache });
    const pluginSpec: HubSourceSpec = {
      id: 'upstream-mcp', name: 'upstream-mcp', type: 'awesome-copilot-plugin',
      url: 'https://github.com/github/awesome-copilot',
      owner: 'github', repo: 'awesome-copilot', branch: 'main',
      pluginsPath: 'plugins'
    };
    const h = new HubHarvester({
      sources: [pluginSpec], client, blobs,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    assert.strictEqual(r.error, 0);
    const prims = r.index.all();
    const mcpPrims = prims.filter((p) => p.kind === 'mcp-server');
    assert.strictEqual(mcpPrims.length, 1, `expected 1 mcp-server primitive, got ${mcpPrims.length}`);
    assert.strictEqual(mcpPrims[0].title, 'context7');
  });

  it('records errors per source without aborting the run', async () => {
    const fetch: FetchLike = async (req) => {
      if (/o1\/r1\/commits\//.test(req.url)) {
        return jsonResp({ sha: 'sha-ok' });
      }
      if (/o1\/r1\/git\/trees\//.test(req.url)) {
        return jsonResp({ sha: 'sha-ok', truncated: false, tree: [] });
      }
      if (/o2\/r2/.test(req.url)) {
        return jsonResp({ message: 'boom' }, 404);
      }
      return jsonResp({ message: 'unexpected' }, 500);
    };
    const client = new GitHubApiClient({ token: 't', fetch });
    const blobs = new BlobFetcher({ client, cache: new BlobCache(path.join(tmp, 'blobs')) });
    const h = new HubHarvester({
      sources: [spec('src-1', 'o1', 'r1'), spec('src-2', 'o2', 'r2')],
      client, blobs,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    assert.strictEqual(r.done, 1);
    assert.strictEqual(r.error, 1);
  });
});
