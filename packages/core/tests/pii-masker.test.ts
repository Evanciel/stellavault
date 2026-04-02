import { describe, it, expect } from 'vitest';
import { maskPII } from '../src/pack/pii-masker.js';

describe('PII Masker', () => {
  it('이메일 마스킹', () => {
    const { masked, redactedCount } = maskPII('Contact user@example.com for help');
    expect(masked).not.toContain('user@example.com');
    expect(masked).toContain('[REDACTED:email]');
    expect(redactedCount).toBe(1);
  });

  it('API 키 마스킹', () => {
    const { masked } = maskPII('Use sk_live_1234567890abcdefghij for auth');
    expect(masked).toContain('[REDACTED:api_key]');
  });

  it('AWS 키 마스킹', () => {
    const { masked } = maskPII('AWS key: AKIAIOSFODNN7EXAMPLE');
    expect(masked).toContain('[REDACTED:aws_key]');
  });

  it('JWT 마스킹', () => {
    const { masked } = maskPII('token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
    expect(masked).toContain('[REDACTED:jwt]');
  });

  it('PII 없으면 변경 없음', () => {
    const text = 'React 컴포넌트 패턴에 대한 가이드';
    const { masked, redactedCount } = maskPII(text);
    expect(masked).toBe(text);
    expect(redactedCount).toBe(0);
  });

  it('복수 PII 동시 마스킹', () => {
    const { masked, redactedCount, redactedTypes } = maskPII(
      'admin@test.com has key sk_test_abcdefghijklmnopqrstuvwxyz1234'
    );
    expect(redactedCount).toBeGreaterThanOrEqual(2);
    expect(redactedTypes).toContain('email');
    expect(redactedTypes).toContain('api_key');
  });
});
