# Primitive Index — extension-UI integration playbook

This note captures the integration points the next sprint will wire
into the VS Code UI (tree view, QuickPick, shortlist, periodic
refresh). It's the concise version of what's inside the
`Primitive Index — session context` memory; keep it in sync with the
shipped code.

## What's already there (no UI work needed)

- **Harvester + index** available via `PrimitiveIndexManager.getInstance(ctx)`.
- `buildFromHub({ hubOwner, hubRepo, hubBranch, hubId, concurrency, force, extraSources, onEvent })`
  returns a `PrimitiveIndex`. Supports plugin sources via `extraSources`
  (iter 24 of sprint 2).
- Persistent index under `<globalStorage>/primitive-index.json`.
- Hub cache under `<globalStorage>/primitive-index-hub/<hubId>/`.
- GitHub token resolution via `resolveGithubToken()` (env → `GH_TOKEN`
  → gh CLI).
- `onEvent` stream yields `source-start / source-skip / source-done /
  source-error` — perfect for `withProgress(...)` messages.

## Integration sequence

```mermaid
sequenceDiagram
  autonumber
  participant UI as QuickPick / TreeView
  participant Cmd as primitive-index-commands
  participant PM as PrimitiveIndexManager
  participant IDX as PrimitiveIndex
  participant Inst as BundleInstaller

  UI->>Cmd: onDidChangeValue(query)
  Cmd->>IDX: index.search({ q, kinds, sources, tags })
  IDX-->>Cmd: SearchResult (p95 &lt; 1ms)
  Cmd-->>UI: hits rendered as QuickPick items

  UI->>Cmd: onDidAccept(hit)
  Cmd->>Cmd: resolveBundle(hit.primitive.bundle)
  Cmd->>Inst: install(bundle, scope='user')
  Inst-->>UI: notification "Installed X"
```

## Specific touch points

### 1. Real-time QuickPick search

Use the microbench numbers (19,410 QPS, 0.038 ms median) as a hard
budget: even with 10 keystrokes/sec you consume **< 1%** of the main
thread. Implementation hint:

```ts
import { PrimitiveIndexManager } from '../services/primitive-index-manager';

const idx = await PrimitiveIndexManager.getInstance(context).load();
const qp = vscode.window.createQuickPick();
qp.onDidChangeValue((value) => {
  const r = idx.search({ q: value, limit: 30 });
  qp.items = r.hits.map((h) => ({
    label: `$(${iconFor(h.primitive.kind)}) ${h.primitive.title}`,
    description: `${h.primitive.bundle.sourceId} / ${h.primitive.bundle.bundleId}`,
    detail: h.primitive.description,
  }));
});
qp.show();
```

### 2. "Install primitive → its bundle" command

Primitives don't install directly; you resolve the parent bundle
(`hit.primitive.bundle`) and delegate to the existing
`BundleInstaller`. Re-use the adapter chain — no new code on the
install path.

```ts
const { bundle } = hit.primitive;
await registryManager.installBundle({
  sourceId: bundle.sourceId,
  bundleId: bundle.bundleId,
  version: bundle.bundleVersion,
  scope: 'user',
});
```

### 3. Shortlist + export

Already implemented end-to-end in the CLI (`shortlist new/add/list` +
`export`). The VS Code commands
`promptregistry.primitiveIndex.shortlist.*` and
`promptregistry.primitiveIndex.export` wrap the same logic. UI work
is cosmetic: a picker that groups current shortlists + an "Add to…"
context action on QuickPick items.

### 4. Periodic refresh

On extension activation, schedule a warm `buildFromHub({ force: false })`
for every configured hub. The conditional `/commits/` logic plus
ETag store makes this a ~1s op per hub with no API budget concern.
Surface the result as a status-bar item:

```
$(database) Primitive Index: 343 primitives · last refresh 12:04
```

### 5. TreeView grouping

Group primitives by `sourceId > bundleId > kind`. Every node exposes:

- `description` = primitive description (first line).
- `tooltip` = full description + `path` + `bundleVersion`.
- `contextValue` = `primitive` (so commands like "Add to shortlist"
  apply), plus `primitive.installed=true` where applicable.

Use `idx.all()` once and cache on tree refresh; no need to re-search.

## Event wiring

| `onEvent` kind | Use in UI |
|---|---|
| `source-start` | Progress message: "Harvesting X..." |
| `source-done` | Increment progress bar |
| `source-skip` | Silent (or "X unchanged") if verbose |
| `source-error` | Push to `Problems` panel; non-fatal |

## Test strategy

- For pure logic (resolving a bundle from a primitive, grouping in
  tree) keep tests under `test/services/` + `test/commands/`.
- Mock `PrimitiveIndexManager` via its `load()` return; don't hit
  GitHub in unit tests.
- Use the pattern-eval gold set as a cross-feature smoke test:
  "after harvest, `search -q 'code review'` contains the review
  skills".

## See also

- [`primitive-index-architecture.md`](primitive-index-architecture.md) — engine-room view.
- [`../user-guide/primitive-index.md`](../user-guide/primitive-index.md) — end-user guide.
- [`primitive-index-reusable-layers.md`](primitive-index-reusable-layers.md) — reusable barrels.
