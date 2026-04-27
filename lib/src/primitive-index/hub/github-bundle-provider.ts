/**
 * GitHubSingleBundleProvider — treats one `type=github` source as one
 * bundle. Exposes the BundleProvider surface the PrimitiveIndex
 * harvester expects.
 *
 * Why "single" in the name: `awesome-copilot` sources expose multiple
 * bundles (one per collection); those use a different provider (iter 9).
 *
 * bundleVersion == commit sha. The harvester uses this to implement smart
 * rebuild: if the latest commit sha matches the one in the progress log,
 * the bundle is skipped entirely.
 */

import type {
  HubSourceSpec,
} from '../../domain';
import type {
  BundleManifest,
  BundleProvider,
  BundleRef,
} from '../types';
import type {
  BlobFetcher,
} from './blob-fetcher';
import type {
  GitHubApiClient,
} from './github-api-client';
import {
  enumerateRepoTree,
  type EnumerateResult,
  isPrimitiveCandidatePath,
} from './tree-enumerator';

export interface GitHubSingleBundleProviderOpts {
  spec: HubSourceSpec;
  client: GitHubApiClient;
  blobs: BlobFetcher;
  /** Optional path prefix (used by awesome-copilot for per-collection shards). */
  pathPrefix?: string;
  /** Optional bundle-id override (awesome-copilot uses `${sourceId}/${collection}`). */
  bundleId?: string;
}

/* eslint-disable @typescript-eslint/member-ordering -- public API kept at top. */
export class GitHubSingleBundleProvider implements BundleProvider {
  private enumeration: EnumerateResult | undefined;

  public constructor(private readonly opts: GitHubSingleBundleProviderOpts) {}

  public async* listBundles(): AsyncIterable<BundleRef> {
    const enumeration = await this.ensureEnumeration();
    yield {
      sourceId: this.opts.spec.id,
      sourceType: this.opts.spec.type,
      bundleId: this.opts.bundleId ?? this.opts.spec.id,
      bundleVersion: enumeration.commitSha,
      installed: false
    };
  }

  public async readManifest(_ref: BundleRef): Promise<BundleManifest> {
    const enumeration = await this.ensureEnumeration();
    return {
      id: this.opts.bundleId ?? this.opts.spec.id,
      version: enumeration.commitSha,
      name: this.opts.spec.name,
      description: `Harvested from ${this.opts.spec.url}@${this.opts.spec.branch}`,
      tags: [this.opts.spec.type],
      items: enumeration.candidates.map((c) => ({
        path: c.path,
        kind: pathKindHint(c.path)
      }))
    };
  }

  public async readFile(_ref: BundleRef, relPath: string): Promise<string> {
    const enumeration = await this.ensureEnumeration();
    const entry = enumeration.candidates.find((c) => c.path === relPath);
    if (!entry) {
      if (!isPrimitiveCandidatePath(relPath)) {
        throw new Error(`not a primitive candidate: ${relPath}`);
      }
      throw new Error(`not found in repo tree: ${relPath}`);
    }
    const bytes = await this.opts.blobs.fetch({
      owner: this.opts.spec.owner,
      repo: this.opts.spec.repo,
      sha: entry.blobSha
    });
    return bytes.toString('utf8');
  }

  /**
   * Commit sha resolved on first call — cached for subsequent readFile /
   * readManifest calls within the same harvester pass. The harvester
   * creates a fresh provider per bundle pass so there is no staleness
   * concern across runs.
   */
  public async getCommitSha(): Promise<string> {
    return (await this.ensureEnumeration()).commitSha;
  }

  private async ensureEnumeration(): Promise<EnumerateResult> {
    if (!this.enumeration) {
      this.enumeration = await enumerateRepoTree(this.opts.client, {
        owner: this.opts.spec.owner,
        repo: this.opts.spec.repo,
        ref: this.opts.spec.branch,
        pathPrefix: this.opts.pathPrefix
      });
    }
    return this.enumeration;
  }
}

function pathKindHint(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith('.prompt.md')) {
    return 'prompt';
  }
  if (lower.endsWith('.instructions.md')) {
    return 'instruction';
  }
  if (lower.endsWith('.chatmode.md')) {
    return 'chat-mode';
  }
  if (lower.endsWith('.agent.md')) {
    return 'agent';
  }
  if (/(^|\/)skill\.md$/.test(lower)) {
    return 'skill';
  }
  if (/mcp\.json$/.test(lower)) {
    return 'mcp-server';
  }
  return 'unknown';
}
