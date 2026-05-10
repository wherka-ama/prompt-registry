/**
 * Phase 3 / Domain Layer — Main barrel.
 *
 * The domain layer contains core data shapes (bundle, primitive, hub) that
 * feature layers (indexing, search, validation, publishing, install) depend on.
 * These types have no feature-layer dependencies.
 * @module domain
 */

export type {
  BundleRef,
  BundleManifest,
  HarvestedFile,
  BundleProvider,
} from './bundle';

export { PRIMITIVE_KINDS } from './primitive';
export type { PrimitiveKind, Primitive } from './primitive';

export type {
  HubSourceSpec,
  PluginItem,
  PluginItemKind,
  PluginManifest,
} from './hub';

// Phase 5 / Iter 1: install-related domain types (Target tagged union).
export type {
  Target,
  TargetType,
  TargetCommon,
  VsCodeTarget,
  CopilotCliTarget,
  KiroTarget,
  WindsurfTarget,
} from './install';
export { TARGET_TYPES, isTarget } from './install';
export type { BundleSpec, Installable } from './install';

// Phase 6 / Iter 11-14: registry-config domain (hubs, sources, profiles).
export type {
  HubReference,
  HubMetadata,
  RegistryConfiguration,
  HubConfig,
} from './registry';
export { DEFAULT_LOCAL_HUB_ID, sanitizeHubId, isHubReference, isHubConfig } from './registry';
export type {
  RegistrySource,
  RegistrySourceType,
} from './registry';
export { isRegistrySource } from './registry';
export type {
  Profile,
  ProfileBundle,
  ProfileActivationState,
} from './registry';
export { isProfile, isProfileBundle } from './registry';
