// Notification Center (F-A05)
// Configurable alerts for decay thresholds, gap detection, weekly digest

import type { DecayReport } from './types.js';

export interface NotificationConfig {
  decay: {
    enabled: boolean;
    criticalThreshold: number; // R value (0-1), default 0.3
    warningThreshold: number;  // default 0.5
  };
  gaps: {
    enabled: boolean;
    minSeverity: 'low' | 'medium' | 'high'; // default 'medium'
  };
  digest: {
    enabled: boolean;
    frequency: 'daily' | 'weekly' | 'off'; // default 'weekly'
  };
}

export interface Notification {
  id: string;
  type: 'decay_critical' | 'decay_warning' | 'gap_detected' | 'digest';
  title: string;
  message: string;
  timestamp: string;
  priority: 'high' | 'medium' | 'low';
  data?: Record<string, unknown>;
}

const DEFAULT_CONFIG: NotificationConfig = {
  decay: { enabled: true, criticalThreshold: 0.3, warningThreshold: 0.5 },
  gaps: { enabled: true, minSeverity: 'medium' },
  digest: { enabled: true, frequency: 'weekly' },
};

export function checkNotifications(
  decayReport: DecayReport,
  gaps: Array<{ severity: string; clusterA: string; clusterB: string }>,
  config: Partial<NotificationConfig> = {},
): Notification[] {
  const cfg = {
    decay: { ...DEFAULT_CONFIG.decay, ...config.decay },
    gaps: { ...DEFAULT_CONFIG.gaps, ...config.gaps },
    digest: { ...DEFAULT_CONFIG.digest, ...config.digest },
  };
  const notifications: Notification[] = [];
  const now = new Date().toISOString();

  // Decay alerts
  if (cfg.decay.enabled && decayReport.topDecaying) {
    const criticals = decayReport.topDecaying.filter(d => d.retrievability < cfg.decay.criticalThreshold);
    const warnings = decayReport.topDecaying.filter(d =>
      d.retrievability >= cfg.decay.criticalThreshold && d.retrievability < cfg.decay.warningThreshold
    );

    if (criticals.length > 0) {
      notifications.push({
        id: `decay-critical-${Date.now()}`,
        type: 'decay_critical',
        title: `${criticals.length} notes critically fading`,
        message: criticals.slice(0, 3).map(d => `"${d.title}" (${Math.round(d.retrievability * 100)}%)`).join(', '),
        timestamp: now,
        priority: 'high',
        data: { count: criticals.length, notes: criticals.slice(0, 5).map(d => d.title) },
      });
    }

    if (warnings.length > 0) {
      notifications.push({
        id: `decay-warning-${Date.now()}`,
        type: 'decay_warning',
        title: `${warnings.length} notes starting to fade`,
        message: `Average retrievability: ${Math.round(decayReport.averageR * 100)}%`,
        timestamp: now,
        priority: 'medium',
        data: { count: warnings.length },
      });
    }
  }

  // Gap alerts
  if (cfg.gaps.enabled) {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    const minLevel = severityOrder[cfg.gaps.minSeverity] ?? 2;
    const significantGaps = gaps.filter(g => (severityOrder[g.severity as keyof typeof severityOrder] ?? 0) >= minLevel);

    if (significantGaps.length > 0) {
      notifications.push({
        id: `gap-${Date.now()}`,
        type: 'gap_detected',
        title: `${significantGaps.length} knowledge gaps detected`,
        message: significantGaps.slice(0, 2).map(g => `${g.clusterA} ↔ ${g.clusterB}`).join(', '),
        timestamp: now,
        priority: significantGaps.some(g => g.severity === 'high') ? 'high' : 'medium',
        data: { count: significantGaps.length },
      });
    }
  }

  return notifications.sort((a, b) => {
    const p = { high: 3, medium: 2, low: 1 };
    return (p[b.priority] ?? 0) - (p[a.priority] ?? 0);
  });
}
