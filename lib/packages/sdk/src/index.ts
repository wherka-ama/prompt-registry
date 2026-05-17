/**
 * @prompt-registry/sdk
 * 
 * SDK workspace for Prompt Registry - provides domain types, ports, and public API
 * for programmatic consumption without CLI infrastructure.
 * 
 * Re-exports from legacy @prompt-registry/collection-scripts package.
 */

// Re-export from legacy package
export * from '@prompt-registry/collection-scripts/public';
export * as domain from '@prompt-registry/collection-scripts/domain';
export * as ports from '@prompt-registry/collection-scripts/ports';
