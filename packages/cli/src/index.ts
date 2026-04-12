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
import { sessionSaveCommand } from './commands/session-cmd.js';
import { flushCommand } from './commands/flush-cmd.js';
import { adrCommand } from './commands/adr-cmd.js';
import { lintCommand } from './commands/lint-cmd.js';
import { fleetingCommand } from './commands/fleeting-cmd.js';
import { ingestCommand, promoteCommand } from './commands/ingest-cmd.js';
import { autopilotCommand } from './commands/autopilot-cmd.js';
import { doctorCommand } from './commands/doctor-cmd.js';

// ─── Node.js version gate ────────────────────────────────────
// Must run before ANY import that touches native modules so the
// user gets a clear message instead of a cryptic SyntaxError.
const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion < 20) {
  console.error(
    `\n  Stellavault requires Node.js 20 or later.\n` +
    `  You are running Node.js ${process.versions.node}.\n\n` +
    `  Download the latest LTS: https://nodejs.org\n`,
  );
  process.exit(1);
}

const program = new Command();

// __SV_VERSION__ is replaced at bundle time by scripts/bundle-cli.mjs (esbuild define).
declare const __SV_VERSION__: string | undefined;
const SV_VERSION = typeof __SV_VERSION__ !== 'undefined' ? __SV_VERSION__ : '0.0.0-dev';

program
  .name('stellavault')
  .description('Stellavault — Self-compiling knowledge base for your Obsidian vault')
  .version(SV_VERSION)
  .option('--json', 'Output in JSON format (for scripting)')
  .option('--quiet', 'Suppress non-essential output');

// ─── Getting started ─────────────────────────────────────────

program
  .command('init')
  .description('Interactive setup wizard — get started in 3 minutes')
  .action(initCommand);

program
  .command('doctor')
  .description('Diagnose setup issues (config, vault, DB, model, Node version)')
  .action(doctorCommand);

program
  .command('index [vault-path]')
  .description('Index your vault (vectorize all documents for search)')
  .action(indexCommand);

program
  .command('status')
  .description('Show index status (document count, last indexed, DB size)')
  .action(statusCommand);

// ─── Core features ───────────────────────────────────────────

program
  .command('search <query>')
  .description('Search your knowledge base (hybrid BM25 + vector)')
  .option('-l, --limit <n>', 'Max results', '5')
  .action(searchCommand);

program
  .command('ask <question>')
  .description('Ask a question — search, compose answer, optionally save')
  .option('-s, --save', 'Save answer as a new note in your vault')
  .option('-q, --quotes', 'Show direct quotes from sources')
  .action((question: string, opts: { save?: boolean; quotes?: boolean }) => askCommand(question, opts));

program
  .command('ingest <input>')
  .description('Ingest any input (URL, file, text, PDF, YouTube) into your vault')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-s, --stage <stage>', 'Note stage: fleeting, literature, permanent', 'fleeting')
  .option('--title <title>', 'Override title')
  .action((input: string, opts) => ingestCommand(input, opts));

program
  .command('clip <url>')
  .description('Clip a web page or YouTube video into your vault')
  .option('-f, --folder <path>', 'Vault subfolder for clips', '06_Research/clips')
  .action(clipCommand);

program
  .command('graph')
  .description('Launch the 3D knowledge graph in your browser')
  .action(graphCommand);

program
  .command('serve')
  .description('Start MCP server (for Claude Code / Claude Desktop)')
  .action(serveCommand);

// ─── Intelligence ────────────────────────────────────────────

program
  .command('decay')
  .description('Memory decay report — find notes you are forgetting')
  .action(decayCommand);

program
  .command('brief')
  .description('Daily knowledge briefing (decay + gaps + activity)')
  .action(briefCommand);

program
  .command('digest')
  .description('Weekly knowledge activity report')
  .option('-d, --days <n>', 'Period in days', '7')
  .option('-v, --visual', 'Save as .md with Mermaid charts for Obsidian')
  .action(digestCommand);

program
  .command('gaps')
  .description('Detect knowledge gaps (weak connections between clusters)')
  .action(gapsCommand);

program
  .command('duplicates')
  .description('Find duplicate or near-identical notes')
  .option('-t, --threshold <n>', 'Similarity threshold (0–1)', '0.88')
  .action(duplicatesCommand);

program
  .command('contradictions')
  .description('Detect contradicting statements across your notes')
  .action(contradictionsCommand);

program
  .command('review')
  .description('Daily review — resurface fading notes for spaced repetition')
  .option('-n, --count <n>', 'Number of notes to review', '5')
  .action(reviewCommand);

program
  .command('learn')
  .description('AI learning path — personalized recommendations based on decay + gaps')
  .action(learnCommand);

program
  .command('lint')
  .description('Knowledge health check — gaps, duplicates, contradictions, stale notes')
  .action(() => lintCommand());

// ─── Writing & expression ────────────────────────────────────

program
  .command('draft [topic]')
  .description('Generate a draft from your knowledge (blog/report/outline/instagram/thread/script)')
  .option('--format <type>', 'Output format: blog, report, outline, instagram, thread, script')
  .option('--ai', 'Use Claude API for AI-enhanced draft (requires ANTHROPIC_API_KEY)')
  .option('--blueprint <spec>', 'Chapter structure: "Ch1:tag1,tag2; Ch2:tag3"')
  .action((topic, opts) => draftCommand(topic, opts));

program
  .command('compile')
  .description('Compile raw/ documents into a structured wiki')
  .option('-r, --raw <dir>', 'Raw documents directory (default: raw/)')
  .option('-w, --wiki <dir>', 'Wiki output directory (default: _wiki/)')
  .option('-f, --force', 'Overwrite existing wiki files')
  .action((opts) => compileCommand(opts));

program
  .command('card')
  .description('Generate an SVG knowledge profile card')
  .option('-o, --output <path>', 'Output file path', 'knowledge-card.svg')
  .action(cardCommand);

// ─── Capture ─────────────────────────────────────────────────

program
  .command('fleeting <text>')
  .description('Capture a fleeting idea instantly to raw/ folder')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action((text: string, opts) => fleetingCommand(text, opts));

program
  .command('capture <audio-file>')
  .description('Voice capture — transcribe audio to a knowledge note (requires Whisper)')
  .option('-m, --model <model>', 'Whisper model (tiny/base/small/medium/large)', 'base')
  .option('-l, --language <lang>', 'Language (auto-detect if omitted)')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-f, --folder <folder>', 'Vault subfolder', '01_Knowledge/voice')
  .action(captureCommand);

// ─── Zettelkasten workflow ───────────────────────────────────

program
  .command('promote <file>')
  .description('Promote a note: fleeting → literature → permanent')
  .requiredOption('--to <stage>', 'Target stage: literature or permanent')
  .action((file: string, opts) => promoteCommand(file, opts));

program
  .command('flush')
  .description('Flush daily logs → wiki: extract concepts, rebuild connections')
  .action(() => flushCommand());

program
  .command('session-save')
  .description('Save session summary to daily log (used by Claude Code hooks)')
  .option('-s, --summary <text>', 'Session summary text (or pipe via stdin)')
  .option('-d, --decisions <text>', 'Key decisions made')
  .option('-l, --lessons <text>', 'Lessons learned')
  .option('-a, --actions <text>', 'Action items')
  .action((opts) => sessionSaveCommand(opts));

program
  .command('adr <title>')
  .description('Create an Architecture Decision Record (structured decision log)')
  .option('--context <text>', 'Why is this decision needed?')
  .option('--options <text>', 'What alternatives were considered?')
  .option('--decision <text>', 'What was decided and why?')
  .option('--consequences <text>', 'What are the implications?')
  .action((title, opts) => adrCommand(title, opts));

program
  .command('autopilot')
  .description('Run the full knowledge flywheel: inbox → compile → lint')
  .option('--once', 'Run once (default)')
  .action((opts) => autopilotCommand(opts));

// ─── Sync ────────────────────────────────────────────────────

program
  .command('sync')
  .description('Sync Notion → Obsidian')
  .option('--upload', 'Upload PDCA documents to Notion')
  .option('--watch', 'Auto-sync every 5 minutes')
  .action(syncCommand);

// ─── Multi-Vault ─────────────────────────────────────────────

const vault = program.command('vault').description('Multi-Vault — manage and search across vaults');
vault.command('add <id> <path>').description('Register a vault').option('-n, --name <name>', 'Display name').option('-s, --shared', 'Allow federation sharing').action(vaultAddCommand);
vault.command('list').description('List registered vaults').action(vaultListCommand);
vault.command('remove <id>').description('Unregister a vault').action(vaultRemoveCommand);
vault.command('search-all <query>').description('Search across all registered vaults').option('-l, --limit <n>', 'Max results', '10').action(vaultSearchAllCommand);

// ─── Federation ──────────────────────────────────────────────

const federate = program.command('federate').description('Federation — P2P knowledge network');
federate.command('join').description('Join the Stella Network (interactive mode)').option('-n, --name <name>', 'Display name for this node').action(federateJoinCommand);
federate.command('status').description('Show federation identity and status').action(federateStatusCommand);

// ─── Cloud ───────────────────────────────────────────────────

const cloud = program.command('cloud').description('Cloud — E2E encrypted backup');
cloud.command('sync').description('Upload encrypted DB to cloud').action(cloudSyncCommand);
cloud.command('restore').description('Download and decrypt DB from cloud').action(cloudRestoreCommand);
cloud.command('status').description('Show last sync status').action(cloudStatusCommand);

// ─── Knowledge Packs ─────────────────────────────────────────

const pack = program.command('pack').description('Knowledge Packs — create, share, and import curated bundles');

pack.command('create <name>')
  .description('Create a Knowledge Pack from search results or clusters')
  .option('--from-search <query>', 'Build from a search query')
  .option('--from-cluster <id>', 'Build from a cluster ID')
  .option('--author <name>', 'Author name', 'anonymous')
  .option('--license <license>', 'License', 'CC-BY-4.0')
  .option('--description <desc>', 'Pack description')
  .option('--limit <n>', 'Max chunks to include', '100')
  .action(packCreateCommand);

pack.command('export <name>')
  .description('Export a pack as a .sv-pack file')
  .option('-o, --output <path>', 'Output path')
  .action(packExportCommand);

pack.command('import <file>')
  .description('Import a .sv-pack file into your vector DB')
  .action(packImportCommand);

pack.command('list')
  .description('List installed packs')
  .action(packListCommand);

pack.command('info <name>')
  .description('Show pack details')
  .action(packInfoCommand);

program.parse();
