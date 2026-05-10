/**
 * Phase 5 spillover / Iter 16 — HttpClient + TokenProvider.
 *
 * Interfaces are defined in `../ports/http` and re-exported here for
 * backward compatibility. Concrete implementations (NULL_TOKEN_PROVIDER,
 * envTokenProvider, etc.) remain in this file.
 *
 * Spec/decisions: D14 (resolver = non-VS-Code slice of adapter),
 * D17 (pluggable token provider).
 */
import type {
  TokenProvider,
} from '../ports/http';

export type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  TokenProvider,
} from '../ports/http';

/**
 * Token provider that always returns null (public-only).
 */
export const NULL_TOKEN_PROVIDER: TokenProvider = {
  getToken: (): Promise<string | null> => Promise.resolve(null)
};

/**
 * Predicate: is this hostname a GitHub host (including the API,
 * raw-content, and codeload subdomains).
 * @param host Hostname to test.
 * @returns True when the host belongs to github.com.
 */
const isGitHubHost = (host: string): boolean =>
  host === 'github.com' || host === 'api.github.com'
  || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com');

/**
 * Try to read a GitHub token from the locally-installed `gh` CLI by
 * spawning `gh auth token`. Returns `null` if `gh` is not installed,
 * the user is not logged in, or the call fails for any reason. Never
 * throws.
 * @returns The token, or null.
 */
export const ghCliTokenProvider = (): TokenProvider => ({
  getToken: async (host: string): Promise<string | null> => {
    if (!isGitHubHost(host)) {
      return null;
    }
    try {
      // Lazy import keeps lib startup cheap; child_process is
      // node-builtin so no extra dep.
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('gh', ['auth', 'token'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000
      });
      if (r.status !== 0 || typeof r.stdout !== 'string') {
        return null;
      }
      const tok = r.stdout.trim();
      return tok.length > 0 ? tok : null;
    } catch {
      return null;
    }
  }
});

/**
 * Compose multiple TokenProviders. Returns the first non-null token.
 * @param providers Providers in priority order.
 * @returns Composite TokenProvider.
 */
export const compositeTokenProvider = (
  ...providers: readonly TokenProvider[]
): TokenProvider => ({
  getToken: async (host: string): Promise<string | null> => {
    for (const p of providers) {
      const t = await p.getToken(host);
      if (t !== null && t.length > 0) {
        return t;
      }
    }
    return null;
  }
});

/**
 * Build a TokenProvider that reads the standard env vars used by
 * `gh` and the GitHub Action runner, then falls back to invoking
 * `gh auth token` so that locally-authenticated users do not need
 * to set GITHUB_TOKEN explicitly. Recognized env vars:
 *   GITHUB_TOKEN  GH_TOKEN
 * Extension consumers should construct a richer provider (this lib
 * stays free of `vscode.*` imports per D17).
 * @param env Process env to read from.
 * @returns A TokenProvider for github.com hosts.
 */
export const envTokenProvider = (
  env: Record<string, string | undefined>
): TokenProvider => {
  const fromEnv: TokenProvider = {
    getToken: (host: string): Promise<string | null> => {
      const t = env.GITHUB_TOKEN ?? env.GH_TOKEN ?? null;
      if (t === null || t.length === 0) {
        return Promise.resolve(null);
      }
      if (isGitHubHost(host)) {
        return Promise.resolve(t);
      }
      return Promise.resolve(null);
    }
  };
  // Allow disabling the gh CLI fallback via env (useful in CI where
  // `gh` may be installed but we want to test the unauth path).
  if (env.PROMPT_REGISTRY_DISABLE_GH_CLI === '1') {
    return fromEnv;
  }
  return compositeTokenProvider(fromEnv, ghCliTokenProvider());
};
