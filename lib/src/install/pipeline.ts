/**
 * Phase 5 / Iter 20 — InstallPipeline orchestrator.
 *
 * Composes the four stages (resolve → download → extract → validate
 * → write) behind a single `run()` entry. Each stage is plug-in
 * via the constructor so unit tests inject deterministic doubles
 * and the production CLI wires real GitHub/HTTP/zip impls in
 * Phase 5 spillover.
 *
 * The pipeline emits structured progress events through an optional
 * `onEvent` callback so the install command can render per-step
 * status (verbose mode) or feed the JSON envelope's `meta.events`.
 */
import type {
  BundleSpec,
  Installable,
  Target,
} from '../domain/install';
import type {
  BundleDownloader,
} from './downloader';
import type {
  BundleExtractor,
} from './extractor';
import {
  type ValidatedManifest,
  validateManifest,
} from './manifest-validator';
import type {
  BundleResolver,
} from './resolver';
import type {
  TargetWriter,
  TargetWriteResult,
} from './target-writer';

export type PipelineEvent =
  | { kind: 'resolve.start'; spec: BundleSpec }
  | { kind: 'resolve.done'; installable: Installable }
  | { kind: 'download.start'; url: string }
  | { kind: 'download.done'; sha256: string; bytes: number }
  | { kind: 'extract.start' }
  | { kind: 'extract.done'; fileCount: number }
  | { kind: 'validate.start' }
  | { kind: 'validate.done'; manifestId: string; manifestVersion: string }
  | { kind: 'write.start'; target: string }
  | { kind: 'write.done'; target: string; written: number; skipped: number };

export interface InstallPipelineOptions {
  resolver: BundleResolver;
  downloader: BundleDownloader;
  extractor: BundleExtractor;
  writer: TargetWriter;
  onEvent?: (event: PipelineEvent) => void;
}

export interface InstallOutcome {
  installable: Installable;
  manifest: ValidatedManifest;
  write: TargetWriteResult;
  sha256: string;
}

export class InstallPipelineError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly stage: 'resolve' | 'download' | 'extract' | 'validate' | 'write'
  ) {
    super(message);
    this.name = 'InstallPipelineError';
  }
}

export class InstallPipeline {
  public constructor(private readonly opts: InstallPipelineOptions) {}

  /**
   * Run the install pipeline end-to-end.
   * @param spec - Parsed BundleSpec.
   * @param target - Target to write into.
   * @returns InstallOutcome.
   */
  public async run(spec: BundleSpec, target: Target): Promise<InstallOutcome> {
    const emit = (e: PipelineEvent): void => {
      if (this.opts.onEvent !== undefined) {
        this.opts.onEvent(e);
      }
    };

    // 1. Resolve.
    emit({ kind: 'resolve.start', spec });
    const installable = await this.opts.resolver.resolve(spec);
    if (installable === null) {
      throw new InstallPipelineError(
        `bundle "${describeSpec(spec)}" not found`,
        'BUNDLE.NOT_FOUND',
        'resolve'
      );
    }
    emit({ kind: 'resolve.done', installable });

    // 2. Download.
    emit({ kind: 'download.start', url: installable.downloadUrl });
    let download;
    try {
      download = await this.opts.downloader.download(installable);
    } catch (cause) {
      throw new InstallPipelineError(
        `download failed: ${(cause as Error).message}`,
        'NETWORK.DOWNLOAD_FAILED',
        'download'
      );
    }
    emit({ kind: 'download.done', sha256: download.sha256, bytes: download.bytes.byteLength });

    // 3. Extract.
    emit({ kind: 'extract.start' });
    let files;
    try {
      files = await this.opts.extractor.extract(download.bytes);
    } catch (cause) {
      throw new InstallPipelineError(
        `extract failed: ${(cause as Error).message}`,
        'BUNDLE.EXTRACT_FAILED',
        'extract'
      );
    }
    emit({ kind: 'extract.done', fileCount: files.size });

    // 4. Validate manifest.
    emit({ kind: 'validate.start' });
    let manifest;
    try {
      manifest = validateManifest(files, {
        expectedId: spec.bundleId,
        expectedVersion: spec.bundleVersion
      });
    } catch (cause) {
      const e = cause as { code?: string; message: string };
      throw new InstallPipelineError(
        e.message,
        e.code ?? 'BUNDLE.MANIFEST_INVALID',
        'validate'
      );
    }
    emit({ kind: 'validate.done', manifestId: manifest.id, manifestVersion: manifest.version });

    // 5. Write to target.
    emit({ kind: 'write.start', target: target.name });
    let writeResult;
    try {
      writeResult = await this.opts.writer.write(target, files);
    } catch (cause) {
      throw new InstallPipelineError(
        `write failed: ${(cause as Error).message}`,
        'FS.WRITE_FAILED',
        'write'
      );
    }
    emit({
      kind: 'write.done',
      target: target.name,
      written: writeResult.written.length,
      skipped: writeResult.skipped.length
    });

    return {
      installable,
      manifest,
      write: writeResult,
      sha256: download.sha256
    };
  }
}

const describeSpec = (s: BundleSpec): string => {
  const head = s.sourceId === undefined ? s.bundleId : `${s.sourceId}:${s.bundleId}`;
  return s.bundleVersion === undefined ? head : `${head}@${s.bundleVersion}`;
};
