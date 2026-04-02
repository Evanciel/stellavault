// Federation Phase 2: Search Credits
// 지식 공유 = 크레딧 획득, 연합 검색 = 크레딧 소모

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CreditAccount {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  transactions: CreditTransaction[];
}

export interface CreditTransaction {
  type: 'earn' | 'spend';
  amount: number;
  reason: string;
  timestamp: string;
}

const CREDITS_FILE = join(homedir(), '.stellavault', 'federation', 'credits.json');
const INITIAL_BALANCE = 100;
const EARN_PER_SEARCH_RESPONSE = 10; // 검색 응답 시 획득
const COST_PER_SEARCH = 1;           // 검색 요청 시 소모

function loadAccount(): CreditAccount {
  if (existsSync(CREDITS_FILE)) {
    return JSON.parse(readFileSync(CREDITS_FILE, 'utf-8'));
  }
  return { balance: INITIAL_BALANCE, totalEarned: 0, totalSpent: 0, transactions: [] };
}

function saveAccount(account: CreditAccount): void {
  mkdirSync(join(homedir(), '.stellavault', 'federation'), { recursive: true });
  // 최근 100개 트랜잭션만 유지
  account.transactions = account.transactions.slice(-100);
  writeFileSync(CREDITS_FILE, JSON.stringify(account, null, 2), 'utf-8');
}

export function getBalance(): number {
  return loadAccount().balance;
}

export function getAccount(): CreditAccount {
  return loadAccount();
}

export function earn(amount: number, reason: string): number {
  const account = loadAccount();
  account.balance += amount;
  account.totalEarned += amount;
  account.transactions.push({ type: 'earn', amount, reason, timestamp: new Date().toISOString() });
  saveAccount(account);
  return account.balance;
}

export function spend(amount: number, reason: string): { success: boolean; balance: number } {
  const account = loadAccount();
  if (account.balance < amount) {
    return { success: false, balance: account.balance };
  }
  account.balance -= amount;
  account.totalSpent += amount;
  account.transactions.push({ type: 'spend', amount, reason, timestamp: new Date().toISOString() });
  saveAccount(account);
  return { success: true, balance: account.balance };
}

export function earnForSearchResponse(peerId: string): number {
  return earn(EARN_PER_SEARCH_RESPONSE, `Search response to ${peerId}`);
}

export function spendForSearch(peerCount: number): { success: boolean; balance: number } {
  return spend(COST_PER_SEARCH * peerCount, `Search across ${peerCount} peers`);
}

export function getRecentTransactions(limit = 20): CreditTransaction[] {
  return loadAccount().transactions.slice(-limit).reverse();
}
