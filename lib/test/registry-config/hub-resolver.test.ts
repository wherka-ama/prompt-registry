/**
 * Phase 6 / Iter 35-40 — HubResolver tests.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  envTokenProvider,
  type HttpResponse,
  NULL_TOKEN_PROVIDER,
} from '../../src/install/http';
import {
  CompositeHubResolver,
  GitHubHubResolver,
  LocalHubResolver,
  UrlHubResolver,
} from '../../src/registry-config';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';
import {
  RecordingHttpClient,
} from '../install/http.test';

const fsAdapter = createNodeFsAdapter();

const MINIMAL_YAML = `version: 1.0.0
metadata:
  name: H
  description: d
  maintainer: m
  updatedAt: "2026-04-26T00:00:00Z"
sources: []
profiles: []
`;

const ok = (text: string): HttpResponse => ({
  statusCode: 200,
  body: new TextEncoder().encode(text),
  finalUrl: 'x',
  headers: {}
});

let work: string;
beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-hr-'));
});
afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe('Phase 6 / iter 35 - LocalHubResolver', () => {
  it('reads a hub-config.yml from a directory', async () => {
    await fs.writeFile(path.join(work, 'hub-config.yml'), MINIMAL_YAML);
    const r = new LocalHubResolver(fsAdapter);
    const out = await r.resolve({ type: 'local', location: work });
    assert.strictEqual(out.config.metadata.name, 'H');
  });

  it('reads a hub-config.yml directly by file path', async () => {
    const filePath = path.join(work, 'hub.yml');
    await fs.writeFile(filePath, MINIMAL_YAML);
    const r = new LocalHubResolver(fsAdapter);
    const out = await r.resolve({ type: 'local', location: filePath });
    assert.strictEqual(out.config.metadata.name, 'H');
  });

  it('throws on missing path', async () => {
    const r = new LocalHubResolver(fsAdapter);
    await assert.rejects(
      () => r.resolve({ type: 'local', location: path.join(work, 'nope') }),
      /not found/
    );
  });

  it('throws on malformed config', async () => {
    await fs.writeFile(path.join(work, 'hub-config.yml'), 'just: a string');
    const r = new LocalHubResolver(fsAdapter);
    await assert.rejects(
      () => r.resolve({ type: 'local', location: work }),
      /malformed/
    );
  });
});

describe('Phase 6 / iter 36 - GitHubHubResolver', () => {
  it('fetches via /repos/{owner}/{repo}/contents/hub-config.yml', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/owner/repo/contents/hub-config.yml': ok(MINIMAL_YAML)
    });
    const r = new GitHubHubResolver(http, NULL_TOKEN_PROVIDER);
    const out = await r.resolve({ type: 'github', location: 'owner/repo' });
    assert.strictEqual(out.config.metadata.name, 'H');
  });

  it('passes ?ref=<branch> when ref provided', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/contents/hub-config.yml?ref=main': ok(MINIMAL_YAML)
    });
    const r = new GitHubHubResolver(http, NULL_TOKEN_PROVIDER);
    await r.resolve({ type: 'github', location: 'o/r', ref: 'main' });
    assert.ok(true);
  });

  it('attaches Authorization for private repos', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/contents/hub-config.yml': ok(MINIMAL_YAML)
    });
    const r = new GitHubHubResolver(http, envTokenProvider({ GITHUB_TOKEN: 'tk' }));
    await r.resolve({ type: 'github', location: 'o/r' });
    assert.strictEqual(http.seen[0].headers?.Authorization, 'Bearer tk');
  });

  it('throws on 404 with a clear message', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/missing/contents/hub-config.yml': {
        statusCode: 404, body: new Uint8Array(), finalUrl: 'x', headers: {}
      }
    });
    const r = new GitHubHubResolver(http, NULL_TOKEN_PROVIDER);
    await assert.rejects(
      () => r.resolve({ type: 'github', location: 'o/missing' }),
      /not found/
    );
  });
});

describe('Phase 6 / iter 37 - UrlHubResolver', () => {
  it('GETs the URL and parses YAML', async () => {
    const http = new RecordingHttpClient({
      'GET https://example.com/hub.yml': ok(MINIMAL_YAML)
    });
    const r = new UrlHubResolver(http, NULL_TOKEN_PROVIDER);
    const out = await r.resolve({ type: 'url', location: 'https://example.com/hub.yml' });
    assert.strictEqual(out.config.metadata.name, 'H');
  });
});

describe('Phase 6 / iter 38 - CompositeHubResolver', () => {
  it('dispatches by ref.type', async () => {
    let called = '';
    const stub = (tag: string) => ({
      resolve: (): Promise<any> => {
        called = tag; return Promise.resolve({ config: {}, reference: {} });
      }
    });
    const r = new CompositeHubResolver(stub('gh') as any, stub('lo') as any, stub('ur') as any);
    await r.resolve({ type: 'github', location: 'o/r' });
    assert.strictEqual(called, 'gh');
    await r.resolve({ type: 'local', location: '/x' });
    assert.strictEqual(called, 'lo');
    await r.resolve({ type: 'url', location: 'https://x' });
    assert.strictEqual(called, 'ur');
  });
});
