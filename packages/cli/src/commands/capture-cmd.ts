// sv capture <audio-file> — Voice Knowledge Capture (P3)

import chalk from 'chalk';
import { loadConfig, captureVoice, isWhisperAvailable } from '@stellavault/core';

export async function captureCommand(audioFile: string, options: { model?: string; language?: string; tags?: string; folder?: string }) {
  if (!isWhisperAvailable()) {
    console.log(chalk.red('\n  Whisper not installed.'));
    console.log(chalk.dim('  Install: pip install openai-whisper'));
    console.log(chalk.dim('  Or: brew install whisper-cpp\n'));
    return;
  }

  const config = loadConfig();
  console.log(chalk.dim(`\n  Transcribing ${audioFile}...`));

  const result = await captureVoice(audioFile, {
    vaultPath: config.vaultPath,
    model: options.model,
    language: options.language,
    tags: options.tags?.split(',').map(t => t.trim()),
    folder: options.folder,
  });

  if (result.success) {
    console.log(chalk.green(`\n  ✅ Captured: "${result.title}"`));
    console.log(`    Tags: ${result.tags.join(', ')}`);
    console.log(`    File: ${result.filePath}`);
    console.log(chalk.dim(`    Transcript: ${result.transcript.slice(0, 100)}...`));
    console.log(chalk.dim('\n  💡 Run stellavault index to add to the graph\n'));
  } else {
    console.log(chalk.red(`\n  ❌ Capture failed: ${result.error}\n`));
  }
}
