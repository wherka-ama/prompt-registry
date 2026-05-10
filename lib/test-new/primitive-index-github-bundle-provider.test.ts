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
} from '../src/primitive-index/hub/blob-cache';
import {
  BlobFetcher,
} from '../src/primitive-index/hub/blob-fetcher';
import {
  type FetchLike,
  GitHubApiClient,
} from '../src/primitive-index/hub/github-api-client';
import {
  GitHubSingleBundleProvider,
} from '../src/primitive-index/hub/github-bundle-provider';

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
  it('lists one bundle with commit sha from the branch ref', async () => {
    const fetch = fakeGithubFetch({ commitSha: 'abc123', tree: [], blobs: new Map() });
    const client = new GitHubApiClient({ token: 't', fetch });
    const cache = new BlobCache(tmp);
    const provider = new GitHubSingleBundleProvider({
      spec: makeSpec(),
      client,
      blobs: new BlobFetcher({ client, cache })
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
    const client = new GitHubApiClient({ token: 't', fetch });
    const provider = new GitHubSingleBundleProvider({
      spec: makeSpec(),
      client,
      blobs: new BlobFetcher({ client, cache: new BlobCache(tmp) })
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
