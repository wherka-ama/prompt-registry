/**
 * Extract primitives from a bundle's files + manifest.
 *
 * Heuristics (all deterministic):
 *  - Kind is decided by manifest item hint, then file suffix, then folder name.
 *  - Title/description come from frontmatter, falling back to first H1 and path.
 *  - Tags merge manifest-level tags, per-item tags, and frontmatter tags.
 */

import * as crypto from 'node:crypto';
import * as yaml from 'js-yaml';
import type {
  BundleManifest,
  BundleRef,
  HarvestedFile,
  Primitive,
  PrimitiveKind,
} from './types';

interface Frontmatter {
  [key: string]: unknown;
}

export interface ExtractedFromFile {
  frontmatter: Frontmatter | null;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n*/;

/**
 * Parse the leading YAML frontmatter block from a markdown string.
 * @param content - Raw file contents.
 */
export function parseFrontmatter(content: string): ExtractedFromFile {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  let fm: Frontmatter | null = null;
  try {
    const loaded = yaml.load(match[1]);
    if (loaded && typeof loaded === 'object') {
      fm = loaded as Frontmatter;
    }
  } catch {
    fm = null;
  }
  return { frontmatter: fm, body: content.slice(match[0].length) };
}

/**
 * Infer the primitive kind from a file path suffix.
 * @param relPath - Path relative to the bundle root.
 */
export function detectKindFromPath(relPath: string): PrimitiveKind | null {
  const p = relPath.toLowerCase();
  if (p.endsWith('/skill.md') || p.endsWith('skill.md')) {
    return 'skill';
  }
  if (p.endsWith('.prompt.md')) {
    return 'prompt';
  }
  if (p.endsWith('.instructions.md') || p.endsWith('.instruction.md')) {
    return 'instruction';
  }
  if (p.endsWith('.chatmode.md') || p.endsWith('.chat-mode.md')) {
    return 'chat-mode';
  }
  if (p.endsWith('.agent.md')) {
    return 'agent';
  }
  return null;
}

function normaliseKind(raw: string | undefined | null): PrimitiveKind | null {
  if (!raw) {
    return null;
  }
  const s = String(raw).toLowerCase().trim();
  switch (s) {
    case 'prompt':
    case 'prompts': {
      return 'prompt';
    }
    case 'instruction':
    case 'instructions': {
      return 'instruction';
    }
    case 'chat-mode':
    case 'chatmode':
    case 'chat_mode': {
      return 'chat-mode';
    }
    case 'agent':
    case 'agents': {
      return 'agent';
    }
    case 'skill':
    case 'skills': {
      return 'skill';
    }
    case 'mcp':
    case 'mcp-server': {
      return 'mcp-server';
    }
    default: {
      return null;
    }
  }
}

function firstHeading(body: string): string | null {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function humaniseFromPath(relPath: string): string {
  const leaf = relPath.split('/').pop() ?? relPath;
  return leaf
    .replace(/\.(prompt|instructions?|chatmode|chat-mode|agent)\.md$/i, '')
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || relPath;
}

function uniqueStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') {
      continue;
    }
    const t = v.trim();
    if (!t || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return uniqueStrings(v);
  }
  if (typeof v === 'string' && v.trim()) {
    // Support comma-separated tag strings.
    return uniqueStrings(v.split(/[,;]/));
  }
  return [];
}

/**
 * Compute a stable primitive id from its owning bundle + path.
 * @param sourceId - Source id within the active hub.
 * @param bundleId - Bundle id.
 * @param relPath - Path relative to the bundle root.
 */
export function computePrimitiveId(
  sourceId: string,
  bundleId: string,
  relPath: string
): string {
  return crypto
    .createHash('sha1')
    .update(`${sourceId}|${bundleId}|${relPath}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * SHA-1 hash of a content string, used for staleness detection.
 * @param body - Full file body.
 */
export function hashContent(body: string): string {
  return crypto.createHash('sha1').update(body).digest('hex');
}

/**
 * Build a short, whitespace-normalised preview suitable for BM25 indexing.
 * @param body - Full file body.
 * @param max - Maximum character length of the preview.
 */
export function buildBodyPreview(body: string, max = 400): string {
  // Strip markdown emphasis/links/code fences for a cleaner preview.
  const cleaned = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned;
}

interface ManifestItemHint {
  kind?: PrimitiveKind;
  title?: string;
  description?: string;
  tags?: string[];
}

function buildItemHints(manifest: BundleManifest): Map<string, ManifestItemHint> {
  const hints = new Map<string, ManifestItemHint>();
  const items = manifest.items ?? [];
  for (const item of items) {
    if (!item || typeof item.path !== 'string') {
      continue;
    }
    hints.set(item.path, {
      kind: normaliseKind(item.kind) ?? undefined,
      title: typeof item.title === 'string' ? item.title : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
      tags: Array.isArray(item.tags) ? uniqueStrings(item.tags) : undefined
    });
  }
  return hints;
}

export interface ExtractContext {
  ref: BundleRef;
  manifest: BundleManifest;
}

/**
 * Extract a primitive record from a single harvested file.
 * @param ctx - Bundle context (ref + manifest).
 * @param file - File read from the bundle.
 */
export function extractFromFile(
  ctx: ExtractContext,
  file: HarvestedFile
): Primitive | null {
  const hints = buildItemHints(ctx.manifest);
  const hint = hints.get(file.path) ?? {};

  const kind =
    hint.kind
    ?? detectKindFromPath(file.path)
    ?? (file.path.toLowerCase().includes('/skills/') && file.path.toLowerCase().endsWith('.md')
      ? 'skill'
      : null);
  if (!kind) {
    return null;
  }

  const parsed = parseFrontmatter(file.content);
  const fm = parsed.frontmatter ?? {};

  const title =
    (typeof fm.title === 'string' && fm.title.trim())
    || (typeof fm.name === 'string' && fm.name.trim())
    || hint.title
    || firstHeading(parsed.body)
    || humaniseFromPath(file.path);

  const description =
    (typeof fm.description === 'string' && fm.description.trim())
    || hint.description
    || '';

  const tags = uniqueStrings([
    ...(ctx.manifest.tags ?? []),
    ...(hint.tags ?? []),
    ...asStringArray(fm.tags)
  ]);

  const authorsRaw: unknown[] = [];
  if (typeof fm.author === 'string') {
    authorsRaw.push(fm.author);
  } else if (Array.isArray(fm.authors)) {
    authorsRaw.push(...(fm.authors as unknown[]));
  }
  if (typeof ctx.manifest.author === 'string') {
    authorsRaw.push(ctx.manifest.author);
  }
  const authors = uniqueStrings(authorsRaw);

  const applyTo = typeof fm.applyTo === 'string' ? fm.applyTo : undefined;
  const tools = asStringArray(fm.tools);
  const model = typeof fm.model === 'string' ? fm.model : undefined;

  return {
    id: computePrimitiveId(ctx.ref.sourceId, ctx.ref.bundleId, file.path),
    bundle: ctx.ref,
    kind,
    path: file.path,
    title: title.trim(),
    description: description.trim(),
    tags,
    authors: authors.length > 0 ? authors : undefined,
    applyTo,
    tools: tools.length > 0 ? tools : undefined,
    model,
    bodyPreview: buildBodyPreview(parsed.body),
    contentHash: hashContent(file.content)
  };
}

/**
 * Synthesise MCP-server primitives from the manifest's `mcp.items`.
 * @param ctx - Bundle context (ref + manifest).
 */
export function extractMcpPrimitives(ctx: ExtractContext): Primitive[] {
  const servers = ctx.manifest.mcp?.items;
  if (!servers) {
    return [];
  }
  const out: Primitive[] = [];
  for (const [key, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') {
      continue;
    }
    const synthPath = `mcp/${key}`;
    const parts = [
      cfg.command,
      ...(cfg.args ?? []),
      cfg.url
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    const preview = `MCP server "${key}"${parts.length > 0 ? ': ' + parts.join(' ') : ''}`;
    const description = typeof cfg.description === 'string' ? cfg.description : preview;
    out.push({
      id: computePrimitiveId(ctx.ref.sourceId, ctx.ref.bundleId, synthPath),
      bundle: ctx.ref,
      kind: 'mcp-server',
      path: synthPath,
      title: key,
      description,
      tags: uniqueStrings([...(ctx.manifest.tags ?? []), 'mcp']),
      bodyPreview: preview,
      contentHash: hashContent(JSON.stringify(cfg))
    });
  }
  return out;
}
