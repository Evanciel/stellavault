import { Command } from 'commander';
import { indexCommand } from './commands/index-cmd.js';
import { searchCommand } from './commands/search-cmd.js';
import { serveCommand } from './commands/serve-cmd.js';
import { statusCommand } from './commands/status-cmd.js';
import { graphCommand } from './commands/graph-cmd.js';
import { cardCommand } from './commands/card-cmd.js';
import { packCreateCommand, packExportCommand, packImportCommand, packListCommand, packInfoCommand } from './commands/pack-cmd.js';
import { decayCommand } from './commands/decay-cmd.js';
import { syncCommand } from './commands/sync-cmd.js';
import { reviewCommand } from './commands/review-cmd.js';
import { duplicatesCommand } from './commands/duplicates-cmd.js';
import { gapsCommand } from './commands/gaps-cmd.js';
import { clipCommand } from './commands/clip-cmd.js';
import { briefCommand } from './commands/brief-cmd.js';
import { digestCommand } from './commands/digest-cmd.js';
import { initCommand } from './commands/init-cmd.js';
import { learnCommand } from './commands/learn-cmd.js';
import { contradictionsCommand } from './commands/contradictions-cmd.js';
import { federateJoinCommand, federateStatusCommand } from './commands/federate-cmd.js';
import { cloudSyncCommand, cloudRestoreCommand, cloudStatusCommand } from './commands/cloud-cmd.js';
import { vaultAddCommand, vaultListCommand, vaultRemoveCommand, vaultSearchAllCommand } from './commands/vault-cmd.js';
import { captureCommand } from './commands/capture-cmd.js';
import { askCommand } from './commands/ask-cmd.js';
import { compileCommand } from './commands/compile-cmd.js';
import { draftCommand } from './commands/draft-cmd.js';
import { lintCommand } from './commands/lint-cmd.js';
import { fleetingCommand } from './commands/fleeting-cmd.js';
import { ingestCommand, promoteCommand } from './commands/ingest-cmd.js';
import { autopilotCommand } from './commands/autopilot-cmd.js';

const program = new Command();

program
  .name('stellavault')
  .description('Stellavault — Turn your Obsidian vault into a 3D neural knowledge graph')
  .version('0.3.0')
  .option('--json', 'Output in JSON format (for scripting)')
  .option('--quiet', 'Suppress non-essential output');

program
  .command('init')
  .description('Interactive setup wizard — get started in 3 minutes')
  .action(initCommand);

program
  .command('index [vault-path]')
  .description('Obsidian vault를 벡터화하여 인덱싱합니다')
  .action(indexCommand);

program
  .command('search <query>')
  .description('지식 베이스에서 검색합니다')
  .option('-l, --limit <n>', '결과 수', '5')
  .action(searchCommand);

program
  .command('serve')
  .description('MCP 서버를 시작합니다 (Claude Code 연동)')
  .action(serveCommand);

program
  .command('status')
  .description('인덱스 상태를 확인합니다')
  .action(statusCommand);

program
  .command('graph')
  .description('3D Knowledge Graph API 서버를 시작합니다')
  .action(graphCommand);

program
  .command('card')
  .description('SVG 프로필 카드를 생성합니다')
  .option('-o, --output <path>', '출력 파일 경로', 'knowledge-card.svg')
  .action(cardCommand);

program
  .command('learn')
  .description('AI learning path — personalized recommendations based on decay + gaps')
  .action(learnCommand);

program
  .command('contradictions')
  .description('Detect contradicting statements across your notes')
  .action(contradictionsCommand);

program
  .command('decay')
  .description('지식 감쇠 리포트를 출력합니다 (잊어가는 노트 확인)')
  .action(decayCommand);

program
  .command('brief')
  .description('오늘의 지식 브리핑 (감쇠 + 갭 + 활동 요약)')
  .action(briefCommand);

program
  .command('digest')
  .description('주간 지식 활동 리포트')
  .option('-d, --days <n>', '기간 (일)', '7')
  .option('-v, --visual', 'Save as .md with Mermaid charts for Obsidian')
  .action(digestCommand);

program
  .command('clip <url>')
  .description('웹 페이지/YouTube를 Obsidian에 클리핑')
  .option('-f, --folder <path>', 'vault 내 저장 폴더', '06_Research/clips')
  .action(clipCommand);

program
  .command('gaps')
  .description('지식 갭을 탐지합니다 (클러스터 간 연결 부족 영역)')
  .action(gapsCommand);

program
  .command('duplicates')
  .description('중복/유사 노트를 탐지합니다')
  .option('-t, --threshold <n>', '유사도 임계값 (0~1)', '0.88')
  .action(duplicatesCommand);

program
  .command('review')
  .description('일일 지식 리뷰 — 잊어가는 노트를 Obsidian에서 열어 리뷰')
  .option('-n, --count <n>', '리뷰할 노트 수', '5')
  .action(reviewCommand);

program
  .command('sync')
  .description('Notion → Obsidian 동기화')
  .option('--upload', 'PDCA 문서를 Notion에 업로드')
  .option('--watch', '5분 간격 자동 동기화')
  .action(syncCommand);

const federate = program.command('federate').description('Federation — P2P knowledge network');

federate.command('join')
  .description('Join the federation network (interactive mode)')
  .option('-n, --name <name>', 'Display name for this node')
  .action(federateJoinCommand);

federate.command('status')
  .description('Show federation identity and status')
  .action(federateStatusCommand);

program
  .command('capture <audio-file>')
  .description('Voice capture — transcribe audio to knowledge note (requires Whisper)')
  .option('-m, --model <model>', 'Whisper model (tiny/base/small/medium/large)', 'base')
  .option('-l, --language <lang>', 'Language (auto-detect if omitted)')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-f, --folder <folder>', 'Vault subfolder', '01_Knowledge/voice')
  .action(captureCommand);

program
  .command('ask <question>')
  .description('Ask a question about your knowledge base — search, compose answer, optionally save')
  .option('-s, --save', 'Save answer as a new note in your vault')
  .action((question: string, opts: { save?: boolean }) => askCommand(question, opts));

program
  .command('compile')
  .description('Compile raw/ documents into a structured wiki')
  .option('-r, --raw <dir>', 'Raw documents directory (default: raw/)')
  .option('-w, --wiki <dir>', 'Wiki output directory (default: _wiki/)')
  .option('-f, --force', 'Overwrite existing wiki files')
  .action((opts) => compileCommand(opts));

program
  .command('draft [topic]')
  .description('Express: Generate a blog post, report, or outline draft from your knowledge')
  .option('--format <type>', 'Output format: blog, report, outline (default: blog)')
  .action((topic, opts) => draftCommand(topic, opts));

program
  .command('lint')
  .description('Knowledge health check — find gaps, duplicates, contradictions, stale notes')
  .action(() => lintCommand());

program
  .command('fleeting <text>')
  .description('Capture a fleeting idea instantly to raw/ folder')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action((text: string, opts) => fleetingCommand(text, opts));

program
  .command('ingest <input>')
  .description('Ingest any input (URL, file, text) into your knowledge base')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-s, --stage <stage>', 'Note stage: fleeting, literature, permanent', 'fleeting')
  .option('--title <title>', 'Override title')
  .action((input: string, opts) => ingestCommand(input, opts));

program
  .command('promote <file>')
  .description('Promote a note: fleeting → literature → permanent')
  .requiredOption('--to <stage>', 'Target stage: literature or permanent')
  .action((file: string, opts) => promoteCommand(file, opts));

program
  .command('autopilot')
  .description('Run the full knowledge flywheel: inbox → compile → lint')
  .option('--once', 'Run once (default)')
  .action((opts) => autopilotCommand(opts));

const vault = program.command('vault').description('Multi-Vault — manage and search across vaults');
vault.command('add <id> <path>').description('Register a vault').option('-n, --name <name>', 'Display name').option('-s, --shared', 'Allow federation sharing').action(vaultAddCommand);
vault.command('list').description('List registered vaults').action(vaultListCommand);
vault.command('remove <id>').description('Unregister a vault').action(vaultRemoveCommand);
vault.command('search-all <query>').description('Search across all registered vaults').option('-l, --limit <n>', 'Max results', '10').action(vaultSearchAllCommand);

const cloud = program.command('cloud').description('Cloud — E2E encrypted backup');
cloud.command('sync').description('Upload encrypted DB to cloud').action(cloudSyncCommand);
cloud.command('restore').description('Download and decrypt DB from cloud').action(cloudRestoreCommand);
cloud.command('status').description('Show last sync status').action(cloudStatusCommand);

const pack = program.command('pack').description('Knowledge Pack 관리');

pack.command('create <name>')
  .description('검색/클러스터 기반 Knowledge Pack 생성')
  .option('--from-search <query>', '검색 쿼리에서 생성')
  .option('--from-cluster <id>', '클러스터 ID에서 생성')
  .option('--author <name>', '작성자', 'anonymous')
  .option('--license <license>', '라이선스', 'CC-BY-4.0')
  .option('--description <desc>', '설명')
  .option('--limit <n>', '최대 청크 수', '100')
  .action(packCreateCommand);

pack.command('export <name>')
  .description('.sv-pack 파일로 내보내기')
  .option('-o, --output <path>', '출력 경로')
  .action(packExportCommand);

pack.command('import <file>')
  .description('.sv-pack 파일 가져오기 → 벡터 DB 병합')
  .action(packImportCommand);

pack.command('list')
  .description('설치된 팩 목록')
  .action(packListCommand);

pack.command('info <name>')
  .description('팩 상세 정보')
  .action(packInfoCommand);

program.parse();
