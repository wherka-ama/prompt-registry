/**
 * Tests for AwesomeCopilotPluginBundleProvider.
 *
 * Unlike GitHubSingleBundleProvider (1 source = 1 bundle), the plugin
 * provider produces 1 bundle per discovered plugin. Each plugin's
 * bundleId = plugin folder name; all bundles share the same commit sha
 * (bundleVersion), inherited from the repo tip.
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  describe,
  it,
} from 'mocha';
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
  AwesomeCopilotPluginBundleProvider,
} from '../../src/primitive-index/hub/plugin-bundle-provider';

function jsonResponse(body: unknown): Response {
  return Response.json(body, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('primitive-index / plugin-bundle-provider', () => {
  it('produces one BundleRef per discovered plugin with shared commit sha', async () => {
    const commitSha = '1111aaaa2222bbbb3333cccc4444dddd5555eeee';
    const manifest1 = JSON.stringify({ id: 'p1', name: 'p1', description: 'plugin 1', items: [
      { kind: 'skill', path: './skills/a' }
    ] });
    const manifest2 = JSON.stringify({ id: 'p2', name: 'p2', description: 'plugin 2', items: [
      { kind: 'prompt', path: './prompts/hello.prompt.md' }
    ] });
    const skillBody = '# SKILL a\n';
    const promptBody = 'hello prompt';
    // BlobCache.put() re-checks the git-blob SHA of the content, so the
    // tree shas must be the real SHAs of the bytes we return below.
    const m1Sha = computeGitBlobSha(Buffer.from(manifest1, 'utf8'));
    const m2Sha = computeGitBlobSha(Buffer.from(manifest2, 'utf8'));
    const b1Sha = computeGitBlobSha(Buffer.from(skillBody, 'utf8'));
    const b2Sha = computeGitBlobSha(Buffer.from(promptBody, 'utf8'));
    const tree = {
      sha: 't',
      truncated: false,
      tree: [
        { path: 'plugins/p1/.github/plugin/plugin.json', type: 'blob', sha: m1Sha, size: manifest1.length },
        { path: 'plugins/p1/skills/a/SKILL.md', type: 'blob', sha: b1Sha, size: skillBody.length },
        { path: 'plugins/p2/.github/plugin/plugin.json', type: 'blob', sha: m2Sha, size: manifest2.length },
        { path: 'plugins/p2/prompts/hello.prompt.md', type: 'blob', sha: b2Sha, size: promptBody.length }
      ]
    };
    const byCorpus: Record<string, string> = {
      [m1Sha]: manifest1, [m2Sha]: manifest2,
      [b1Sha]: skillBody, [b2Sha]: promptBody
    };
    const fakeFetch: FetchLike = async (req) => {
      const url = (req).url;
      if (url.includes('/commits/')) {
        return jsonResponse({ sha: commitSha });
      }
      if (url.includes('/git/trees/')) {
        return jsonResponse(tree);
      }
      const m = /\/git\/blobs\/(\w+)/u.exec(url);
      if (m) {
        const content = byCorpus[m[1]];
        if (content !== undefined) {
          return jsonResponse({
            sha: m[1], encoding: 'base64',
            content: Buffer.from(content, 'utf8').toString('base64')
          });
        }
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    const client = new GitHubApiClient({ token: 't', fetch: fakeFetch });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-'));
    const cache = new BlobCache(path.join(tmpDir, 'blobs'));
    const blobFetcher = new BlobFetcher({ client, cache });

    const spec: HubSourceSpec = {
      id: 'awesome-upstream',
      name: 'github/awesome-copilot (plugins)',
      type: 'awesome-copilot-plugin',
      url: 'https://github.com/github/awesome-copilot',
      owner: 'github', repo: 'awesome-copilot', branch: 'main',
      pluginsPath: 'plugins',
      rawConfig: {}
    };
    const provider = new AwesomeCopilotPluginBundleProvider({ spec, client, blobs: blobFetcher });

    // listBundles → one per plugin with shared commit sha.
    const refs = [];
    for await (const ref of provider.listBundles()) {
      refs.push(ref);
    }
    assert.strictEqual(refs.length, 2);
    const byId = new Map(refs.map((r) => [r.bundleId, r]));
    assert.ok(byId.has('p1') && byId.has('p2'));
    for (const r of refs) {
      assert.strictEqual(r.sourceId, 'awesome-upstream');
      assert.strictEqual(r.sourceType, 'awesome-copilot-plugin');
      assert.strictEqual(r.bundleVersion, commitSha);
      assert.strictEqual(r.installed, false);
    }

    // readManifest → items reflect each plugin's own entry files.
    const m1 = await provider.readManifest(byId.get('p1')!);
    assert.strictEqual(m1.id, 'p1');
    assert.strictEqual(m1.version, commitSha);
    assert.ok(m1.items?.some((i) => i.path === 'plugins/p1/skills/a/SKILL.md'));
    // The plugin manifest file itself is included too so the index can
    // recover plugin metadata.
    assert.ok(m1.items?.some((i) => i.path === 'plugins/p1/.github/plugin/plugin.json'));

    // readFile returns the correct blob bytes per plugin.
    assert.strictEqual(
      await provider.readFile(byId.get('p1')!, 'plugins/p1/skills/a/SKILL.md'),
      '# SKILL a\n'
    );
    assert.strictEqual(
      await provider.readFile(byId.get('p2')!, 'plugins/p2/prompts/hello.prompt.md'),
      'hello prompt'
    );

    // readFile rejects paths not in this plugin's candidates (isolation).
    await assert.rejects(
      () => provider.readFile(byId.get('p1')!, 'plugins/p2/prompts/hello.prompt.md'),
      /not part of plugin/u
    );
  });

  it('surfaces plugin-declared MCP servers via manifest.mcp.items', async () => {
    const commitSha = '2222aaaa3333bbbb4444cccc5555dddd6666eeee';
    const manifest = JSON.stringify({
      id: 'mcp-plugin', name: 'mcp-plugin', description: 'a plugin with MCP',
      items: [],
      mcp: {
        items: {
          context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7'] }
        }
      }
    });
    const mSha = computeGitBlobSha(Buffer.from(manifest, 'utf8'));
    const tree = {
      sha: 't',
      truncated: false,
      tree: [
        { path: 'plugins/mcp-plugin/.github/plugin/plugin.json', type: 'blob', sha: mSha, size: manifest.length }
      ]
    };
    const fakeFetch: FetchLike = async (req) => {
      const url = (req).url;
      if (url.includes('/commits/')) {
        return jsonResponse({ sha: commitSha });
      }
      if (url.includes('/git/trees/')) {
        return jsonResponse(tree);
      }
      const m = /\/git\/blobs\/(\w+)/u.exec(url);
      if (m && m[1] === mSha) {
        return jsonResponse({
          sha: mSha, encoding: 'base64',
          content: Buffer.from(manifest, 'utf8').toString('base64')
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    const client = new GitHubApiClient({ token: 't', fetch: fakeFetch });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-mcp-'));
    const cache = new BlobCache(path.join(tmpDir, 'blobs'));
    const blobFetcher = new BlobFetcher({ client, cache });
    const spec: HubSourceSpec = {
      id: 'mcp-src', name: 'mcp-src', type: 'awesome-copilot-plugin',
      url: 'https://github.com/o/r',
      owner: 'o', repo: 'r', branch: 'main', pluginsPath: 'plugins',
      rawConfig: {}
    };
    const provider = new AwesomeCopilotPluginBundleProvider({ spec, client, blobs: blobFetcher });
    const refs = [];
    for await (const ref of provider.listBundles()) {
      refs.push(ref);
    }
    const bm = await provider.readManifest(refs[0]);
    assert.ok(bm.mcp, 'expected manifest.mcp to be populated');
    assert.deepStrictEqual(
      bm.mcp?.items?.context7,
      { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7'] }
    );
  });
});
