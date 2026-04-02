// MCP Tool: federated-search (Federation Phase 1b)
// AI 에이전트가 연합 네트워크를 검색

import type { FederatedSearch } from '../../federation/search.js';

export function createFederatedSearchTool(federatedSearch: FederatedSearch | null) {
  return {
    name: 'federated-search',
    description: 'Search across all connected Federation peers. Returns results from other Stellavault nodes in the P2P network. Only titles, similarity scores, and 50-char snippets are shared — no raw text leaves any node.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results per peer (default: 5)' },
      },
      required: ['query'],
    },
    async handler(args: { query: string; limit?: number }) {
      if (!federatedSearch) {
        return { content: [{ type: 'text' as const, text: 'Federation not active. Run `sv federate join` first.' }] };
      }

      const results = await federatedSearch.search(args.query, { limit: args.limit ?? 5 });

      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No results from federation peers. Either no peers connected or no matching documents.' }] };
      }

      const lines = [
        `🌐 Federation Search: "${args.query}" — ${results.length} results from ${new Set(results.map(r => r.peerId)).size} peers`,
        '',
      ];

      for (const r of results) {
        lines.push(`**${r.title}** (${Math.round(r.similarity * 100)}%) [${r.peerName}]`);
        lines.push(`  ${r.snippet}...`);
        lines.push('');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  };
}
