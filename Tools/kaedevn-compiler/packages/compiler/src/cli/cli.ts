#!/usr/bin/env node
import { Command } from 'commander';
import { compileCommand } from './commands/compile.js';
import { validateCommand } from './commands/validate.js';
import { ks2kscCommand } from './commands/ks2ksc.js';

const program = new Command();

program
  .name('kaedevn-compile')
  .description('kaedevn DSL compiler - .ks to Op JSON')
  .version('0.1.0');

// デフォルト動作: ファイルをコンパイル
program
  .argument('<input>', '.ks file to compile')
  .option('-o, --output <file>', 'Output JSON file path')
  .option('-i, --id <scenarioId>', 'Scenario ID')
  .option('--no-validate', 'Skip validation')
  .option('-w, --watch', 'Watch mode - recompile on file change')
  .action(compileCommand);

// validate サブコマンド
program
  .command('validate')
  .description('Validate .ks file(s) without compiling')
  .argument('<input...>', '.ks file(s) to validate')
  .action(validateCommand);

// ks2ksc サブコマンド: editor→KS→KSC 一気通貫（多ファイルリンク → KSC）
program
  .command('ks2ksc')
  .description('Convert linked .ks files to a single .ksc (strategy B)')
  .argument('<entry>', 'entry .ks file (siblings in its dir are linked)')
  // 親 program の `-o, --output`（compile 既定）と衝突するため別名にする。
  .option('--out <file>', 'Output .ksc file path')
  .action(ks2kscCommand);

program.parse();
