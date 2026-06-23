// Preload — exposes typed IPC bridge to renderer via contextBridge.
// CRIT-02: Runtime channel allowlist — TypeScript types are erased at runtime
// and provide zero security. This explicit Set is the actual security boundary.

import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
  'core:get-ready',
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
  'graph:clusters',
  'graph:expand-cluster',
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
  'ai:list-models',       // AI model dropdown — list models for the provider
  // T4: write-only key IPC — renderer can SET/CHECK/CLEAR a key, never READ it back.
  // A compromised renderer must not be able to exfiltrate the plaintext key.
  'ai:set-secret',   // {provider, key} → void  (stores via SecretStore)
  'ai:has-secret',   // provider → boolean       (existence check only)
  'ai:clear-secret', // provider → void          (removes key)
  'vault:import-asset', // [editor-upgrade additive] local image → vault assets/
  // T3-7 Publish (read-only local server) + T3-4 web clipper endpoint
  'publish:start',
  'publish:stop',
  'publish:status',
  // T3-9 multi-vault switcher + cross-vault search
  'vault:list-registry',
  'vault:add-to-registry',
  'vault:pick-folder',          // pick a folder inside the vault (daily/templates settings)
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
  // Second-brain auto-capture (Design §6.4)
  'vault:capture',
  'capture:list',
  'capture:set-paused',
  'capture:counts',
  'capture:pick-files',
  'review:list',
  'review:confirm',
  'review:skip',
  'categories:list',
  // SP1 multiturn chat — renderer to main commands (invoke)
  'chat:send',
  'chat:abort',
  'chat:list-sessions',
  'chat:load-session',
  'chat:rename-session',
  'chat:delete-session',
  // Agent (SP-D): approve/deny a write tool the MAIN model requested (renderer can ONLY
  // approve/deny — it can never name a tool to run).
  'chat:tool-approve',
  // Agent (SP-I): auto-distill a finished conversation into the wiki (Karpathy ingest).
  'chat:distill',
  // Local model server (Ollama) lifecycle — "Start Ollama" affordance
  'ollama:status',
  'ollama:start',
  // Compat check + auto-download (button-prompt)
  'ollama:version',
  'ollama:compat',
  'ollama:download',
]);

const ALLOWED_EVENTS = new Set<string>([
  'core:ready',
  'file:changed',
  'index:progress',
  'settings:changed',
  'window:close-request', // T2-18: main → renderer dirty-close vetting
  'update:status',        // T3-12: auto-update lifecycle
  'mcp:status-changed',   // T3-3: Agent Memory server status / activity feed
  'capture:progress',     // second-brain capture lifecycle
  'capture:done',
  'review:changed',
  // SP1 multiturn chat — main to renderer streaming (e.sender targeted, not broadcast)
  'chat:chunk',
  'chat:done',
  'chat:error',
  // Agent (SP-D): tool-activity transparency + write-approval handshake
  'chat:tool-call',
  'chat:tool-result',
  'chat:tool-confirm',
  // Agent (SP-I): distillation pass finished (summary of what was folded into the wiki)
  'chat:distill-done',
  // Ollama auto-download byte progress (e.sender targeted)
  'ollama:download-progress',
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
  // Electron 35 removed File.path. webUtils.getPathForFile resolves a dropped File
  // to its real absolute path so capture can enqueue the path directly (same fast
  // path the native file picker uses), instead of round-tripping base64 over IPC.
  getPathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  // Capture a dropped file by its REAL path, resolved HERE in the (trusted) preload
  // via webUtils.getPathForFile. Routed through 'capture:dropped-file', which is NOT
  // in ALLOWED_CHANNELS, so a compromised renderer can't enqueue an arbitrary path
  // via invoke() (Codex P1). A memory File (new File()) has no path → rejected → the
  // caller falls back to base64 bytes.
  captureDroppedFile: (file: File, meta: { fileName: string; mime: string }): Promise<{ id: string }> => {
    let filePath = '';
    try { filePath = webUtils.getPathForFile(file); } catch { /* no path */ }
    if (!filePath) return Promise.reject(new Error('no-path'));
    return ipcRenderer.invoke('capture:dropped-file', filePath, meta);
  },
};

contextBridge.exposeInMainWorld('stellavault', api);

export type StellavaultApi = typeof api;
