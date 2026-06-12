// Typed IPC client for the renderer process.
// Usage: const content = await ipc('vault:read-file', '/path/to/note.md');

import type { IpcChannel, IpcArgs, IpcResult, AppSettings } from '../../shared/ipc-types.js';
import type { StellavaultApi } from '../../preload/index.js';

declare global {
  interface Window {
    stellavault: StellavaultApi;
  }
}

export function ipc<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResult<C>> {
  return window.stellavault.invoke(channel, ...args);
}

export function onIpc(channel: string, callback: (...args: unknown[]) => void): () => void {
  return window.stellavault.on(channel, callback);
}

// ─── Settings (W1-1) — typed convenience wrappers ───

export function settingsGet(): Promise<AppSettings> {
  return ipc('settings:get');
}

export function settingsSet(patch: Partial<AppSettings>): Promise<AppSettings> {
  return ipc('settings:set', patch);
}

/** Subscribe to main-process settings broadcasts. Returns unsubscribe. */
export function onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
  return onIpc('settings:changed', (settings) => callback(settings as AppSettings));
}
