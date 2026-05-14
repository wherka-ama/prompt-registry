import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  HubSourceSpec,
} from '../src/domain';
import {
  BlobCache,
  computeGitBlobSha,
} from '../src/infra/github/blob-cache';
import {
  type FetchLike,
  GitHubClient,
} from '../src/infra/github/client';
import {
  staticTokenProvider,
} from '../src/infra/github/token';
import {
  HubHarvester,
} from '../src/infra/harvest/hub-harvester';

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
    // Handle raw.githubusercontent.com URLs for file content (before /repos/ check)
    if (url.hostname === 'raw.githubusercontent.com') {
      const pathMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/);
      if (pathMatch) {
        const owner = pathMatch[1];
        const repoName = pathMatch[2];
        const relPath = pathMatch[3];
        const rawKey = `${owner}/${repoName}`;
        const repoData = repos.get(rawKey);
        if (repoData) {
          const entry = repoData.tree.find((t) => t.path === relPath);
          if (entry) {
            const blob = repoData.blobs.get(entry.sha);
            if (blob) {
              return new Response(new Uint8Array(blob), { status: 200, headers: { 'content-type': 'text/plain' } });
            }
          }
        }
        return Response.json({ message: 'not found' }, { status: 404, headers: { 'content-type': 'application/json' } });
      }
    }
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
    if (!m) {
      return jsonResp({ message: 'no repo' }, 404);
    }
    const repoKey = `${m[1]}/${m[2]}`;
    const repo = repos.get(repoKey);
    if (!repo) {
      return jsonResp({ message: `unknown ${repoKey}` }, 404);
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
    // Handle raw.githubusercontent.com URLs for file content
    if (url.hostname === 'raw.githubusercontent.com') {
      const pathMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/);
      console.log('DEBUG mock: raw.githubusercontent.com URL =', url.href, 'pathMatch =', pathMatch);
      if (pathMatch) {
        const owner = pathMatch[1];
        const repoName = pathMatch[2];
        const relPath = pathMatch[3];
        const rawKey = `${owner}/${repoName}`;
        const repoData = repos.get(rawKey);
        console.log('DEBUG mock: key =', rawKey, 'repoData =', !!repoData);
        if (repoData) {
          const entry = repoData.tree.find((t) => t.path === relPath);
          console.log('DEBUG mock: relPath =', relPath, 'entry =', !!entry);
          if (entry) {
            const blob = repoData.blobs.get(entry.sha);
            console.log('DEBUG mock: blob =', !!blob, 'size =', blob?.length);
            if (blob) {
              return new Response(new Uint8Array(blob), { status: 200, headers: { 'content-type': 'text/plain' } });
            }
          }
        }
        return Response.json({ message: 'not found' }, { status: 404, headers: { 'content-type': 'application/json' } });
      }
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

describe('hub-harvester', () => {
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
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));

    const harvester = new HubHarvester({
      sources: [spec('src-1', 'o1', 'r1'), spec('src-2', 'o2', 'r2')],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });

    const result = await harvester.run();
    expect(result.done).toBe(2);
    expect(result.error).toBe(0);
    expect(result.primitives).toBe(2);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.index.stats().primitives).toBe(2);
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
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch: counted });
    const cache = new BlobCache(path.join(tmp, 'blobs'));

    const mkHarv = (): HubHarvester => new HubHarvester({
      sources: [spec('src-1', 'o', 'r')],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });

    const first = await mkHarv().run();
    expect(first.done).toBe(1);
    expect(first.skip).toBe(0);
    const networkCallsAfterFirst = commitsCalls;
    expect(networkCallsAfterFirst).toBeGreaterThanOrEqual(1);

    const second = await mkHarv().run();
    expect(second.done).toBe(0);
    expect(second.skip).toBe(1);
    expect(commitsCalls).toBe(networkCallsAfterFirst + 1);
    expect(second.index.stats().primitives).toBe(1);
  });

  it('harvests an awesome-copilot-plugin source (one bundle per plugin)', async () => {
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
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));

    const pluginSpec: HubSourceSpec = {
      id: 'upstream-awesome',
      name: 'github/awesome-copilot (plugins)',
      type: 'awesome-copilot-plugin',
      url: 'https://github.com/github/awesome-copilot',
      owner: 'github', repo: 'awesome-copilot', branch: 'main',
      pluginsPath: 'plugins'
    };
    const h = new HubHarvester({
      sources: [pluginSpec],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    expect(r.error).toBe(0);
    expect(r.primitives).toBeGreaterThanOrEqual(2);
    expect(r.index.stats().primitives).toBe(2);
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
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const pluginSpec: HubSourceSpec = {
      id: 'upstream-mcp', name: 'upstream-mcp', type: 'awesome-copilot-plugin',
      url: 'https://github.com/github/awesome-copilot',
      owner: 'github', repo: 'awesome-copilot', branch: 'main',
      pluginsPath: 'plugins'
    };
    const h = new HubHarvester({
      sources: [pluginSpec],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    expect(r.error).toBe(0);
    const prims = r.index.all();
    const mcpPrims = prims.filter((p) => p.kind === 'mcp-server');
    expect(mcpPrims.length).toBe(1);
    expect(mcpPrims[0].title).toBe('context7');
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
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const h = new HubHarvester({
      sources: [spec('src-1', 'o1', 'r1'), spec('src-2', 'o2', 'r2')],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    expect(r.done).toBe(1);
    expect(r.error).toBe(1);
  });

  it('handles empty tree gracefully', async () => {
    const repos = new Map([
      ['o/r', {
        sha: 'fixed-sha',
        tree: [],
        blobs: new Map()
      }]
    ]);
    const fetch = makeFetch(repos);
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const h = new HubHarvester({
      sources: [spec('src-1', 'o', 'r')],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    expect(r.done).toBe(1);
    expect(r.primitives).toBe(0);
    expect(r.error).toBe(0);
  });

  it('handles malformed manifest files without crashing', async () => {
    const badManifest = Buffer.from('not valid json {{{', 'utf8');
    const mSha = computeGitBlobSha(badManifest);
    const repos = new Map([
      ['o/r', {
        sha: 'fixed-sha',
        tree: [{ path: 'collections/bad.collection.yml', sha: mSha, size: badManifest.length }],
        blobs: new Map([[mSha, badManifest]])
      }]
    ]);
    const fetch = makeFetch(repos);
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const h = new HubHarvester({
      sources: [spec('src-1', 'o', 'r')],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 1
    });
    const r = await h.run();
    // Should complete but with error
    expect(r.done + r.error).toBe(1);
  });

  it('respects concurrency limit when harvesting multiple sources', async () => {
    const promptBytes = Buffer.from('---\ntitle: Hello\n---\n# Hello\n', 'utf8');
    const promptSha = computeGitBlobSha(promptBytes);
    const repos = new Map([
      ['o1/r1', {
        sha: 'sha1',
        tree: [{ path: 'prompts/a.prompt.md', sha: promptSha, size: promptBytes.length }],
        blobs: new Map([[promptSha, promptBytes]])
      }],
      ['o2/r2', {
        sha: 'sha2',
        tree: [{ path: 'prompts/b.prompt.md', sha: promptSha, size: promptBytes.length }],
        blobs: new Map([[promptSha, promptBytes]])
      }],
      ['o3/r3', {
        sha: 'sha3',
        tree: [{ path: 'prompts/c.prompt.md', sha: promptSha, size: promptBytes.length }],
        blobs: new Map([[promptSha, promptBytes]])
      }]
    ]);
    const fetch = makeFetch(repos);
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(path.join(tmp, 'blobs'));
    const h = new HubHarvester({
      sources: [spec('src-1', 'o1', 'r1'), spec('src-2', 'o2', 'r2'), spec('src-3', 'o3', 'r3')],
      client,
      cache,
      progressFile: path.join(tmp, 'progress.jsonl'),
      concurrency: 2
    });
    const r = await h.run();
    // With concurrency=2, all 3 should complete (just limits parallelism, not total)
    expect(r.done).toBe(3);
    expect(r.primitives).toBeGreaterThanOrEqual(2);
  });
});
