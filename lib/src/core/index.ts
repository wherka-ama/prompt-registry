/**
 * Phase 3 / Domain Layer — Core barrel.
 *
 * The "core" namespace groups the data shapes that every feature touches:
 *   - `BundleRef`, `BundleManifest`, `HarvestedFile` — a bundle snapshot.
 *   - `BundleProvider` — the adapter contract (any source that can list
 *     bundles and read their files).
 *   - `Primitive`, `PrimitiveKind`, `PRIMITIVE_KINDS` — an agentic primitive
 *     (agent, chat-mode, instruction, mcp-server, prompt, skill).
 *
 * Now imports from the domain layer (Phase 3 extraction).
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
} from '../domain';
