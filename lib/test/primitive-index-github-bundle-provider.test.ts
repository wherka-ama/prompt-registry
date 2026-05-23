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
  GitHubSingleBundleProvider,
} from '../src/infra/harvest/bundle-providers/github-bundle-provider';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ghprov-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function jsonResp(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function fakeGithubFetch(opts: {
  commitSha: string;
  tree: { path: string; sha: string; size: number }[];
  blobs: Map<string, Buffer>;
}): FetchLike {
  return async (req) => {
    const url = new URL(req.url);
    if (/\/commits\/[^/]+$/.test(url.pathname)) {
      return jsonResp({ sha: opts.commitSha });
    }
    if (url.pathname.endsWith(`/git/trees/${opts.commitSha}`) && url.searchParams.get('recursive') === '1') {
      return jsonResp({
        sha: opts.commitSha,
        truncated: false,
        tree: opts.tree.map((t) => ({ path: t.path, type: 'blob', sha: t.sha, size: t.size }))
      });
    }
    const blobMatch = url.pathname.match(/\/git\/blobs\/([a-f0-9]+)$/);
    if (blobMatch) {
      const sha = blobMatch[1];
      const bytes = opts.blobs.get(sha);
      if (!bytes) {
        return jsonResp({ message: 'not found' }, 404);
      }
      return jsonResp({ sha, size: bytes.length, content: bytes.toString('base64'), encoding: 'base64' });
    }
    // Handle raw.githubusercontent.com URLs for file content
    if (url.hostname === 'raw.githubusercontent.com') {
      const pathMatch = url.pathname.match(/\/o\/r\/[^/]+\/(.+)$/);
      if (pathMatch) {
        const relPath = pathMatch[1];
        const treeEntry = opts.tree.find((t) => t.path === relPath);
        if (treeEntry) {
          const bytes = opts.blobs.get(treeEntry.sha);
          if (bytes) {
            return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'text/plain' } });
          }
        }
      }
      return jsonResp({ message: 'not found' }, 404);
    }
    return jsonResp({ message: `unexpected ${url.pathname}` }, 500);
  };
}

function makeSpec(): HubSourceSpec {
  return {
    id: 'src-a', name: 'Src A', type: 'github',
    url: 'https://github.com/o/r', owner: 'o', repo: 'r',
    branch: 'main'
  };
}

describe('GitHubSingleBundleProvider', () => {
  it('readFile sends Authorization header so private repos are accessible', async () => {
    const skillContent = '---\ntitle: My Skill\n---\n\n# My Skill\nBody text.\n';
    const skillBytes = Buffer.from(skillContent, 'utf8');
    const skillSha = computeGitBlobSha(skillBytes);

    const authRequiredFetch: FetchLike = async (req) => {
      const url = new URL(req.url);
      if (/\/commits\/[^/]+$/.test(url.pathname)) {
        return jsonResp({ sha: 'deadbeef' });
      }
      if (url.pathname.includes('/git/trees/') && url.searchParams.get('recursive') === '1') {
        return jsonResp({
          sha: 'deadbeef', truncated: false,
          tree: [{ path: 'skills/my-skill/SKILL.md', type: 'blob', sha: skillSha, size: skillBytes.length }]
        });
      }
      if (url.hostname === 'raw.githubusercontent.com') {
        const auth = req.headers.get('authorization');
        if (!auth || !auth.startsWith('Bearer ')) {
          return new Response('Not Found', { status: 404, statusText: 'Not Found' });
        }
        return new Response(skillContent, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return jsonResp({ message: `unexpected: ${url.pathname}` }, 500);
    };

    const client = new GitHubClient({ tokens: staticTokenProvider('secret-token'), fetch: authRequiredFetch });
    const cache = new BlobCache(tmp);
    const provider = new GitHubSingleBundleProvider({ spec: makeSpec(), client, cache });

    const refs: Awaited<ReturnType<typeof provider.listBundles> extends AsyncIterable<infer T> ? T : never>[] = [];
    for await (const r of provider.listBundles()) refs.push(r);

    const content = await provider.readFile(refs[0], 'skills/my-skill/SKILL.md');
    expect(content).toContain('title: My Skill');
  });

  it('lists one bundle with commit sha from the branch ref', async () => {
    const fetch = fakeGithubFetch({ commitSha: 'abc123', tree: [], blobs: new Map() });
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(tmp);
    const provider = new GitHubSingleBundleProvider({
      spec: makeSpec(),
      client,
      cache
    });
    const refs: unknown[] = [];
    for await (const r of provider.listBundles()) {
      refs.push(r);
    }
    expect(refs.length).toBe(1);
    expect(refs[0]).toStrictEqual({
      sourceId: 'src-a', sourceType: 'github',
      bundleId: 'src-a', bundleVersion: 'abc123', installed: false
    });
  });

  it('readManifest synthesises items from the tree', async () => {
    const promptBytes = Buffer.from('---\ntitle: P\n---\n\n# P\n', 'utf8');
    const promptSha = computeGitBlobSha(promptBytes);
    const fetch = fakeGithubFetch({
      commitSha: 'sha1',
      tree: [
        { path: 'prompts/p.prompt.md', sha: promptSha, size: promptBytes.length },
        { path: 'README.md', sha: '0000', size: 100 }
      ],
      blobs: new Map([[promptSha, promptBytes]])
    });
    const client = new GitHubClient({ tokens: staticTokenProvider('t'), fetch });
    const cache = new BlobCache(tmp);
    const provider = new GitHubSingleBundleProvider({
      spec: makeSpec(),
      client,
      cache
    });
    const refs: Awaited<ReturnType<typeof provider.listBundles> extends AsyncIterable<infer T> ? T : never>[] = [];
    for await (const r of provider.listBundles()) {
      refs.push(r);
    }
    const manifest = await provider.readManifest(refs[0]);
    expect(manifest.id).toBe('src-a');
    expect(manifest.version).toBe('sha1');
    expect(manifest.items?.length).toBe(1);
    expect(manifest.items?.[0].path).toBe('prompts/p.prompt.md');

    const content = await provider.readFile(refs[0], 'prompts/p.prompt.md');
    expect(content).toMatch(/title: P/);

    await expect(provider.readFile(refs[0], 'README.md')).rejects.toThrow(/not a primitive candidate/);
  });
});
