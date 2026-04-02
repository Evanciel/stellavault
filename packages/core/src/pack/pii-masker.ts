// Design Ref: Phase 3 FR-04 — PII 감지 + 마스킹

const PII_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: 'api_key', regex: /(?:sk|pk|api|key|token|secret|password)[_\-a-zA-Z]*[_\-][a-zA-Z0-9]{16,}/gi },
  { name: 'aws_key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'url_with_auth', regex: /https?:\/\/[^:]+:[^@]+@[^\s]+/g },
  { name: 'ip_address', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'phone', regex: /\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g },
  { name: 'jwt', regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
];

export interface MaskResult {
  masked: string;
  redactedCount: number;
  redactedTypes: string[];
}

export function maskPII(text: string): MaskResult {
  let masked = text;
  let redactedCount = 0;
  const redactedTypes = new Set<string>();

  for (const { name, regex } of PII_PATTERNS) {
    const matches = masked.match(regex);
    if (matches) {
      redactedCount += matches.length;
      redactedTypes.add(name);
      masked = masked.replace(regex, `[REDACTED:${name}]`);
    }
  }

  return {
    masked,
    redactedCount,
    redactedTypes: [...redactedTypes],
  };
}
