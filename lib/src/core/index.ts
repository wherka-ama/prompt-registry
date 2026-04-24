/**
 * Generic core types — reusable across CLI subcommands (list, install,
 * uninstall, search, etc.).
 *
 * The "core" namespace groups the data shapes that every feature touches:
 *   - `BundleRef`, `BundleManifest`, `HarvestedFile` — a bundle snapshot.
 *   - `BundleProvider` — the adapter contract (any source that can list
 *     bundles and read their files).
 *   - `Primitive`, `PrimitiveKind`, `PRIMITIVE_KINDS` — an agentic primitive
 *     (agent, chat-mode, instruction, mcp-server, prompt, skill).
 *
 * Module physically re-exports from `primitive-index/types` today; a
 * follow-up PR can move the file once all imports are switched here.
 * @module core
 */

export {
  PRIMITIVE_KINDS,
  type PrimitiveKind,
  type BundleRef,
  type BundleManifest,
  type HarvestedFile,
  type BundleProvider,
  type Primitive,
} from '../primitive-index/types';
