// SSRF 가드: resolve-then-check-IP 방식.
// 호스트명만 문자열 매칭하던 기존 방식은 DNS rebinding(공개 도메인이 사설 IP로 해석),
// 인코딩 우회(decimal/hex IPv4), IPv6/IPv4-mapped 우회에 모두 취약했다.
// 여기서는 ① http/https만 허용 ② IP 리터럴이 아니면 DNS로 모든 A/AAAA 주소를 해석
// ③ 각 IP를 정규화해 isPrivateIp 검사 ④ 하나라도 사설이면 차단(fail-closed).
//
// 의존성 없이 순수 함수로 구성해 단위 테스트가 쉽도록 한다(DNS만 주입 resolver 경유).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 도메인 → IP 문자열 배열. 테스트에서 주입 가능. */
export type Resolver = (host: string) => Promise<string[]>;

/** 기본 resolver: dns.lookup(host, { all: true })로 모든 A/AAAA 주소를 수집. */
const defaultResolver: Resolver = async (host) => {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
};

/** IPv4 점-구분 문자열을 32비트 정수로. 형식 불일치면 null. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** IPv4 octet 기반 사설/내부 대역 판정. */
function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  // 0.0.0.0/8 (unspecified), 10/8, 127/8 (loopback)
  if (a === 0 || a === 10 || a === 127) return true;
  // 169.254/16 link-local (cloud metadata 169.254.169.254 포함)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0 ~ 172.31.255.255
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168/16
  if (a === 192 && b === 168) return true;
  // 100.64/10 CGNAT (defense-in-depth)
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** IPv4-mapped IPv6에서 내장 IPv4를 추출(없으면 null). 두 텍스트 형식 모두 처리.
 *  - dotted: ::ffff:127.0.0.1
 *  - hex:    ::ffff:7f00:1  (← new URL이 canonicalize한 형태) */
function extractMappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const idx = lower.lastIndexOf('::ffff:');
  if (idx === -1) return null;
  const tail = lower.slice(idx + '::ffff:'.length);
  // dotted form: 그대로 IPv4
  if (isIP(tail) === 4) return tail;
  // hex form: hhhh:hhhh → 4 octet
  const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.');
  }
  return null;
}

/**
 * 순수 함수: 주어진 IP 문자열이 사설/내부/예약 대역인지 판정.
 * IPv4 {0/8, 10/8, 127/8, 169.254/16, 172.16–31, 192.168/16, 100.64/10}
 * IPv6 {::1, ::, fe80::/10, fc00::/7, ::ffff: 매핑 → v4 위임}
 */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind !== 6) {
    // IP가 아니면(예: 비정상 입력) 안전 측면에서 사설로 간주(fail-closed).
    return true;
  }

  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6 → 내장 v4로 위임
  const mapped = extractMappedIpv4(lower);
  if (mapped !== null) return isPrivateIpv4(mapped);

  // unspecified ::
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  // loopback ::1
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

  // 첫 hextet으로 prefix 판정
  const firstHextet = parseInt(lower.split(':')[0] || '0', 16);
  // fe80::/10 link-local — 상위 10비트 == 0xfe8 >> 2 ... 즉 0xfe80~0xfebf
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true;
  // fc00::/7 ULA — 0xfc00~0xfdff
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true;

  return false;
}

/**
 * 외부로 fetch할 URL이 공개(public) 대상인지 검증. 사설/내부면 throw.
 * ① http/https만 허용 ② IP 리터럴이면 그대로, 도메인이면 resolver로 전체 주소 해석
 * ③ 각 IP 정규화 후 isPrivateIp ④ 하나라도 사설이거나 0개면 throw(fail-closed).
 * 에러 메시지는 generic하게 유지(resolve된 IP를 클라이언트에 노출하지 않음).
 */
export async function assertPublicUrl(url: string, resolver: Resolver = defaultResolver): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Internal or non-public URL not allowed');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs allowed');
  }

  // hostname: IPv6 리터럴은 대괄호 유지 → 제거
  let host = parsed.hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  const lowerHost = host.toLowerCase();

  // 특수 호스트명은 DNS 결과와 무관하게 항상 차단(RFC 6761).
  // localhost는 hosts 파일로 루프백에 매핑되며, .local(mDNS)도 내부 전용.
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost') || lowerHost.endsWith('.local')) {
    throw new Error('Internal or non-public URL not allowed');
  }

  // IP 리터럴이면 DNS 불필요(new URL이 decimal/hex IPv4를 이미 canonicalize함).
  // 도메인이면 모든 A/AAAA 주소를 해석.
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new Error('Internal or non-public URL not allowed');
    }
  }

  // fail-closed: 해석 주소가 없으면 차단
  if (addresses.length === 0) {
    throw new Error('Internal or non-public URL not allowed');
  }

  // 하나라도 사설이면 차단
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error('Internal or non-public URL not allowed');
    }
  }
}
