// Design Ref: §2.3 — Federation Public API

export { FederationNode } from './node.js';
export { FederatedSearch } from './search.js';
export type { FederatedSearchOptions } from './search.js';
export { getOrCreateIdentity } from './identity.js';
export type { NodeIdentity } from './identity.js';
export type { PeerInfo, FederatedSearchResult, FederationMessage } from './types.js';

/**
 * Federation is experimental. The operator must opt in by setting
 * `STELLAVAULT_FEDERATION_EXPERIMENTAL` to a truthy value (`1`, `true`,
 * `yes`, `on`). Otherwise the REST router refuses /join + /leave and
 * the CLI exits early with instructions.
 *
 * The codex final review (2026-05-12) signed off on shipping the local
 * MCP knowledge-server beta on this condition: federation kept behind
 * an explicit experimental, off-by-default toggle.
 */
export function isFederationExperimentalEnabled(): boolean {
  const v = (process.env.STELLAVAULT_FEDERATION_EXPERIMENTAL ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
