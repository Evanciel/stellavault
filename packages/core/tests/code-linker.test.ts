// Design Ref: F15 — Code-Knowledge Linker Tests
// Plan SC: SC-03 키워드 추출 정확성

import { describe, it, expect } from 'vitest';
import { extractCodeKeywords } from '../src/intelligence/code-linker.js';

describe('Code-Knowledge Linker', () => {
  describe('extractCodeKeywords', () => {
    it('extracts keywords from file path', () => {
      const keywords = extractCodeKeywords('packages/core/src/auth/middleware.ts');
      expect(keywords).toContain('auth');
      expect(keywords).toContain('middleware');
      expect(keywords).toContain('core');
    });

    it('splits camelCase and kebab-case', () => {
      const keywords = extractCodeKeywords('src/user-profile/ProfileCard.tsx');
      expect(keywords).toContain('user');
      expect(keywords).toContain('profile');
      expect(keywords).toContain('card');
    });

    it('extracts keywords from code content', () => {
      const content = `
import { useState } from 'react';
import { fetchUser } from '../api/user-service';

// TODO: add rate limiting for authentication
export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
}`;
      const keywords = extractCodeKeywords('src/auth.tsx', content);
      expect(keywords).toContain('auth');
      expect(keywords.some(k => k.includes('user'))).toBe(true);
      expect(keywords.some(k => k.includes('rate') || k.includes('limiting') || k.includes('authentication'))).toBe(true);
    });

    it('filters noise words', () => {
      const keywords = extractCodeKeywords('src/components/index.ts');
      expect(keywords).not.toContain('src');
      expect(keywords).not.toContain('index');
    });

    it('handles empty path gracefully', () => {
      const keywords = extractCodeKeywords('');
      expect(keywords).toEqual([]);
    });

    it('extracts import module names', () => {
      const content = `import { something } from 'express-rate-limit';`;
      const keywords = extractCodeKeywords('app.ts', content);
      expect(keywords.some(k => k.includes('express') || k.includes('rate') || k.includes('limit'))).toBe(true);
    });
  });
});
