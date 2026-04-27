/**
 * Phase 4 / Iter 43 — `--cwd` end-to-end smoke test.
 *
 * Spawns the built binary with `--cwd <tmpRoot>` against a fresh
 * temp directory containing a single `*.collection.yml`; verifies
 * that `collection list` discovers it without affecting the
 * surrounding process's cwd.
 */
import * as assert from 'node:assert';
import {
  spawnSync,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const LIB_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CLI_BIN = path.join(LIB_ROOT, 'dist', 'cli', 'index.js');
const haveBuild = fs.existsSync(CLI_BIN);
const maybeDescribe = haveBuild ? describe : describe.skip;

maybeDescribe('Phase 4 / Iter 43 — --cwd end-to-end', () => {
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
    assert.strictEqual(proc.status, 0, `expected exit 0; stderr=${proc.stderr}`);
    const parsed = JSON.parse(proc.stdout) as {
      data: { id: string }[]; status: string;
    };
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.data.length, 1);
    assert.strictEqual(parsed.data[0].id, 'foo');
    // Sanity: spawnSync runs in our process, so cwd doesn't change.
    assert.strictEqual(process.cwd(), before);
  });
});
