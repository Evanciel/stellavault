// Team Vault (F-A06) — Bearer 토큰 인증 + RBAC
// MCP Streamable HTTP에 인증 레이어 추가

import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type TeamRole = 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  token: string;        // Bearer token (SHA256 hash stored)
  tokenHash: string;    // stored version
  displayName: string;
  role: TeamRole;
  createdAt: string;
  lastAccess?: string;
}

export interface TeamConfig {
  teamName: string;
  members: TeamMember[];
}

const TEAM_DIR = join(homedir(), '.stellavault', 'team');
const TEAM_FILE = join(TEAM_DIR, 'team.json');

export function loadTeamConfig(): TeamConfig {
  if (existsSync(TEAM_FILE)) {
    return JSON.parse(readFileSync(TEAM_FILE, 'utf-8'));
  }
  return { teamName: 'My Team', members: [] };
}

function saveTeamConfig(config: TeamConfig): void {
  mkdirSync(TEAM_DIR, { recursive: true });
  writeFileSync(TEAM_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// 토큰 생성
export function generateToken(): string {
  return `sv_${randomBytes(24).toString('hex')}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// 멤버 초대 → 토큰 반환
export function inviteMember(displayName: string, role: TeamRole = 'viewer'): { token: string; member: TeamMember } {
  const config = loadTeamConfig();
  const token = generateToken();
  const member: TeamMember = {
    token: '', // 클리어 토큰은 저장 안 함
    tokenHash: hashToken(token),
    displayName,
    role,
    createdAt: new Date().toISOString(),
  };
  config.members.push(member);
  saveTeamConfig(config);
  return { token, member }; // 토큰은 이때만 보여줌
}

// 토큰으로 멤버 인증
export function authenticateMember(token: string): TeamMember | null {
  const config = loadTeamConfig();
  const hash = hashToken(token);
  const member = config.members.find(m => m.tokenHash === hash);
  if (member) {
    member.lastAccess = new Date().toISOString();
    saveTeamConfig(config);
  }
  return member ?? null;
}

// RBAC 권한 확인
export function hasPermission(member: TeamMember, action: 'read' | 'write' | 'admin'): boolean {
  switch (action) {
    case 'read': return true; // 모든 역할 읽기 가능
    case 'write': return member.role === 'admin' || member.role === 'editor';
    case 'admin': return member.role === 'admin';
  }
}

// 멤버 목록
export function listMembers(): TeamMember[] {
  return loadTeamConfig().members;
}

// 멤버 제거
export function removeMember(displayName: string): boolean {
  const config = loadTeamConfig();
  const before = config.members.length;
  config.members = config.members.filter(m => m.displayName !== displayName);
  if (config.members.length < before) {
    saveTeamConfig(config);
    return true;
  }
  return false;
}

// Express 미들웨어: Bearer 토큰 인증
export function createAuthMiddleware() {
  return (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      // 인증 없으면 로컬 접근 (localhost만 허용)
      const ip = req.ip || req.connection?.remoteAddress;
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        req.teamMember = { displayName: 'local', role: 'admin' } as TeamMember;
        return next();
      }
      return res.status(401).json({ error: 'Bearer token required' });
    }

    const token = authHeader.slice(7);
    const member = authenticateMember(token);
    if (!member) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    req.teamMember = member;
    next();
  };
}
