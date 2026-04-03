// Webhook/Event System (F-A17)
// Emit events on index, decay, gap detection → deliver via HTTP webhook

import type { PluginEvent } from './index.js';

export interface WebhookConfig {
  url: string;
  events: PluginEvent[];
  secret?: string; // HMAC-SHA256 signing key
  retries?: number;
}

export interface WebhookDelivery {
  id: string;
  event: PluginEvent;
  url: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastAttempt?: string;
  response?: { status: number; body: string };
}

export class WebhookManager {
  private configs: WebhookConfig[] = [];
  private deliveries: WebhookDelivery[] = [];

  register(config: WebhookConfig): void {
    // MED: webhook URL 검증
    try {
      const parsed = new URL(config.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')) {
        throw new Error('Internal URLs not allowed for webhooks');
      }
    } catch (e) { throw new Error(`Invalid webhook URL: ${e instanceof Error ? e.message : e}`); }
    this.configs.push(config);
  }

  unregister(url: string): void {
    this.configs = this.configs.filter(c => c.url !== url);
  }

  async emit(event: PluginEvent, data: unknown): Promise<WebhookDelivery[]> {
    const matching = this.configs.filter(c => c.events.includes(event));
    const results: WebhookDelivery[] = [];

    for (const config of matching) {
      const delivery = await this.deliver(config, event, data);
      results.push(delivery);
      this.deliveries.push(delivery);
    }

    // Keep last 100 deliveries
    if (this.deliveries.length > 100) {
      this.deliveries = this.deliveries.slice(-100);
    }

    return results;
  }

  private async deliver(config: WebhookConfig, event: PluginEvent, data: unknown): Promise<WebhookDelivery> {
    const id = `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxRetries = config.retries ?? 3;
    const delivery: WebhookDelivery = { id, event, url: config.url, status: 'pending', attempts: 0 };

    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString(), source: 'stellavault' });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      delivery.attempts = attempt + 1;
      delivery.lastAttempt = new Date().toISOString();

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'stellavault-webhook/1.0' };

        if (config.secret) {
          const { createHmac } = await import('node:crypto');
          const sig = createHmac('sha256', config.secret).update(payload).digest('hex');
          headers['X-Stellavault-Signature'] = `sha256=${sig}`;
        }

        const res = await fetch(config.url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(10000) });
        delivery.response = { status: res.status, body: (await res.text()).slice(0, 500) };

        if (res.ok) {
          delivery.status = 'success';
          return delivery;
        }
      } catch (err) {
        delivery.response = { status: 0, body: err instanceof Error ? err.message : String(err) };
      }

      // Exponential backoff
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }

    delivery.status = 'failed';
    return delivery;
  }

  getRecentDeliveries(limit = 20): WebhookDelivery[] {
    return this.deliveries.slice(-limit).reverse();
  }

  listWebhooks(): WebhookConfig[] {
    return [...this.configs];
  }
}
