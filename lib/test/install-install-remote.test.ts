import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as archiver from 'archiver';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createInstallCommand,
} from '../src/cli/commands/install';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  envTokenProvider,
} from '../src/infra/github/token';
import type {
  HttpResponse,
} from '../src/ports/http';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';
import {
  RecordingHttpClient,
} from './install-http.test';

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

describe('install (remote)', () => {
  it('end-to-end: resolve -> download -> extract -> write -> lockfile', async () => {
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
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: {
        bundle: { id: string; version: string };
        source: { repo: string; sourceId: string };
        sha256: string;
      };
    };
    expect(parsed.data.bundle.id).toBe('foo');
    expect(parsed.data.bundle.version).toBe('1.0.0');
    expect(parsed.data.source.repo).toBe('owner/repo');
    expect(parsed.data.source.sourceId).toMatch(/^github-[0-9a-f]{12}$/);

    const target = await fs.readFile(path.join(vscodeDir, 'prompts', 'hello.md'), 'utf8');
    expect(target).toBe('# hi');

    const lock = JSON.parse(await fs.readFile(path.join(work, 'prompt-registry.lock.json'), 'utf8')) as {
      entries: { sha256?: string; sourceId: string; fileChecksums?: Record<string, string> }[];
      sources: Record<string, { type: string; url: string }>;
    };
    expect(lock.entries.length).toBe(1);
    expect(lock.entries[0].sha256 ?? '').toMatch(/^[0-9a-f]{64}$/);
    expect(
      Object.keys(lock.entries[0].fileChecksums ?? {}).toSorted()
    ).toStrictEqual(['prompts/hello.md']);
    expect(
      lock.sources[lock.entries[0].sourceId]
    ).toStrictEqual({ type: 'github', url: 'https://github.com/owner/repo' });
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
      })],
      context: { cwd: work, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
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
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('BUNDLE.NOT_FOUND');
  });
});
