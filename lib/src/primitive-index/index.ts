/**
 * PrimitiveIndex — public API that composes harvester + tokenizer + BM25
 * + facet maps + persistence + shortlists + profile export.
 *
 * Deterministic by default (BM25 + facets); hybrid ranking only activates
 * when a queryEmbedding is provided and records carry embeddings.
 */

import * as crypto from 'node:crypto';
import {
  Bm25Engine,
  type FieldTokens,
} from './bm25';
import {
  harvest,
} from './harvester';
import {
  tokenize,
} from './tokenizer';
import {
  HYBRID_ALPHA,
} from './tuning';
import type {
  BuildOptions,
  BundleProvider,
  IndexStats,
  MatchExplanation,
  Primitive,
  RefreshOptions,
  RefreshReport,
  SearchHit,
  SearchQuery,
  SearchResult,
  Shortlist,
} from './types';
import {
  PRIMITIVE_KINDS,
} from './types';

interface InternalRecord {
  primitive: Primitive;
  fields: FieldTokens;
  embedding?: Float32Array;
}

function tokenizeFields(p: Primitive): FieldTokens {
  return {
    title: tokenize(p.title),
    tags: tokenize(p.tags.join(' ')),
    description: tokenize(p.description),
    bodyPreview: tokenize(p.bodyPreview)
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [i, element] of a.entries()) {
    dot += element * b[i];
    na += element * element;
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export class PrimitiveIndex {
  private records: InternalRecord[] = [];
  private byId = new Map<string, number>(); // primitiveId → records idx
  private bm25!: Bm25Engine;
  private facets!: {
    kind: Map<string, Set<number>>;
    source: Map<string, Set<number>>;
    bundle: Map<string, Set<number>>;
    tag: Map<string, Set<number>>;
    installed: Set<number>;
  };

  private readonly shortlists = new Map<string, Shortlist>();
  private meta: {
    schemaVersion: number;
    builtAt: string;
    hubId?: string;
    embeddingsMeta?: { provider: string; dim: number };
  } = { schemaVersion: 1, builtAt: new Date(0).toISOString() };

  public static async buildFrom(
    provider: BundleProvider,
    opts: BuildOptions = {}
  ): Promise<PrimitiveIndex> {
    const idx = new PrimitiveIndex();
    const primitives = await harvest(provider, {
      maxFilesPerBundle: opts.maxFilesPerBundle
    });
    await idx.reset(primitives, opts);
    return idx;
  }

  public static fromPrimitives(
    primitives: Primitive[],
    opts: BuildOptions = {}
  ): PrimitiveIndex {
    const idx = new PrimitiveIndex();
    // Ignore embeddings here (reset is async only because of providers).
    void idx.reset(primitives, opts);
    return idx;
  }

  private async reset(primitives: Primitive[], opts: BuildOptions): Promise<void> {
    // Deduplicate by primitiveId; later wins.
    const byId = new Map<string, Primitive>();
    for (const p of primitives) {
      byId.set(p.id, p);
    }
    this.records = Array.from(byId.values()).map((primitive) => ({
      primitive,
      fields: tokenizeFields(primitive)
    }));
    this.byId = new Map(this.records.map((r, i) => [r.primitive.id, i]));
    this.rebuildBm25();
    this.rebuildFacets();
    this.meta = {
      ...this.meta,
      schemaVersion: 1,
      builtAt: new Date().toISOString(),
      hubId: opts.hubId ?? this.meta.hubId
    };
    if (opts.embeddings) {
      const texts = this.records.map((r) =>
        `${r.primitive.title}\n${r.primitive.description}\n${r.primitive.tags.join(' ')}\n${r.primitive.bodyPreview}`
      );
      const vectors = await opts.embeddings.embed(texts);
      vectors.forEach((v, i) => {
        this.records[i].embedding = v;
      });
      this.meta.embeddingsMeta = {
        provider: (opts.embeddings as unknown as { name?: string }).name ?? 'custom',
        dim: opts.embeddings.dim
      };
    }
  }

  private rebuildBm25(): void {
    this.bm25 = new Bm25Engine(
      this.records.map((r) => ({ id: r.primitive.id, fields: r.fields }))
    );
  }

  private rebuildFacets(): void {
    const kind = new Map<string, Set<number>>();
    const source = new Map<string, Set<number>>();
    const bundle = new Map<string, Set<number>>();
    const tag = new Map<string, Set<number>>();
    const installed = new Set<number>();
    for (let i = 0; i < this.records.length; i++) {
      const p = this.records[i].primitive;
      addTo(kind, p.kind, i);
      addTo(source, p.bundle.sourceId, i);
      addTo(bundle, p.bundle.bundleId, i);
      for (const t of p.tags) {
        addTo(tag, t.toLowerCase(), i);
      }
      if (p.bundle.installed) {
        installed.add(i);
      }
    }
    this.facets = { kind, source, bundle, tag, installed };
  }

  private filter(query: SearchQuery): Set<number> {
    const all = new Set<number>();
    for (let i = 0; i < this.records.length; i++) {
      all.add(i);
    }
    let candidates = all;
    const intersect = (map: Map<string, Set<number>>, keys: string[] | undefined, lower = false): void => {
      if (!keys || keys.length === 0) {
        return;
      }
      // Union of selected keys within the same facet.
      const union = new Set<number>();
      for (const raw of keys) {
        const key = lower ? raw.toLowerCase() : raw;
        const bucket = map.get(key);
        if (bucket) {
          for (const v of bucket) {
            union.add(v);
          }
        }
      }
      candidates = intersectSets(candidates, union);
    };
    intersect(this.facets.kind, query.kinds);
    intersect(this.facets.source, query.sources);
    intersect(this.facets.bundle, query.bundles);
    intersect(this.facets.tag, query.tags, true);
    if (query.installedOnly) {
      candidates = intersectSets(candidates, this.facets.installed);
    }
    return candidates;
  }

  private rank(query: SearchQuery, candidates: Set<number>): Omit<SearchResult, 'facets' | 'tookMs'> {
    const qTokens = query.q ? tokenize(query.q) : [];
    const { scores, explanations } = this.bm25.score(qTokens, candidates, !!query.explain);

    // Populate zero-score entries for candidates when q is empty so that pure
    // facet queries still return the candidate set sorted by tie-breakers.
    if (qTokens.length === 0) {
      for (const idx of candidates) {
        if (!scores.has(idx)) {
          scores.set(idx, 0);
        }
      }
    }

    // Normalise BM25 for hybrid blending.
    let maxScore = 0;
    for (const s of scores.values()) {
      if (s > maxScore) {
        maxScore = s;
      }
    }

    const useHybrid = (query.ranking === 'hybrid') && !!query.queryEmbedding;
    const alpha = useHybrid ? HYBRID_ALPHA : 1;

    const hits: SearchHit[] = [];
    for (const [idx, raw] of scores) {
      const bm25Norm = maxScore > 0 ? raw / maxScore : 0;
      let score = alpha * bm25Norm;
      if (useHybrid) {
        const emb = this.records[idx].embedding;
        if (emb && query.queryEmbedding) {
          const cs = cosine(emb, query.queryEmbedding);
          score += (1 - alpha) * cs;
        }
      }
      hits.push({
        primitive: this.records[idx].primitive,
        score,
        matches: explanations?.get(idx)?.map<MatchExplanation>((m) => ({
          field: m.field,
          term: m.term,
          weight: m.weight,
          contribution: m.contribution
        }))
      });
    }

    const sortedHits = hits.toSorted((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const ra = a.primitive.rating ?? 0;
      const rb = b.primitive.rating ?? 0;
      if (rb !== ra) {
        return rb - ra;
      }
      if (a.primitive.bundle.bundleId !== b.primitive.bundle.bundleId) {
        return a.primitive.bundle.bundleId.localeCompare(b.primitive.bundle.bundleId);
      }
      return a.primitive.path.localeCompare(b.primitive.path);
    });

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return {
      total: sortedHits.length,
      hits: sortedHits.slice(offset, offset + limit)
    };
  }

  private facetCounts(candidates: Set<number>): SearchResult['facets'] {
    const kinds: Record<string, number> = {};
    const sources: Record<string, number> = {};
    const tags: Record<string, number> = {};
    for (const idx of candidates) {
      const p = this.records[idx].primitive;
      kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      sources[p.bundle.sourceId] = (sources[p.bundle.sourceId] ?? 0) + 1;
      for (const t of p.tags) {
        tags[t] = (tags[t] ?? 0) + 1;
      }
    }
    return { kinds, sources, tags };
  }

  // --- Queries -----------------------------------------------------------

  public get(primitiveId: string): Primitive | undefined {
    const idx = this.byId.get(primitiveId);
    return idx === undefined ? undefined : this.records[idx].primitive;
  }

  public all(): Primitive[] {
    return this.records.map((r) => r.primitive);
  }

  public stats(): IndexStats {
    const byKind: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const bundles = new Set<string>();
    for (const r of this.records) {
      byKind[r.primitive.kind] = (byKind[r.primitive.kind] ?? 0) + 1;
      bySource[r.primitive.bundle.sourceId] = (bySource[r.primitive.bundle.sourceId] ?? 0) + 1;
      bundles.add(`${r.primitive.bundle.sourceId}::${r.primitive.bundle.bundleId}`);
    }
    return {
      primitives: this.records.length,
      byKind,
      bySource,
      bundles: bundles.size,
      shortlists: this.shortlists.size,
      builtAt: this.meta.builtAt
    };
  }

  public search(query: SearchQuery): SearchResult {
    const t0 = Date.now();
    const filtered = this.filter(query);
    const result = this.rank(query, filtered);
    return {
      ...result,
      facets: this.facetCounts(filtered),
      tookMs: Date.now() - t0
    };
  }

  // --- Shortlists --------------------------------------------------------

  public createShortlist(name: string, description?: string): Shortlist {
    const now = new Date().toISOString();
    const sl: Shortlist = {
      id: randomId('sl'),
      name: name.trim() || 'Untitled',
      description,
      primitiveIds: [],
      createdAt: now,
      updatedAt: now
    };
    this.shortlists.set(sl.id, sl);
    return sl;
  }

  public listShortlists(): Shortlist[] {
    return Array.from(this.shortlists.values()).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  public getShortlist(id: string): Shortlist | undefined {
    return this.shortlists.get(id);
  }

  public deleteShortlist(id: string): boolean {
    return this.shortlists.delete(id);
  }

  public addToShortlist(id: string, primitiveId: string): Shortlist {
    const sl = this.shortlists.get(id);
    if (!sl) {
      throw new Error(`Unknown shortlist: ${id}`);
    }
    if (!this.byId.has(primitiveId)) {
      throw new Error(`Unknown primitive: ${primitiveId}`);
    }
    if (!sl.primitiveIds.includes(primitiveId)) {
      sl.primitiveIds.push(primitiveId);
      sl.updatedAt = new Date().toISOString();
    }
    return sl;
  }

  public removeFromShortlist(id: string, primitiveId: string): Shortlist {
    const sl = this.shortlists.get(id);
    if (!sl) {
      throw new Error(`Unknown shortlist: ${id}`);
    }
    const before = sl.primitiveIds.length;
    sl.primitiveIds = sl.primitiveIds.filter((p) => p !== primitiveId);
    if (sl.primitiveIds.length !== before) {
      sl.updatedAt = new Date().toISOString();
    }
    return sl;
  }

  // --- Refresh -----------------------------------------------------------

  public async refresh(provider: BundleProvider, opts: RefreshOptions = {}): Promise<RefreshReport> {
    const incoming = await harvest(provider, { maxFilesPerBundle: opts.maxFilesPerBundle });
    const nextById = new Map<string, Primitive>();
    for (const p of incoming) {
      nextById.set(p.id, p);
    }

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    let unchanged = 0;

    for (const [id, prim] of nextById) {
      const oldIdx = this.byId.get(id);
      if (oldIdx === undefined) {
        added.push(id);
      } else if (this.records[oldIdx].primitive.contentHash === prim.contentHash) {
        unchanged++;
      } else {
        updated.push(id);
      }
    }
    for (const id of this.byId.keys()) {
      if (!nextById.has(id)) {
        removed.push(id);
      }
    }

    // Drop shortlist entries that reference removed primitives so that
    // exports do not produce dangling refs.
    if (removed.length > 0) {
      const removedSet = new Set(removed);
      for (const sl of this.shortlists.values()) {
        const before = sl.primitiveIds.length;
        sl.primitiveIds = sl.primitiveIds.filter((p) => !removedSet.has(p));
        if (sl.primitiveIds.length !== before) {
          sl.updatedAt = new Date().toISOString();
        }
      }
    }

    await this.reset(Array.from(nextById.values()), opts);
    return { added, updated, removed, unchanged };
  }

  // --- Persistence hooks (used by store.ts) ------------------------------

  public toJSON(): unknown {
    return {
      schemaVersion: this.meta.schemaVersion,
      builtAt: this.meta.builtAt,
      hubId: this.meta.hubId,
      embeddingsMeta: this.meta.embeddingsMeta ?? null,
      primitives: this.records.map((r) => ({
        ...r.primitive,
        embedding: r.embedding ? Array.from(r.embedding) : undefined
      })),
      shortlists: Array.from(this.shortlists.values())
    };
  }

  public static fromJSON(raw: unknown): PrimitiveIndex {
    const idx = new PrimitiveIndex();
    const data = raw as {
      schemaVersion: number;
      builtAt?: string;
      hubId?: string;
      embeddingsMeta?: { provider: string; dim: number } | null;
      primitives: (Primitive & { embedding?: number[] })[];
      shortlists?: Shortlist[];
    };
    if (!data || data.schemaVersion !== 1) {
      throw new Error(`Unsupported primitive-index schemaVersion: ${String(data?.schemaVersion)}`);
    }
    const primitives = data.primitives.map((p) => {
      // Runtime validation: kind must be recognised.
      if (!PRIMITIVE_KINDS.includes(p.kind)) {
        throw new Error(`Invalid kind "${p.kind}" for primitive ${p.id}`);
      }
      return p;
    });
    idx.records = primitives.map((p) => ({
      primitive: {
        id: p.id,
        bundle: p.bundle,
        kind: p.kind,
        path: p.path,
        title: p.title,
        description: p.description,
        tags: p.tags,
        authors: p.authors,
        applyTo: p.applyTo,
        tools: p.tools,
        model: p.model,
        bodyPreview: p.bodyPreview,
        contentHash: p.contentHash,
        rating: p.rating,
        updatedAt: p.updatedAt
      },
      fields: tokenizeFields(p),
      embedding: p.embedding ? new Float32Array(p.embedding) : undefined
    }));
    idx.byId = new Map(idx.records.map((r, i) => [r.primitive.id, i]));
    idx.rebuildBm25();
    idx.rebuildFacets();
    idx.meta = {
      schemaVersion: 1,
      builtAt: data.builtAt ?? new Date(0).toISOString(),
      hubId: data.hubId,
      embeddingsMeta: data.embeddingsMeta ?? undefined
    };
    for (const sl of data.shortlists ?? []) {
      idx.shortlists.set(sl.id, { ...sl });
    }
    return idx;
  }
}

function addTo(map: Map<string, Set<number>>, key: string, idx: number): void {
  const s = map.get(key);
  if (s) {
    s.add(idx);
  } else {
    map.set(key, new Set([idx]));
  }
}

function intersectSets(a: Set<number>, b: Set<number>): Set<number> {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<number>();
  for (const v of small) {
    if (big.has(v)) {
      out.add(v);
    }
  }
  return out;
}

// Re-exports so consumers can `import from './primitive-index'`.

export { SEARCHABLE_FIELDS } from './tuning';
