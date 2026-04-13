// Preload — exposes typed IPC bridge to renderer via contextBridge.
// The renderer accesses this as window.stellavault.invoke('channel', ...args).

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, IpcArgs, IpcResult } from '../shared/ipc-types.js';

const api = {
  invoke: <C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> => {
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('stellavault', api);

// Type declaration for renderer
export type StellavaultApi = typeof api;
