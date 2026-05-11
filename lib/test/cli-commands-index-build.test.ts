import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createIndexBuildCommand,
} from '../src/cli/commands/index-build';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;

const writeBundle = (root: string, id: string): void => {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'deployment-manifest.yml'),
    `id: ${id}\nversion: 1.0.0\nname: ${id}\ndescription: Tests\n`
    + `tags: [build-test]\nitems:\n  - path: prompts/hi.prompt.md\n    kind: prompt\n`,
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'prompts'));
  fs.writeFileSync(
    path.join(dir, 'prompts', 'hi.prompt.md'),
    '---\ntitle: Hello\ndescription: "greet"\ntags: [greeting]\n---\n\n# Hello',
    'utf8'
  );
};

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-build-'));
  writeBundle(tmpRoot, 'alpha');
  writeBundle(tmpRoot, 'beta');
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('cli `index build`', () => {
  it('writes the index file and reports stats in -o json envelope', async () => {
    const outFile = path.join(tmpRoot, 'index.json');
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'build'],
      {
        commands: [createIndexBuildCommand({
          root: tmpRoot,
          outFile,
          sourceId: 'local',
          output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(fs.existsSync(outFile)).toBe(true);
    const env = JSON.parse(stdout);
    expect(env.command).toBe('index.build');
    expect(env.status).toBe('ok');
    expect(env.data.outFile).toBe(outFile);
    expect(env.data.stats.primitives).toBeGreaterThanOrEqual(2);
  });

  it('text output reports a one-liner with primitives count', async () => {
    const outFile = path.join(tmpRoot, 'index.json');
    const { exitCode, stdout } = await runCommand(
      ['index', 'build'],
      {
        commands: [createIndexBuildCommand({
          root: tmpRoot,
          outFile,
          output: 'text'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/built/i);
    expect(stdout).toMatch(/primitives/);
  });

  it('missing --root produces USAGE.MISSING_FLAG', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'build'],
      {
        commands: [createIndexBuildCommand({ root: '', output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});
