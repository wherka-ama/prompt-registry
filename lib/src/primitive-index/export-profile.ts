/**
 * Export a shortlist as a hub profile, plus (when applicable) a suggested
 * curated collection that bundles the loose primitives.
 */

import type {
  Primitive,
  Shortlist,
} from './types';
import type {
  PrimitiveIndex,
} from './index';

export interface HubProfileBundleRef {
  id: string;
  version: string;
  source: string;
  required: boolean;
}

export interface HubProfile {
  id: string;
  name: string;
  description: string;
  icon?: string;
  bundles: HubProfileBundleRef[];
  path?: string[];
}

export interface CollectionItem {
  path: string;
  kind: 'prompt' | 'instruction' | 'chat-mode' | 'agent' | 'skill';
  title?: string;
  description?: string;
  tags?: string[];
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  items: CollectionItem[];
}

export interface ExportProfileOptions {
  profileId: string;
  profileName?: string;
  description?: string;
  icon?: string;
  path?: string[];
  /** If true, also emit a suggested collection YAML when primitives span <3 bundles. */
  suggestCollection?: boolean;
  /** Collection id to suggest (defaults to profileId). */
  collectionId?: string;
}

export interface ProfileExport {
  profile: HubProfile;
  suggestedCollection?: Collection;
  warnings: string[];
}

function kindForCollection(p: Primitive): CollectionItem['kind'] | null {
  if (p.kind === 'mcp-server') {
    return null;
  }
  return p.kind;
}

/**
 * Export a shortlist as a hub profile, plus an optional suggested collection.
 * @param index - Source index (used to resolve primitives).
 * @param shortlist - Shortlist to export.
 * @param opts - Export options (ids, suggestion flags).
 */
export function exportShortlistAsProfile(
  index: PrimitiveIndex,
  shortlist: Shortlist,
  opts: ExportProfileOptions
): ProfileExport {
  const warnings: string[] = [];
  const primitives: Primitive[] = [];
  for (const pid of shortlist.primitiveIds) {
    const p = index.get(pid);
    if (!p) {
      warnings.push(`Primitive ${pid} not found in index (likely removed); skipping`);
      continue;
    }
    primitives.push(p);
  }

  // Group by bundle+source; disambiguate same bundleId across sources.
  const bundleKey = (p: Primitive) => `${p.bundle.sourceId}::${p.bundle.bundleId}`;
  const bundleMap = new Map<string, { sourceId: string; bundleId: string; version: string; members: Primitive[] }>();
  for (const p of primitives) {
    const key = bundleKey(p);
    const existing = bundleMap.get(key);
    if (existing) {
      existing.members.push(p);
      // Keep the *higher* non-'latest' version if multiple appear; otherwise keep 'latest'.
      if (existing.version === 'latest' || p.bundle.bundleVersion !== 'latest') {
        existing.version = p.bundle.bundleVersion || existing.version;
      }
    } else {
      bundleMap.set(key, {
        sourceId: p.bundle.sourceId,
        bundleId: p.bundle.bundleId,
        version: p.bundle.bundleVersion || 'latest',
        members: [p]
      });
    }
  }

  const bundles: HubProfileBundleRef[] = Array.from(bundleMap.values())
    .toSorted((a, b) => {
      if (a.sourceId !== b.sourceId) {
        return a.sourceId.localeCompare(b.sourceId);
      }
      return a.bundleId.localeCompare(b.bundleId);
    })
    .map((b) => ({
      id: b.bundleId,
      version: b.version,
      source: b.sourceId,
      required: true
    }));

  if (bundles.length === 0) {
    warnings.push('Shortlist is empty or all primitives are missing; profile has no bundles.');
  }

  const profile: HubProfile = {
    id: opts.profileId,
    name: opts.profileName ?? shortlist.name,
    description: opts.description ?? shortlist.description ?? `Profile curated from shortlist "${shortlist.name}"`,
    icon: opts.icon,
    bundles,
    path: opts.path
  };

  let suggestedCollection: Collection | undefined;
  if (opts.suggestCollection && primitives.length > 0) {
    const items: CollectionItem[] = [];
    for (const p of primitives) {
      const k = kindForCollection(p);
      if (!k) {
        warnings.push(`Primitive ${p.id} is kind "${p.kind}" and cannot be included in a collection.`);
        continue;
      }
      items.push({
        path: p.path,
        kind: k,
        title: p.title || undefined,
        description: p.description || undefined,
        tags: p.tags.length > 0 ? p.tags : undefined
      });
    }
    suggestedCollection = {
      id: opts.collectionId ?? opts.profileId,
      name: opts.profileName ?? shortlist.name,
      description: opts.description ?? shortlist.description ?? `Curated collection from shortlist "${shortlist.name}"`,
      items
    };
  }

  return { profile, suggestedCollection, warnings };
}
