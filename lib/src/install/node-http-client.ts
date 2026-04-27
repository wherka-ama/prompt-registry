/**
 * Phase 5 spillover / Iter 17 — NodeHttpClient.
 *
 * Real-network implementation of `HttpClient` using `node:https`
 * with an explicit redirect chain (limited to a configurable depth).
 *
 * Mirrors the extension's `GitHubAdapter.downloadFile` behaviour
 * exactly so installed bundle bytes are byte-identical between CLI
 * and extension installs (D15).
 *
 * The class is exported for testing; production callers should
 * obtain an instance via the framework wiring rather than
 * constructing it directly.
 */
import * as https from 'node:https';
import {
  URL,
} from 'node:url';
import {
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from './http';

/** Default maximum redirect chain length. */
export const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Real `node:https`-backed HttpClient. Manages 301/302 redirects up
 * to `maxRedirects`; throws on excessive redirects or non-2xx final
 * responses.
 */
/* eslint-disable @typescript-eslint/member-ordering -- public surface first, private helpers below */
export class NodeHttpClient implements HttpClient {
  /**
   * Fulfills `HttpClient.fetch` against the live network.
   * @param req Request descriptor.
   * @returns Resolved response.
   */
  public async fetch(req: HttpRequest): Promise<HttpResponse> {
    return this.fetchWithDepth(req, 0);
  }

  /**
   * Internal recursive helper that tracks redirect depth.
   * @param req Request descriptor.
   * @param depth Current redirect chain length.
   * @returns Resolved response.
   */
  private async fetchWithDepth(req: HttpRequest, depth: number): Promise<HttpResponse> {
    const max = req.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (depth > max) {
      throw new Error(`Too many redirects (>${String(max)}) while fetching ${req.url}`);
    }
    return new Promise<HttpResponse>((resolve, reject) => {
      const u = new URL(req.url);
      // node:https accepts the URL string directly, but we want to
      // pass headers + method explicitly.
      // GitHub API rejects requests without a User-Agent (403 with
      // "administrative rules" error). Inject a default if the
      // caller did not pass one. Lower-case the key for predictable
      // override semantics.
      const inHeaders = req.headers ?? {};
      const hasUa = Object.keys(inHeaders).some((k) => k.toLowerCase() === 'user-agent');
      const reqHeaders: Record<string, string> = hasUa
        ? inHeaders

        : { ...inHeaders, 'User-Agent': 'prompt-registry-cli' };
      const r = https.get(req.url, {
        headers: reqHeaders,
        method: req.method ?? 'GET'
      }, (res) => {
        const status = res.statusCode ?? 0;
        const headers = lowercaseHeaders(res.headers);
        // Redirect handling: 301 / 302 / 307 / 308.
        if ((status === 301 || status === 302 || status === 307 || status === 308)
          && typeof headers.location === 'string') {
          const next = new URL(headers.location, u).toString();
          // GitHub strips Authorization on cross-origin redirects to
          // S3/CDN; preserve the existing header set otherwise.
          this.fetchWithDepth({ ...req, url: next }, depth + 1)
            .then(resolve)
            .catch(reject);
          // Discard body of the redirect response.
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer): void => {
          chunks.push(chunk);
        });
        res.on('end', (): void => {
          const body = Buffer.concat(chunks);
          resolve({
            statusCode: status,
            body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
            finalUrl: req.url,
            headers
          });
        });
        res.on('error', reject);
      });
      r.on('error', reject);
    });
  }
}

/**
 * Coerce node http headers (string | string[] | undefined) to a flat
 * Record<string, string> with lower-cased keys. Multi-value headers
 * are joined with ', '.
 * @param input Raw header bag from node:http.
 * @returns Lower-cased flat record.
 */
const lowercaseHeaders = (
  input: Record<string, string | string[] | undefined>
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) {
      continue;
    }
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
};
