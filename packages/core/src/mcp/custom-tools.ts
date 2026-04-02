// Custom MCP Tool Builder (F-A16)
// Load YAML/JSON tool definitions without coding

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SearchEngine } from '../search/index.js';

export interface CustomToolDef {
  name: string;
  description: string;
  query_template: string; // e.g. "{{topic}} best practices"
  output_format?: 'full' | 'titles' | 'snippets';
  limit?: number;
  filter_tags?: string[];
}

export interface LoadedCustomTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

export function loadCustomTools(toolsDir: string, searchEngine: SearchEngine): LoadedCustomTool[] {
  if (!existsSync(toolsDir)) return [];

  const tools: LoadedCustomTool[] = [];
  const files = readdirSync(toolsDir).filter(f => f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const file of files) {
    try {
      const raw = readFileSync(join(toolsDir, file), 'utf-8');
      let def: CustomToolDef;

      if (file.endsWith('.json')) {
        def = JSON.parse(raw);
      } else {
        // Simple YAML parser for basic key:value format
        def = parseSimpleYaml(raw);
      }

      if (!def.name || !def.description || !def.query_template) continue;

      // Extract template variables ({{var}})
      const vars = [...def.query_template.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);

      tools.push({
        name: def.name,
        description: def.description,
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(vars.map(v => [v, { type: 'string', description: `Value for ${v}` }])),
          required: vars,
        },
        handler: async (args) => {
          let query = def.query_template;
          for (const [key, val] of Object.entries(args)) {
            query = query.replace(`{{${key}}}`, String(val));
          }

          const results = await searchEngine.search({ query, limit: def.limit ?? 5 });
          const format = def.output_format ?? 'snippets';

          let text: string;
          if (format === 'titles') {
            text = results.map(r => `- ${r.document.title}`).join('\n');
          } else if (format === 'full') {
            text = results.map(r => `## ${r.document.title}\n\n${r.document.content.slice(0, 1000)}`).join('\n\n---\n\n');
          } else {
            text = results.map(r => `**${r.document.title}** (${Math.round(r.score * 100)}%)\n${r.chunk.content.slice(0, 200)}...`).join('\n\n');
          }

          return { content: [{ type: 'text' as const, text: text || 'No results found.' }] };
        },
      });
    } catch {
      // Skip invalid tool files
    }
  }

  return tools;
}

function parseSimpleYaml(raw: string): CustomToolDef {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return result as unknown as CustomToolDef;
}
