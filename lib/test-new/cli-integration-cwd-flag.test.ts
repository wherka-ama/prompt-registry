import {
  spawnSync,
} from 'node:child_process';
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

const LIB_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI_BIN = path.join(LIB_ROOT, 'dist', 'cli', 'index.js');
const haveBuild = fs.existsSync(CLI_BIN);
const maybeDescribe = haveBuild ? describe : describe.skip;

maybeDescribe('--cwd end-to-end', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-e2e-cwd-'));
    fs.mkdirSync(path.join(tmp, 'collections'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'collections', 'foo.collection.yml'),
      'id: foo\nname: Foo\nitems: []\n'
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('honors --cwd without changing the surrounding process cwd', () => {
    const before = process.cwd();
    const proc = spawnSync(
      'node',
      [CLI_BIN, 'collection', 'list', '--cwd', tmp, '-o', 'json'],
      { encoding: 'utf8' }
    );
    expect(proc.status).toBe(0);
    const parsed = JSON.parse(proc.stdout) as {
      data: { id: string }[]; status: string;
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].id).toBe('foo');
    expect(process.cwd()).toBe(before);
  });
});
