// Plugin SDK (F-A15) — Event-driven plugin system

export interface PluginContext {
  store: {
    search(query: string, limit?: number): Promise<any[]>;
    getDocument(id: string): Promise<any>;
    getStats(): Promise<any>;
  };
  config: Record<string, unknown>;
  log: (message: string) => void;
}

export type PluginEvent =
  | 'onIndex'       // After a document is indexed
  | 'onSearch'      // After a search is performed
  | 'onDecay'       // When decay check runs
  | 'onGapDetected' // When a knowledge gap is found
  | 'onStartup'     // When stellavault starts
  | 'onShutdown';   // When stellavault stops

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  events: PluginEvent[];
}

export interface StellavaultPlugin {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;
  onEvent?(event: PluginEvent, data: unknown): Promise<void>;
}

type EventHandler = (data: unknown) => Promise<void>;

export class PluginManager {
  private plugins = new Map<string, StellavaultPlugin>();
  private handlers = new Map<PluginEvent, Array<{ pluginName: string; handler: EventHandler }>>();
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  async register(plugin: StellavaultPlugin): Promise<void> {
    if (this.plugins.has(plugin.manifest.name)) {
      throw new Error(`Plugin "${plugin.manifest.name}" is already registered`);
    }

    this.plugins.set(plugin.manifest.name, plugin);

    // Register event handlers (MED fix: track by plugin name for proper unregister)
    for (const event of plugin.manifest.events) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      if (plugin.onEvent) {
        this.handlers.get(event)!.push({
          pluginName: plugin.manifest.name,
          handler: (data) => plugin.onEvent!(event, data),
        });
      }
    }

    await plugin.activate(this.context);
    this.context.log(`Plugin "${plugin.manifest.name}" v${plugin.manifest.version} activated`);
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    await plugin.deactivate?.();
    this.plugins.delete(name);

    // MED fix: properly remove handlers by plugin name
    for (const [event, entries] of this.handlers) {
      this.handlers.set(event, entries.filter(e => e.pluginName !== name));
    }
  }

  async emit(event: PluginEvent, data: unknown): Promise<void> {
    const entries = this.handlers.get(event) ?? [];
    for (const { handler } of entries) {
      try {
        await handler(data);
      } catch (err) {
        this.context.log(`Plugin error on ${event}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  listPlugins(): PluginManifest[] {
    return [...this.plugins.values()].map(p => p.manifest);
  }

  getPlugin(name: string): StellavaultPlugin | undefined {
    return this.plugins.get(name);
  }
}
