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
  'core:search',
  'core:get-stats',
  'core:index',
  'graph:build',
  'backlinks:find',
  'window:minimize',
  'window:maximize',
  'window:close',
]);

const ALLOWED_EVENTS = new Set<string>([
  'core:ready',
  'file:changed',
  'index:progress',
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
