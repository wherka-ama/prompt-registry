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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  Context,
} from '../src/cli/framework';
import {
  createProductionContext,
} from '../src/cli/framework/production-context';

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

describe('production Context wiring', () => {
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
      expect(ctx.fs).toBeTruthy();
      expect(ctx.net).toBeTruthy();
      expect(ctx.clock).toBeTruthy();
      expect(ctx.stdin).toBeTruthy();
      expect(ctx.stdout).toBeTruthy();
      expect(ctx.stderr).toBeTruthy();
      expect(typeof ctx.env).toBe('object');
      expect(typeof ctx.cwd).toBe('function');
      expect(typeof ctx.exit).toBe('function');
    });

    it('snapshots env to a frozen Record at construction time', () => {
      const ctx = createProductionContext();
      expect(() => {
        (ctx.env as Record<string, string>).LEAK = 'should-not-stick';
      }).toThrow();
    });

    it('cwd() returns a non-empty absolute path', () => {
      const ctx = createProductionContext();
      const cwd = ctx.cwd();
      expect(cwd.length).toBeGreaterThan(0);
      expect(path.isAbsolute(cwd)).toBe(true);
    });

    it('clock.now() returns a number close to Date.now()', () => {
      const ctx = createProductionContext();
      const before = Date.now();
      const t = ctx.clock.now();
      const after = Date.now();
      expect(t >= before && t <= after).toBe(true);
    });
  });

  describe('production FsAbstraction', () => {
    it('writeFile/readFile round-trips utf8 content', async () => {
      const ctx = createProductionContext();
      const file = path.join(workDir, 'roundtrip.txt');
      await ctx.fs.writeFile(file, 'hello\nworld\n');
      const got = await ctx.fs.readFile(file);
      expect(got).toBe('hello\nworld\n');
    });

    it('writeJson/readJson round-trips structured data', async () => {
      const ctx = createProductionContext();
      const file = path.join(workDir, 'data.json');
      await ctx.fs.writeJson(file, { a: 1, b: [2, 3], c: { d: 'x' } });
      const got = await ctx.fs.readJson<{ a: number; b: number[]; c: { d: string } }>(file);
      expect(got).toStrictEqual({ a: 1, b: [2, 3], c: { d: 'x' } });
    });

    it('exists() returns true for present files and false for missing', async () => {
      const ctx = createProductionContext();
      const file = path.join(workDir, 'present.txt');
      await ctx.fs.writeFile(file, 'x');
      expect(await ctx.fs.exists(file)).toBe(true);
      expect(await ctx.fs.exists(path.join(workDir, 'missing.txt'))).toBe(false);
    });

    it('mkdir({recursive:true}) creates nested directories', async () => {
      const ctx = createProductionContext();
      const dir = path.join(workDir, 'a', 'b', 'c');
      await ctx.fs.mkdir(dir, { recursive: true });
      expect(await ctx.fs.exists(dir)).toBe(true);
    });

    it('readDir() lists entries', async () => {
      const ctx = createProductionContext();
      const dir = path.join(workDir, 'listing');
      await ctx.fs.mkdir(dir, { recursive: true });
      await ctx.fs.writeFile(path.join(dir, 'one.txt'), '1');
      await ctx.fs.writeFile(path.join(dir, 'two.txt'), '2');
      const entries = await ctx.fs.readDir(dir);
      expect(entries.toSorted()).toStrictEqual(['one.txt', 'two.txt']);
    });

    it('remove({recursive:true}) deletes a directory tree', async () => {
      const ctx = createProductionContext();
      const dir = path.join(workDir, 'to-remove');
      await ctx.fs.mkdir(path.join(dir, 'inner'), { recursive: true });
      await ctx.fs.writeFile(path.join(dir, 'inner', 'f.txt'), 'x');
      await ctx.fs.remove(dir, { recursive: true });
      expect(await ctx.fs.exists(dir)).toBe(false);
    });
  });

  describe('production NetAbstraction', () => {
    it('GETs and decodes JSON', async () => {
      const ctx = createProductionContext();
      const r = await ctx.net.fetch(`${httpUrl}/path?q=1`);
      expect(r.status).toBe(200);
      const body = await r.json<{ method: string; url: string }>();
      expect(body.method).toBe('GET');
      expect(body.url).toBe('/path?q=1');
    });

    it('POSTs with body and headers', async () => {
      const ctx = createProductionContext();
      const r = await ctx.net.fetch(`${httpUrl}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'payload-text'
      });
      const body = await r.json<{ method: string; body: string }>();
      expect(body.method).toBe('POST');
      expect(body.body).toBe('payload-text');
    });

    it('exposes response headers as a flat record', async () => {
      const ctx = createProductionContext();
      const r = await ctx.net.fetch(`${httpUrl}/h`);
      expect(r.headers['x-echo-method']).toBe('GET');
    });
  });
});
