/**
 * Phase 5 spillover / Iter 33-34 — install (remote) integration tests.
 *
 * Composes a RecordingHttpClient with the real install command via
 * the createInstallCommand factory. The test prepares a real zip
 * with archiver, registers it as the bundle.zip asset of a
 * synthetic /releases response, and asserts the post-install
 * filesystem + lockfile state.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as archiver from 'archiver';
import {
  createInstallCommand,
} from '../../src/cli/commands/install';
import {
  type FsAbstraction,
  runCommand,
} from '../../src/cli/framework';
import {
  envTokenProvider,
  type HttpResponse,
} from '../../src/install/http';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';
import {
  RecordingHttpClient,
} from './http.test';

const realFs: FsAbstraction = createNodeFsAdapter();

const buildZip = async (entries: { path: string; contents: string }[]): Promise<Uint8Array> => {
  const a = archiver.create('zip');
  const chunks: Buffer[] = [];
  return new Promise<Uint8Array>((resolve, reject) => {
    a.on('data', (chunk: Buffer): void => {
      chunks.push(chunk);
    });
    a.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    a.on('error', reject);
    for (const e of entries) {
      a.append(Buffer.from(e.contents, 'utf8'), { name: e.path });
    }
    void a.finalize();
  });
};

const okBytes = (bytes: Uint8Array): HttpResponse => ({
  statusCode: 200, body: bytes, finalUrl: 'x', headers: {}
});

let work: string;
beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-remote-'));
});
afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe('Phase 5 spillover / iter 33-34 - install (remote)', () => {
  it('end-to-end: resolve -> download -> extract -> write -> lockfile', async () => {
    // Project layout: just a target.
    const vscodeDir = path.join(work, 'vscode');
    await fs.writeFile(
      path.join(work, 'prompt-registry.yml'),
      `targets:\n  - name: my-vscode\n    type: vscode\n    scope: user\n    path: ${vscodeDir}\n`
    );

    const zip = await buildZip([
      { path: 'deployment-manifest.yml', contents: 'id: foo\nversion: 1.0.0\nname: Foo\n' },
      { path: 'prompts/hello.md', contents: '# hi' }
    ]);

    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/owner/repo/releases': {
        statusCode: 200,
        body: new TextEncoder().encode(JSON.stringify([
          {
            tag_name: 'v1.0.0',
            assets: [{
              name: 'bundle.zip',
              browser_download_url: 'https://github.com/owner/repo/releases/download/v1.0.0/bundle.zip'
            }]
          }
        ])),
        finalUrl: 'x',
        headers: {}
      },
      'GET https://github.com/owner/repo/releases/download/v1.0.0/bundle.zip': okBytes(zip)
    });
    const tokens = envTokenProvider({});

    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode',
        source: 'owner/repo',
        http,
        tokens
      })],
      context: { cwd: work, fs: realFs, env: { HOME: work } }
    });
    assert.strictEqual(result.exitCode, 0, `stdout=${result.stdout}; stderr=${result.stderr}`);
    const parsed = JSON.parse(result.stdout) as {
      data: {
        bundle: { id: string; version: string };
        source: { repo: string; sourceId: string };
        sha256: string;
      };
    };
    assert.strictEqual(parsed.data.bundle.id, 'foo');
    assert.strictEqual(parsed.data.bundle.version, '1.0.0');
    assert.strictEqual(parsed.data.source.repo, 'owner/repo');
    assert.match(parsed.data.source.sourceId, /^github-[0-9a-f]{12}$/);

    // Filesystem check.
    const target = await fs.readFile(path.join(vscodeDir, 'prompts', 'hello.md'), 'utf8');
    assert.strictEqual(target, '# hi');

    // Lockfile check.
    const lock = JSON.parse(await fs.readFile(path.join(work, 'prompt-registry.lock.json'), 'utf8')) as {
      entries: { sha256?: string; sourceId: string; fileChecksums?: Record<string, string> }[];
      sources: Record<string, { type: string; url: string }>;
    };
    assert.strictEqual(lock.entries.length, 1);
    assert.match(lock.entries[0].sha256 ?? '', /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(
      Object.keys(lock.entries[0].fileChecksums ?? {}).toSorted(),
      ['prompts/hello.md']
    );
    assert.deepStrictEqual(
      lock.sources[lock.entries[0].sourceId],
      { type: 'github', url: 'https://github.com/owner/repo' }
    );
  });

  it('install <bundle> without --source surfaces USAGE.MISSING_FLAG', async () => {
    await fs.writeFile(
      path.join(work, 'prompt-registry.yml'),
      `targets:\n  - name: my-vscode\n    type: vscode\n    scope: user\n    path: ${path.join(work, 'v')}\n`
    );
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode'
        // No --source, no --from -> error.
      })],
      context: { cwd: work, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });

  it('returns BUNDLE.NOT_FOUND when the resolver yields null', async () => {
    await fs.writeFile(
      path.join(work, 'prompt-registry.yml'),
      `targets:\n  - name: my-vscode\n    type: vscode\n    scope: user\n    path: ${path.join(work, 'v')}\n`
    );
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/owner/repo/releases':
        okBytes(new TextEncoder().encode('[]'))
    });
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode',
        source: 'owner/repo',
        http,
        tokens: envTokenProvider({})
      })],
      context: { cwd: work, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'BUNDLE.NOT_FOUND');
  });
});
