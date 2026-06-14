// Preload — exposes typed IPC bridge to renderer via contextBridge.
// CRIT-02: Runtime channel allowlist — TypeScript types are erased at runtime
// and provide zero security. This explicit Set is the actual security boundary.

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, IpcArgs, IpcResult } from '../shared/ipc-types.js';

const ALLOWED_CHANNELS = new Set<string>([
  'vault:get-path',
  'vault:read-file',
  'vault:write-file',
  'vault:rename',
  'vault:delete',
  'vault:read-tree',
  'vault:create-file',
  'vault:create-folder',
  'vault:list-notes',
  'vault:trash',
  'vault:duplicate',
  'vault:exists',
  'vault:list-files',
  'vault:update-links',
  'core:search',
  'core:get-stats',
  'core:index',
  'core:decay-top',
  'core:draft',
  'search:query',
  'tags:list',
  'core:ask',
  'core:record-access',
  'core:decay-list',
  'core:related',
  'core:gaps',          // T2-6 Coach panel — knowledge gaps
  'core:learning-path', // T2-6 Coach panel — learning path
  'core:synthesize',    // T3-1 Wiki Synthesis panel
  'core:contradictions',// T3-8 contradiction nudges
  'core:duplicates',    // T3-8 duplicate nudges
  'graph:build',
  'backlinks:find',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:zoom',
  'window:close-dialog',  // T2-18: native Save/Discard/Cancel box on dirty close
  'window:confirm-close', // T2-18: renderer → main close decision
  'shell:open-path',
  'shell:open-external',
  'settings:get',
  'settings:set',
  'vault:import-asset', // [editor-upgrade additive] local image → vault assets/
  // T3-7 Publish (read-only local server) + T3-4 web clipper endpoint
  'publish:start',
  'publish:stop',
  'publish:status',
  // T3-9 multi-vault switcher + cross-vault search
  'vault:list-registry',
  'vault:add-to-registry',
  'vault:remove-from-registry',
  'vault:switch',
  'search:all-vaults',
  // T3-12 in-app auto-update
  'app:get-version',
  'update:check',
  // T3-5 decision journal / ADR capture
  'decision:log',
  'decision:list',
  'decision:evolution',
  // T3-6 auto-linker
  'autolink:suggest',
  // T3-3 Agent Memory / embedded MCP server
  'mcp:start',
  'mcp:stop',
  'mcp:status',
]);

const ALLOWED_EVENTS = new Set<string>([
  'core:ready',
  'file:changed',
  'index:progress',
  'settings:changed',
  'window:close-request', // T2-18: main → renderer dirty-close vetting
  'update:status',        // T3-12: auto-update lifecycle
  'mcp:status-changed',   // T3-3: Agent Memory server status / activity feed
]);

const api = {
  invoke: <C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!ALLOWED_EVENTS.has(channel)) {
      console.warn(`[preload] Blocked event channel: ${channel}`);
      return () => {};
    }
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('stellavault', api);

export type StellavaultApi = typeof api;
