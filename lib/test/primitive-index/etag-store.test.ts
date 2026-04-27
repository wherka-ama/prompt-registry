/**
 * EtagStore keeps per-URL ETags so the client can send If-None-Match on
 * warm runs. 304 responses are free on GitHub's rate budget for many
 * endpoints, so this is the cheapest available optimisation.
 *
 * Contract:
 *   - get(url) / set(url, etag) persist atomically across runs.
 *   - Unknown URL -> undefined.
 *   - File is valid JSON even after a crash mid-write (atomic rename).
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EtagStore,
} from '../../src/primitive-index/hub/etag-store';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-etag-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('primitive-index / etag-store', () => {
  it('round-trips values across open/close', async () => {
    const file = path.join(tmp, 'etags.json');
    const s1 = await EtagStore.open(file);
    assert.strictEqual(s1.get('https://api.github.com/repos/a/b/commits/main'), undefined);
    await s1.set('https://api.github.com/repos/a/b/commits/main', '"abc-1"');
    await s1.save();

    const s2 = await EtagStore.open(file);
    assert.strictEqual(
      s2.get('https://api.github.com/repos/a/b/commits/main'),
      '"abc-1"'
    );
  });

  it('handles corrupt file by resetting to empty (resilience)', async () => {
    const file = path.join(tmp, 'etags.json');
    fs.writeFileSync(file, '{bogus', 'utf8');
    const s = await EtagStore.open(file);
    assert.strictEqual(s.get('any'), undefined);
    // Should still be writable.
    await s.set('any', 'tag');
    await s.save();
    const reopened = await EtagStore.open(file);
    assert.strictEqual(reopened.get('any'), 'tag');
  });

  it('delete + clear remove entries', async () => {
    const s = await EtagStore.open(path.join(tmp, 'e.json'));
    await s.set('a', 'x');
    await s.set('b', 'y');
    s.delete('a');
    assert.strictEqual(s.get('a'), undefined);
    assert.strictEqual(s.get('b'), 'y');
    s.clear();
    assert.strictEqual(s.get('b'), undefined);
  });
});
