// Plan: codex final review (2026-05-12) ship condition — federation must be
// gated by an explicit experimental opt-in so the local MCP knowledge-server
// beta can ship without exposing federation by default.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isFederationExperimentalEnabled } from '../src/federation/index.js';

const ENV_KEY = 'STELLAVAULT_FEDERATION_EXPERIMENTAL';

let originalValue: string | undefined;

beforeEach(() => {
  originalValue = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (originalValue === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalValue;
});

describe('isFederationExperimentalEnabled', () => {
  it('returns false when the env var is unset', () => {
    expect(isFederationExperimentalEnabled()).toBe(false);
  });

  it('returns false for empty string and obvious falsy strings', () => {
    for (const v of ['', '0', 'false', 'no', 'off', '   ']) {
      process.env[ENV_KEY] = v;
      expect(isFederationExperimentalEnabled()).toBe(false);
    }
  });

  it('returns true for the documented truthy values, case-insensitively', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', '  on  ']) {
      process.env[ENV_KEY] = v;
      expect(isFederationExperimentalEnabled()).toBe(true);
    }
  });

  it('returns false for arbitrary other strings (no fuzzy match)', () => {
    for (const v of ['enable', 'enabled', 'experimental', 'maybe', '2']) {
      process.env[ENV_KEY] = v;
      expect(isFederationExperimentalEnabled()).toBe(false);
    }
  });
});
