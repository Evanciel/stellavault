// Design Ref: §6 — sv federate CLI (대화형 모드)
// Plan SC: SC1-SC5

import { createInterface } from 'node:readline';
import chalk from 'chalk';
import {
  loadConfig, createSqliteVecStore, createLocalEmbedder,
  FederationNode, FederatedSearch, getOrCreateIdentity,
} from '@stellavault/core';

export async function federateJoinCommand(options: { name?: string }) {
  const config = loadConfig();
  const identity = getOrCreateIdentity(options.name);

  console.log('');
  console.log(chalk.bold('  ✦ Stellavault Federation'));
  console.log(chalk.dim(`  Node: ${identity.displayName} (${identity.peerId})`));
  console.log('');

  // 로컬 스토어 초기화 (검색 응답용)
  const store = createSqliteVecStore(config.dbPath);
  await store.initialize();

  const embedder = createLocalEmbedder(config.embedding.localModel);
  await embedder.initialize();

  // 통계 수집
  const stats = await store.getStats();
  const topics = await store.getTopics();

  // Federation 노드 시작
  const node = new FederationNode(options.name);
  node.setLocalStats(stats.documentCount, topics.slice(0, 5).map((t: any) => t.topic));

  const search = new FederatedSearch(node, store, embedder);
  search.startResponder();

  // 이벤트 리스너
  node.on('joined', (info: any) => {
    console.log(chalk.green(`  ✦ Joined federation network`));
    console.log(chalk.dim(`    Topic: ${info.topic}`));
    console.log(chalk.dim(`    Waiting for peers...\n`));
  });

  node.on('peer_joined', (peer: any) => {
    console.log(chalk.cyan(`  → Peer found: ${peer.displayName} (${peer.documentCount} docs) [${peer.peerId}]`));
  });

  node.on('peer_left', (info: any) => {
    console.log(chalk.yellow(`  ← Peer left: ${info.peerId}`));
  });

  node.on('search_request', () => {
    // 검색 요청 수신 로깅 (응답은 FederatedSearch.startResponder가 처리)
  });

  await node.join();

  // 대화형 모드
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question(chalk.dim('federation> '), handleInput);

  async function handleInput(line: string) {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];

    switch (cmd) {
      case 'search': {
        const query = parts.slice(1).join(' ');
        if (!query) { console.log(chalk.yellow('  Usage: search <query>')); break; }

        const start = Date.now();
        console.log(chalk.dim(`  Searching ${node.peerCount} peers...`));

        const results = await search.search(query, { limit: 5, timeout: 5000 });
        const elapsed = Date.now() - start;

        if (results.length === 0) {
          console.log(chalk.yellow(`  No results from peers. (${elapsed}ms)`));
        } else {
          console.log('');
          for (const r of results) {
            const simColor = r.similarity >= 0.7 ? chalk.green : r.similarity >= 0.4 ? chalk.yellow : chalk.dim;
            console.log(`  ${simColor(`${Math.round(r.similarity * 100)}%`)} ${chalk.bold(r.title)} ${chalk.dim(`[${r.peerName}]`)}`);
            console.log(`     ${chalk.dim(r.snippet)}...`);
          }
          console.log(chalk.dim(`\n  ${results.length} results from ${new Set(results.map(r => r.peerId)).size} peers (${elapsed}ms)`));
        }
        break;
      }

      case 'peers': {
        const peers = node.getPeers();
        if (peers.length === 0) {
          console.log(chalk.yellow('  No peers connected'));
        } else {
          console.log('');
          for (const p of peers) {
            console.log(`  ${chalk.cyan(p.displayName)} ${chalk.dim(`(${p.documentCount} docs)`)} [${p.peerId}]`);
            if (p.topTopics.length > 0) {
              console.log(`    ${chalk.dim(p.topTopics.map(t => `#${t}`).join(' '))}`);
            }
          }
          console.log(chalk.dim(`\n  ${peers.length} peer(s) connected`));
        }
        break;
      }

      case 'status': {
        console.log('');
        console.log(`  ${chalk.bold('Node:')} ${identity.displayName} (${identity.peerId})`);
        console.log(`  ${chalk.bold('Docs:')} ${stats.documentCount}`);
        console.log(`  ${chalk.bold('Peers:')} ${node.peerCount}`);
        console.log(`  ${chalk.bold('Running:')} ${node.isRunning ? chalk.green('yes') : chalk.red('no')}`);
        break;
      }

      case 'connect': {
        const addr = parts[1];
        if (!addr || !addr.includes(':')) { console.log(chalk.yellow('  Usage: connect <host:port>')); break; }
        const [host, portStr] = addr.split(':');
        try {
          console.log(chalk.dim(`  Connecting to ${addr}...`));
          await node.joinDirect(host, parseInt(portStr, 10));
          console.log(chalk.green(`  Connected to ${addr}`));
        } catch (err) {
          console.log(chalk.red(`  Failed: ${err instanceof Error ? err.message : err}`));
        }
        break;
      }

      case 'leave':
      case 'quit':
      case 'exit': {
        console.log(chalk.dim('  Leaving federation...'));
        await node.leave();
        await store.close();
        rl.close();
        process.exit(0);
        return; // don't re-prompt
      }

      case 'help': {
        console.log('');
        console.log('  Commands:');
        console.log(`    ${chalk.cyan('search <query>')}    Search across all connected peers`);
        console.log(`    ${chalk.cyan('peers')}             List connected peers`);
        console.log(`    ${chalk.cyan('status')}            Show node info`);
        console.log(`    ${chalk.cyan('connect <ip:port>')} Connect to peer directly`);
        console.log(`    ${chalk.cyan('leave')}             Disconnect and exit`);
        break;
      }

      default: {
        if (cmd) console.log(chalk.dim(`  Unknown command: ${cmd}. Type 'help' for commands.`));
        break;
      }
    }

    prompt(); // 다음 입력 대기
  }

  // Ctrl+C 처리
  process.on('SIGINT', async () => {
    console.log(chalk.dim('\n  Leaving federation...'));
    await node.leave();
    await store.close();
    process.exit(0);
  });

  prompt();
}

// 단순 상태 조회 (join 없이)
export async function federateStatusCommand() {
  const identity = getOrCreateIdentity();
  const config = loadConfig();

  console.log('');
  console.log(chalk.bold('  ✦ Federation Identity'));
  console.log(`  PeerID: ${identity.peerId}`);
  console.log(`  Name:   ${identity.displayName}`);
  console.log(`  Since:  ${identity.createdAt}`);
  console.log(`  DB:     ${config.dbPath}`);
  console.log('');
}
