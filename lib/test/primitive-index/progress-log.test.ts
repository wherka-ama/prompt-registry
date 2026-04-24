/**
 * Tests for the append-only JSONL progress log used by the hub harvester.
 *
 * Properties we care about:
 *   - Append-only + line-buffered: survives process death without losing
 *     completed work.
 *   - Parseable by `load()`: projects the latest state per (sourceId,bundleId).
 *   - `shouldResume()` answers the question "did we already finish this
 *     bundle at this commit SHA?" — the foundation for smart rebuild.
 *   - Corrupt lines are skipped, not thrown (resilience).
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  HarvestProgressLog,
} from '../../src/primitive-index/hub/progress-log';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-progress-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('primitive-index / progress-log', () => {
  it('appends JSONL events and reloads projected state', async () => {
    const file = path.join(tmp, 'run.jsonl');
    const log = await HarvestProgressLog.open(file);
    await log.recordStart({ sourceId: 'src-a', bundleId: 'b1', commitSha: 'aaa' });
    await log.recordDone({ sourceId: 'src-a', bundleId: 'b1', commitSha: 'aaa', primitives: 7, ms: 123 });
    await log.close();

    const reloaded = await HarvestProgressLog.open(file);
    const state = reloaded.projectState();
    assert.strictEqual(state.get('src-a/b1')?.status, 'done');
    assert.strictEqual(state.get('src-a/b1')?.commitSha, 'aaa');
    assert.strictEqual(state.get('src-a/b1')?.primitives, 7);
    await reloaded.close();
  });

  it('shouldResume returns false when the bundle is complete at the same SHA', async () => {
    const file = path.join(tmp, 'run.jsonl');
    const log = await HarvestProgressLog.open(file);
    await log.recordDone({ sourceId: 's', bundleId: 'b', commitSha: 'sha1', primitives: 1, ms: 1 });
    assert.strictEqual(log.shouldResume('s', 'b', 'sha1'), false);
    assert.strictEqual(log.shouldResume('s', 'b', 'sha2'), true);
    assert.strictEqual(log.shouldResume('s', 'other', 'sha1'), true);
    await log.close();
  });

  it('tolerates (skips) a corrupt line without aborting load', async () => {
    const file = path.join(tmp, 'run.jsonl');
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ kind: 'start', sourceId: 's', bundleId: 'b1', commitSha: 'x', ts: 1 }),
        '{"this is corrupt',
        JSON.stringify({ kind: 'done', sourceId: 's', bundleId: 'b1', commitSha: 'x', primitives: 3, ms: 2, ts: 2 })
      ].join('\n') + '\n',
      'utf8'
    );
    const log = await HarvestProgressLog.open(file);
    const state = log.projectState();
    assert.strictEqual(state.get('s/b1')?.status, 'done');
    await log.close();
  });

  it('records error events and surfaces them in the projected state', async () => {
    const file = path.join(tmp, 'run.jsonl');
    const log = await HarvestProgressLog.open(file);
    await log.recordError({ sourceId: 's', bundleId: 'b1', commitSha: 'x', error: 'boom' });
    const st = log.projectState().get('s/b1');
    assert.strictEqual(st?.status, 'error');
    assert.strictEqual(st?.error, 'boom');
    // A new attempt marking start -> done should supersede the error.
    await log.recordDone({ sourceId: 's', bundleId: 'b1', commitSha: 'x', primitives: 4, ms: 5 });
    assert.strictEqual(log.projectState().get('s/b1')?.status, 'done');
    await log.close();
  });

  it('summary() aggregates counts per status', async () => {
    const file = path.join(tmp, 'run.jsonl');
    const log = await HarvestProgressLog.open(file);
    await log.recordDone({ sourceId: 's', bundleId: 'a', commitSha: 'x', primitives: 2, ms: 1 });
    await log.recordDone({ sourceId: 's', bundleId: 'b', commitSha: 'x', primitives: 3, ms: 1 });
    await log.recordError({ sourceId: 's', bundleId: 'c', commitSha: 'x', error: 'net' });
    const s = log.summary();
    assert.strictEqual(s.done, 2);
    assert.strictEqual(s.error, 1);
    assert.strictEqual(s.primitives, 5);
    await log.close();
  });
});
