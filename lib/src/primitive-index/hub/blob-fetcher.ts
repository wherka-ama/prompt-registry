/**
 * BlobFetcher — fetch a git blob by sha, tamper-checked, cache-backed.
 *
 * The harvester hands a list of (owner, repo, sha) tuples to this class
 * and treats it as an opaque "bytes source". The cache deduplicates
 * identical content across repos; the sha check rejects mismatches.
 */

import {
  BlobCache,
} from './blob-cache';
import type {
  GitHubApiClient,
} from './github-api-client';

export interface BlobRef {
  owner: string;
  repo: string;
  sha: string;
}

interface BlobResponse {
  sha: string;
  size: number;
  content: string;
  /** GitHub returns 'base64' or 'utf-8'; treat as free-form string for robustness. */
  encoding: string;
}

export interface BlobFetcherOptions {
  client: GitHubApiClient;
  cache: BlobCache;
}

export class BlobFetcher {
  public constructor(private readonly opts: BlobFetcherOptions) {}

  public async fetch(ref: BlobRef): Promise<Buffer> {
    return this.opts.cache.getOrFetch(ref.sha, async () => {
      const body = await this.opts.client.getJson<BlobResponse>(
        `/repos/${ref.owner}/${ref.repo}/git/blobs/${ref.sha}`
      );
      // eslint-disable-next-line unicorn/text-encoding-identifier-case -- GitHub API returns 'utf-8' verbatim.
      const bytes = body.encoding === 'utf-8'
        ? Buffer.from(body.content, 'utf8')
        : Buffer.from(body.content, 'base64');
      // Cache.put() will re-check the sha; we leave that as the single
      // source of truth for the tamper guard rather than duplicating it.
      return bytes;
    });
  }
}
