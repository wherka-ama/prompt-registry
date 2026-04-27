/**
 * Phase 5 / Iter 21 — InstallPipeline tests.
 */
import * as assert from 'node:assert';
import type {
  Installable,
  Target,
} from '../../src/domain/install';
import {
  MemoryBundleDownloader,
} from '../../src/install/downloader';
import {
  DictBundleExtractor,
  filesFromRecord,
} from '../../src/install/extractor';
import {
  MANIFEST_FILENAME,
} from '../../src/install/manifest-validator';
import {
  InstallPipeline,
  InstallPipelineError,
  type PipelineEvent,
} from '../../src/install/pipeline';
import {
  MapBundleResolver,
} from '../../src/install/resolver';
import {
  FileTreeTargetWriter,
  type WriterFs,
} from '../../src/install/target-writer';

const target: Target = { name: 'dev', type: 'vscode', scope: 'user', path: '/tmp/v' };

const installable = (v = '1.0.0'): Installable => ({
  ref: {
    sourceId: 'a/b', sourceType: 'github',
    bundleId: 'foo', bundleVersion: v, installed: false
  },
  downloadUrl: `https://x/${v}.zip`
});

const goodFiles = filesFromRecord({
  [MANIFEST_FILENAME]: 'id: foo\nversion: 1.0.0\nname: Foo\n',
  'prompts/a.md': 'A',
  'chatmodes/b.md': 'B'
});

const makeFs = (): WriterFs & { writes: Map<string, string> } => {
  const writes = new Map<string, string>();
  return {
    writes,
    writeFile: (p: string, b: string): Promise<void> => {
      writes.set(p, b);
      return Promise.resolve();
    },
    mkdir: (): Promise<void> => Promise.resolve()
  };
};

const makePipeline = (overrides: Partial<{
  resolved: Installable | null;
  files: ReturnType<typeof filesFromRecord>;
  bytes: Uint8Array;
}> = {}): { pipeline: InstallPipeline; fs: ReturnType<typeof makeFs>; events: PipelineEvent[] } => {
  const events: PipelineEvent[] = [];
  const inst = overrides.resolved === undefined ? installable() : overrides.resolved;
  const resolverEntries: Record<string, Installable[]> = inst === null ? {} : { 'a/b:foo': [inst] };
  const fs = makeFs();
  const pipeline = new InstallPipeline({
    resolver: new MapBundleResolver(resolverEntries),
    downloader: new MemoryBundleDownloader({
      'https://x/1.0.0.zip': overrides.bytes ?? new Uint8Array(8)
    }),
    extractor: new DictBundleExtractor(overrides.files ?? goodFiles),
    writer: new FileTreeTargetWriter({ fs, env: { HOME: '/home/me' } }),
    onEvent: (e) => events.push(e)
  });
  return { pipeline, fs, events };
};

describe('Phase 5 / Iter 21 — InstallPipeline', () => {
  it('runs end-to-end: resolve -> download -> extract -> validate -> write', async () => {
    const { pipeline, fs, events } = makePipeline();
    const outcome = await pipeline.run(
      { sourceId: 'a/b', bundleId: 'foo', bundleVersion: '1.0.0' },
      target
    );
    assert.strictEqual(outcome.manifest.id, 'foo');
    assert.strictEqual(outcome.manifest.version, '1.0.0');
    assert.strictEqual(outcome.write.written.length, 2);
    assert.strictEqual(fs.writes.size, 2);
    // Event order pin.
    const kinds = events.map((e) => e.kind);
    assert.deepStrictEqual(kinds, [
      'resolve.start', 'resolve.done',
      'download.start', 'download.done',
      'extract.start', 'extract.done',
      'validate.start', 'validate.done',
      'write.start', 'write.done'
    ]);
  });

  it('throws InstallPipelineError(BUNDLE.NOT_FOUND) when resolver returns null', async () => {
    const { pipeline } = makePipeline({ resolved: null });
    await assert.rejects(
      () => pipeline.run({ bundleId: 'missing' }, target),
      (err: unknown) => err instanceof InstallPipelineError
        && err.code === 'BUNDLE.NOT_FOUND'
        && err.stage === 'resolve'
    );
  });

  it('throws InstallPipelineError(BUNDLE.MANIFEST_MISSING) when manifest is absent', async () => {
    const { pipeline } = makePipeline({
      files: filesFromRecord({ 'prompts/a.md': 'A' })
    });
    await assert.rejects(
      () => pipeline.run({ sourceId: 'a/b', bundleId: 'foo' }, target),
      (err: unknown) => err instanceof InstallPipelineError
        && err.code === 'BUNDLE.MANIFEST_MISSING'
        && err.stage === 'validate'
    );
  });

  it('throws InstallPipelineError(BUNDLE.VERSION_MISMATCH) when manifest version differs', async () => {
    // Set up: resolver claims version 9.9.9, but the manifest inside
    // the bundle ships 1.0.0. The validate stage catches the
    // mismatch.
    const { pipeline } = makePipeline({
      resolved: {
        ref: {
          sourceId: 'a/b', sourceType: 'github',
          bundleId: 'foo', bundleVersion: '9.9.9', installed: false
        },
        downloadUrl: 'https://x/1.0.0.zip'
      }
    });
    await assert.rejects(
      () => pipeline.run({
        sourceId: 'a/b',
        bundleId: 'foo',
        bundleVersion: '9.9.9'
      }, target),
      (err: unknown) => err instanceof InstallPipelineError
        && err.code === 'BUNDLE.VERSION_MISMATCH'
    );
  });
});
