import { describe, it, expect } from 'vitest';
import { assertPublicUrl, isPrivateIp } from '../src/api/ssrf-guard.js';

// SSRF 가드: resolve-then-check-IP. DNS rebinding/인코딩/IPv6 우회 방어.
// 도메인/리바인딩 케이스는 주입 resolver로 결정적 테스트.

describe('isPrivateIp (pure)', () => {
  // IPv4 사설/내부 대역
  it('loopback 127/8', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.255.255.255')).toBe(true);
  });
  it('RFC1918 10/8', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
  });
  it('RFC1918 172.16–31', () => {
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    // 경계 밖은 public
    expect(isPrivateIp('172.15.0.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });
  it('RFC1918 192.168/16', () => {
    expect(isPrivateIp('192.168.0.1')).toBe(true);
    expect(isPrivateIp('192.168.255.255')).toBe(true);
  });
  it('link-local 169.254/16 (cloud metadata 포함)', () => {
    expect(isPrivateIp('169.254.0.1')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true); // AWS/GCP metadata
  });
  it('unspecified 0.0.0.0 / 0/8', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true);
  });
  it('public IPv4는 false', () => {
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('93.184.216.34')).toBe(false); // example.com
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  // IPv6
  it('IPv6 loopback ::1', () => {
    expect(isPrivateIp('::1')).toBe(true);
  });
  it('IPv6 unspecified ::', () => {
    expect(isPrivateIp('::')).toBe(true);
  });
  it('IPv6 link-local fe80::/10', () => {
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('febf::1')).toBe(true);
  });
  it('IPv6 ULA fc00::/7', () => {
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fd00::1')).toBe(true);
  });
  it('IPv4-mapped IPv6 → v4 검사로 위임', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true); // 127.0.0.1 hex form
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:93.184.216.34')).toBe(false); // mapped public
  });
  it('public IPv6는 false', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false); // cloudflare
  });
});

describe('assertPublicUrl', () => {
  // 항상 사설 IP를 반환하는 악성 resolver (DNS rebinding 시뮬레이션)
  const rebindResolver = async () => ['10.0.0.5'];
  // 항상 public IP를 반환하는 정상 resolver
  const publicResolver = async () => ['93.184.216.34'];

  it('ACCEPT: https://example.com (public resolver)', async () => {
    await expect(assertPublicUrl('https://example.com', publicResolver)).resolves.toBeUndefined();
  });

  // IP 리터럴은 DNS 불필요 — URL canonicalize로 잡힘
  it('REJECT: http://localhost', async () => {
    await expect(assertPublicUrl('http://localhost', publicResolver)).rejects.toThrow();
  });
  // 후행 점 우회 차단 — publicResolver를 써서 "이름 denylist"가 거부 원인임을 증명
  // (IP 검사가 아니라 special-name 검사가 막아야 함).
  it('REJECT: http://localhost. (후행 점 우회)', async () => {
    await expect(assertPublicUrl('http://localhost.', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://foo.local. (후행 점 우회)', async () => {
    await expect(assertPublicUrl('http://foo.local.', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://127.0.0.1', async () => {
    await expect(assertPublicUrl('http://127.0.0.1', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://127.0.0.1.nip.io (DNS rebinding → 사설 IP)', async () => {
    // resolver가 사설 IP 반환 → 호스트명만으론 안전해 보여도 차단되어야 함
    await expect(assertPublicUrl('http://127.0.0.1.nip.io', rebindResolver)).rejects.toThrow();
  });
  it('REJECT: http://0x7f.0.0.1 (hex 인코딩)', async () => {
    await expect(assertPublicUrl('http://0x7f.0.0.1', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://2130706433 (decimal 인코딩)', async () => {
    await expect(assertPublicUrl('http://2130706433', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://[::1] (IPv6 loopback)', async () => {
    await expect(assertPublicUrl('http://[::1]', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://[::ffff:127.0.0.1] (IPv4-mapped IPv6)', async () => {
    await expect(assertPublicUrl('http://[::ffff:127.0.0.1]', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://169.254.169.254 (cloud metadata)', async () => {
    await expect(assertPublicUrl('http://169.254.169.254', publicResolver)).rejects.toThrow();
  });
  it('REJECT: http://10.0.0.1 (RFC1918)', async () => {
    await expect(assertPublicUrl('http://10.0.0.1', publicResolver)).rejects.toThrow();
  });
  it('REJECT: ftp://x (non-http)', async () => {
    await expect(assertPublicUrl('ftp://x', publicResolver)).rejects.toThrow();
  });

  // fail-closed: resolver가 0개 주소 반환 시 차단
  it('REJECT: domain이 0개 주소로 resolve되면 fail-closed', async () => {
    const emptyResolver = async () => [];
    await expect(assertPublicUrl('https://example.com', emptyResolver)).rejects.toThrow();
  });

  // 여러 주소 중 하나라도 사설이면 차단
  it('REJECT: resolve된 주소 중 하나라도 사설이면 차단', async () => {
    const mixedResolver = async () => ['93.184.216.34', '10.0.0.1'];
    await expect(assertPublicUrl('https://example.com', mixedResolver)).rejects.toThrow();
  });

  // 에러 메시지는 generic — resolve된 IP를 노출하지 않음
  it('에러 메시지에 resolve된 사설 IP를 노출하지 않음', async () => {
    await expect(assertPublicUrl('https://example.com', rebindResolver)).rejects.toThrow(
      /not allowed/i,
    );
    try {
      await assertPublicUrl('https://example.com', rebindResolver);
    } catch (e) {
      expect((e as Error).message).not.toContain('10.0.0.5');
    }
  });
});
