// Template substitution (W1-10) — `{{title}}`, `{{date}}`, `{{date:FMT}}`,
// `{{time}}` placeholders, formatted via dayjs. Pure functions, no IPC.

import dayjs from 'dayjs';

export interface TemplateContext {
  /** Note title — replaces {{title}}. */
  title: string;
  /** Reference date for {{date}}/{{date:FMT}}/{{time}}. Defaults to now. */
  date?: Date;
}

const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
const DEFAULT_TIME_FORMAT = 'HH:mm';

/**
 * Apply `{{...}}` placeholders to a template body.
 * Supported: {{title}}, {{date}}, {{date:FMT}} (any dayjs format), {{time}}.
 * Unknown placeholders are left untouched (forward-compatible).
 */
export function applyTemplate(template: string, ctx: TemplateContext): string {
  const d = dayjs(ctx.date ?? new Date());
  return template.replace(/\{\{\s*([a-zA-Z]+)(?::([^}]+))?\s*\}\}/g, (match, name: string, fmt?: string) => {
    switch (name) {
      case 'title':
        return ctx.title;
      case 'date':
        return d.format(fmt?.trim() || DEFAULT_DATE_FORMAT);
      case 'time':
        return d.format(fmt?.trim() || DEFAULT_TIME_FORMAT);
      default:
        return match; // unknown placeholder — leave as-is
    }
  });
}

/** Format a daily-note file name (without extension) for a given date. */
export function formatDailyName(format: string, date: Date): string {
  return dayjs(date).format(format || DEFAULT_DATE_FORMAT);
}
