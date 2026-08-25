// DB 를 <열기 전에> 남의 것인지 묻는다. 모든 CLI 명령이 같은 문을 쓴다.
//
// 🔴 왜 한 곳에 모으는가 (코덱스 15차 P1):
//    14차에 이 검사를 `index` 명령에만 넣었다. 그런데 `store.initialize()` 는 여는 것만으로
//    `journal_mode = WAL` · `CREATE TABLE IF NOT EXISTS` · `ALTER TABLE` 을 실행하고,
//    `init`·`pack`·`graph`·`serve` 는 <전부> 소유 판정보다 먼저 그것을 부른다.
//    즉 다섯 문 중 하나만 잠근 셈이었다.
//    ★같은 검사를 다섯 번 손으로 쓰면 여섯 번째가 반드시 빠진다. 그래서 함수로 만든다.
//
// ⚠️ 이것은 <거부 전용>이다. 통과했다고 소유가 확정된 것이 아니다 — 각인의 주인은
//    여전히 core 의 색인기 하나다. 여기서 승인까지 하면 판정이 두 곳이 되고,
//    그러면 어느 쪽이 결정했는지 알 수 없어진다(이 저장소가 CLI 각인을 지운 이유다).

import chalk from 'chalk';
import { resolve } from 'node:path';
import { checkVaultOwnership, peekVaultOwner, VAULT_OWNER_KEY } from '@stellavault/core';

/**
 * 각인이 <확정적으로 다른 볼트>면 그 자리에서 프로세스를 끝낸다.
 *
 * @param command  안내문에 쓸 명령 이름. 무엇을 하다 막혔는지 알아야 한다.
 * @returns 막지 않았으면 그냥 돌아온다(각인 없음·짝 맞음·물어볼 수 없음).
 *
 * 🔴 각인이 <없는> DB 는 통과시킨다. 아니면 새 볼트가 영영 각인을 못 한다 —
 *    각인은 색인이 성공해야 생기는데, 그 색인을 여기서 막으면 순환이다.
 */
export function refuseForeignDbEarly(dbPath: string, vaultPath: string, command: string): void {
  if (!dbPath || !vaultPath) return;   // 물어볼 짝이 없다
  const peeked = peekVaultOwner(dbPath, VAULT_OWNER_KEY);
  if (peeked === undefined || peeked === '') return;

  const ownership = checkVaultOwnership(peeked, resolve(vaultPath));
  if (ownership.kind !== 'mismatch') return;

  console.error(chalk.red(`Error: 이 DB 는 다른 볼트의 것이다 — ${command} 를 DB 에 쓰기 전에 중단한다.`));
  console.error(`  DB       : ${dbPath}`);
  console.error(`  DB 의 볼트: ${ownership.owner}`);
  console.error(`  지금 볼트 : ${ownership.here}`);
  console.error('');
  console.error('  이 볼트를 따로 쓰려면 DB 를 분리하라:');
  console.error(`    STELLAVAULT_DB_PATH=<다른경로.db> stellavault ${command}`);
  process.exit(1);
}
