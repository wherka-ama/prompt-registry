/**
 * Phase 2 / Iter 2 — Production Context wiring.
 *
 * Exercises the real Node-backed `Context` returned by
 * `createProductionContext()`. Tests touch real disk via `os.tmpdir()`,
 * real `Date.now()`, and real stdout/stderr by redirecting to capturing
 * sinks. Network is exercised via a local in-process loopback HTTP server
 * (no external mocking library — the production net wrapper just calls
 * global `fetch`, so we need a real listener to assert on it).
 */
import * as assert from 'node:assert';
import * as fsp from 'node:fs/promises';
import {
  createServer,
} from 'node:http';
import type {
  AddressInfo,
  Server,
} from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  Context,
} from '../../../src/cli/framework';
import {
  createProductionContext,
} from '../../../src/cli/framework/production-context';

const startEchoServer = (): Promise<{ server: Server; url: string }> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.setHeader('x-echo-method', req.method ?? '');
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString('utf8')
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });

const stopServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });

describe('Phase 2 / Iter 2 — production Context wiring', () => {
  let workDir: string;
  let httpServer: Server;
  let httpUrl: string;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prompt-registry-iter2-'));
    const started = await startEchoServer();
    httpServer = started.server;
    httpUrl = started.url;
  });

  afterEach(async () => {
    await stopServer(httpServer);
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  describe('createProductionContext()', () => {
    it('returns a Context with every IO surface populated', () => {
      const ctx: Context = createProductionContext();
      assert.ok(ctx.fs, 'fs');
      assert.ok(ctx.net, 'net');
      assert.ok(ctx.clock, 'clock');
      assert.ok(ctx.stdin, 'stdin');
      assert.ok(ctx.stdout, 'stdout');
      assert.ok(ctx.stderr, 'stderr');
      assert.strictEqual(typeof ctx.env, 'object', 'env');
      assert.strictEqual(typeof ctx.cwd, 'function', 'cwd');
      assert.strictEqual(typeof ctx.exit, 'function', 'exit');
    });

    it('snapshots env to a frozen Record at construction time', () => {
      const ctx = createProductionContext();
      // env is frozen — mutation must throw in strict mode
      assert.throws(() => {
        (ctx.env as Record<string, string>).LEAK = 'should-not-stick';
      });
    });

    it('cwd() returns a non-empty absolute path', () => {
      const ctx = createProductionContext();
      const cwd = ctx.cwd();
      assert.ok(cwd.length > 0, 'cwd is non-empty');
      assert.ok(path.isAbsolute(cwd), 'cwd is absolute');
    });

    it('clock.now() returns a number close to Date.now()', () => {
      const ctx = createProductionContext();
      const before = Date.now();
      const t = ctx.clock.now();
      const after = Date.now();
      assert.ok(t >= before && t <= after, `clock.now()=${t} between ${before}..${after}`);
    });
  });

  describe('production FsAbstraction', () => {
    it('writeFile/readFile round-trips utf8 content', async () => {
      const ctx = createProductionContext();
      const file = path.join(workDir, 'roundtrip.txt');
      await ctx.fs.writeFile(file, 'hello\nworld\n');
      const got = await ctx.fs.readFile(file);
      assert.strictEqual(got, 'hello\nworld\n');
    });

    it('writeJson/readJson round-trips structured data', async () => {
      const ctx = createProductionContext();
      const file = path.join(workDir, 'data.json');
      await ctx.fs.writeJson(file, { a: 1, b: [2, 3], c: { d: 'x' } });
      const got = await ctx.fs.readJson<{ a: number; b: number[]; c: { d: string } }>(file);
      assert.deepStrictEqual(got, { a: 1, b: [2, 3], c: { d: 'x' } });
    });

    it('exists() returns true for present files and false for missing', async () => {
      const ctx = createProductionContext();
      const file = path.join(workDir, 'present.txt');
      await ctx.fs.writeFile(file, 'x');
      assert.strictEqual(await ctx.fs.exists(file), true);
      assert.strictEqual(await ctx.fs.exists(path.join(workDir, 'missing.txt')), false);
    });

    it('mkdir({recursive:true}) creates nested directories', async () => {
      const ctx = createProductionContext();
      const dir = path.join(workDir, 'a', 'b', 'c');
      await ctx.fs.mkdir(dir, { recursive: true });
      assert.strictEqual(await ctx.fs.exists(dir), true);
    });

    it('readDir() lists entries', async () => {
      const ctx = createProductionContext();
      const dir = path.join(workDir, 'listing');
      await ctx.fs.mkdir(dir, { recursive: true });
      await ctx.fs.writeFile(path.join(dir, 'one.txt'), '1');
      await ctx.fs.writeFile(path.join(dir, 'two.txt'), '2');
      const entries = await ctx.fs.readDir(dir);
      assert.deepStrictEqual(entries.toSorted(), ['one.txt', 'two.txt']);
    });

    it('remove({recursive:true}) deletes a directory tree', async () => {
      const ctx = createProductionContext();
      const dir = path.join(workDir, 'to-remove');
      await ctx.fs.mkdir(path.join(dir, 'inner'), { recursive: true });
      await ctx.fs.writeFile(path.join(dir, 'inner', 'f.txt'), 'x');
      await ctx.fs.remove(dir, { recursive: true });
      assert.strictEqual(await ctx.fs.exists(dir), false);
    });
  });

  describe('production NetAbstraction', () => {
    it('GETs and decodes JSON', async () => {
      const ctx = createProductionContext();
      const r = await ctx.net.fetch(`${httpUrl}/path?q=1`);
      assert.strictEqual(r.status, 200);
      const body = await r.json<{ method: string; url: string }>();
      assert.strictEqual(body.method, 'GET');
      assert.strictEqual(body.url, '/path?q=1');
    });

    it('POSTs with body and headers', async () => {
      const ctx = createProductionContext();
      const r = await ctx.net.fetch(`${httpUrl}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'payload-text'
      });
      const body = await r.json<{ method: string; body: string }>();
      assert.strictEqual(body.method, 'POST');
      assert.strictEqual(body.body, 'payload-text');
    });

    it('exposes response headers as a flat record', async () => {
      const ctx = createProductionContext();
      const r = await ctx.net.fetch(`${httpUrl}/h`);
      assert.strictEqual(r.headers['x-echo-method'], 'GET');
    });
  });
});
