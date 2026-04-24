import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  main,
} from '../../src/primitive-index/cli';

function writeBundle(root: string, id: string): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'deployment-manifest.yml'),
    `id: ${id}
version: 1.0.0
name: ${id}
description: Tests
tags: [cli-test]
items:
  - path: prompts/hi.prompt.md
    kind: prompt
`,
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'prompts'));
  fs.writeFileSync(
    path.join(dir, 'prompts', 'hi.prompt.md'),
    '---\ntitle: Hello\ndescription: "greet"\ntags: [greeting]\n---\n\n# Hello',
    'utf8'
  );
}

function captureStdio<T>(fn: () => Promise<T> | T): Promise<{ result: T; stdout: string; stderr: string }> {
  return new Promise<{ result: T; stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);

    (process.stdout as any).write = (chunk: any): boolean => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    };

    (process.stderr as any).write = (chunk: any): boolean => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    };
    Promise.resolve()
      .then(fn)
      .then(
        (result) => {
          process.stdout.write = origOut;
          process.stderr.write = origErr;
          resolve({ result, stdout, stderr });
        },
        (err) => {
          process.stdout.write = origOut;
          process.stderr.write = origErr;
          reject(err as Error);
        }
      );
  });
}

describe('primitive-index CLI', () => {
  let tmp: string;
  let indexFile: string;
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cli-'));
    writeBundle(tmp, 'alpha');
    writeBundle(tmp, 'beta');
    indexFile = path.join(tmp, 'primitive-index.json');
    const { result } = await captureStdio(() => main(['build', '--root', tmp, '--out', indexFile, '--source-id', 'local']));
    assert.strictEqual(result, 0);
    assert.ok(fs.existsSync(indexFile));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('search --json emits a SearchResult-shaped payload', async () => {
    const { result, stdout } = await captureStdio(() => main(['search', '--index', indexFile, '--q', 'hello', '--json']));
    assert.strictEqual(result, 0);
    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed.hits));
    assert.ok(parsed.total >= 1);
  });

  it('search -q short flag is treated identically to --q (regression: relevance bug)', async () => {
    const { stdout: shortOut } = await captureStdio(() => main(['search', '--index', indexFile, '-q', 'hello', '--json']));
    const shortParsed = JSON.parse(shortOut);
    const { stdout: longOut } = await captureStdio(() => main(['search', '--index', indexFile, '--q', 'hello', '--json']));
    const longParsed = JSON.parse(longOut);
    assert.strictEqual(shortParsed.total, longParsed.total);
    assert.strictEqual(shortParsed.hits.length, longParsed.hits.length);
    // Score must be > 0 for a matching query — previously all docs were
    // returned with score=0 because -q was silently dropped as a positional.
    assert.ok(shortParsed.hits[0].score > 0, `expected score > 0, got ${shortParsed.hits[0].score}`);
    assert.strictEqual(shortParsed.hits[0].primitive.id, longParsed.hits[0].primitive.id);
  });

  it('search with a non-matching query returns empty hits, not all docs', async () => {
    const { stdout } = await captureStdio(() => main(['search', '--index', indexFile, '-q', 'zzzzznoneexistentterm', '--json']));
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.total, 0, 'expected 0 hits for a non-matching query');
    assert.strictEqual(parsed.hits.length, 0);
  });

  it('shortlist + export round-trip yields valid YAML files', async () => {
    // Find a primitive id to add.
    const { stdout: searchOut } = await captureStdio(() => main(['search', '--index', indexFile, '--q', 'hello', '--json']));
    const first = JSON.parse(searchOut).hits[0].primitive.id as string;

    const { stdout: slOut } = await captureStdio(() => main(['shortlist', 'new', '--index', indexFile, '--name', 'demo']));
    const sl = JSON.parse(slOut);
    await captureStdio(() => main(['shortlist', 'add', '--index', indexFile, '--id', sl.id, '--primitive', first]));

    const outDir = path.join(tmp, 'export');
    const { result, stdout } = await captureStdio(() =>
      main(['export', '--index', indexFile, '--shortlist', sl.id, '--profile-id', 'demo-profile', '--out-dir', outDir, '--suggest-collection'])
    );
    assert.strictEqual(result, 0);
    const parsed = JSON.parse(stdout);
    assert.ok(fs.existsSync(parsed.profile));
    assert.ok(fs.existsSync(parsed.collection));
    const profile = yaml.load(fs.readFileSync(parsed.profile, 'utf8')) as {
      id: string; bundles: { id: string; required: boolean }[];
    };
    assert.strictEqual(profile.id, 'demo-profile');
    assert.ok(profile.bundles.length === 1);
  });

  it('stats --json reports primitives count', async () => {
    const { stdout } = await captureStdio(() => main(['stats', '--index', indexFile, '--json']));
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.primitives >= 2);
  });

  it('exits with non-zero for unknown command', async () => {
    const { result } = await captureStdio(() => main(['nope']));
    assert.strictEqual(result, 2);
  });

  it('search defaults --index to <PROMPT_REGISTRY_CACHE>/primitive-index.json', async () => {
    // Move the built index into the conventional default location and
    // verify that search works without passing --index.
    const customCache = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-xdg-'));
    const defaultIdx = path.join(customCache, 'primitive-index.json');
    fs.copyFileSync(indexFile, defaultIdx);
    const prev = process.env.PROMPT_REGISTRY_CACHE;
    process.env.PROMPT_REGISTRY_CACHE = customCache;
    try {
      const { result, stdout } = await captureStdio(() => main(['search', '--q', 'hello', '--json']));
      assert.strictEqual(result, 0);
      const parsed = JSON.parse(stdout);
      assert.ok(parsed.total >= 1, 'expected at least one hit from the default index');
    } finally {
      if (prev === undefined) {
        delete process.env.PROMPT_REGISTRY_CACHE;
      } else {
        process.env.PROMPT_REGISTRY_CACHE = prev;
      }
      fs.rmSync(customCache, { recursive: true, force: true });
    }
  });
});
