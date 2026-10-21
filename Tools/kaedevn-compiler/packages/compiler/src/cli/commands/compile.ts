import { readFileSync, writeFileSync, watchFile, unwatchFile } from 'fs';
import { resolve, basename } from 'path';
import { compile } from '../../index.js';
import { CompilationException } from '../../types/CompilerError.js';

interface CompileOptions {
  output?: string;
  id?: string;
  validate?: boolean;
  watch?: boolean;
}

export function compileCommand(input: string, options: CompileOptions): void {
  const inputPath = resolve(input);

  if (options.watch) {
    console.log(`👀 Watching ${input} for changes...`);
    console.log('Press Ctrl+C to stop\n');

    // 初回コンパイル
    compileFile(inputPath, options);

    // ファイル監視
    watchFile(inputPath, { interval: 500 }, () => {
      console.log(`\n📝 File changed: ${input}`);
      compileFile(inputPath, options);
    });

    // Ctrl+C で終了
    process.on('SIGINT', () => {
      console.log('\n\n👋 Watch stopped');
      unwatchFile(inputPath);
      process.exit(0);
    });
  } else {
    compileFile(inputPath, options);
  }
}

function compileFile(inputPath: string, options: CompileOptions): void {
  try {
    // ファイル読み込み
    const source = readFileSync(inputPath, 'utf-8');

    // シナリオID決定
    const scenarioId = options.id || basename(inputPath, '.ks');

    // コンパイル
    const result = compile(source, {
      scenarioId,
      validate: options.validate,
      onWarning: (w) => console.warn(`⚠️ ${w.line ? `Line ${w.line}: ` : ''}${w.message}`),
    });

    // 出力パス決定
    const outputPath = options.output || inputPath.replace(/\.ks$/, '.json');

    // JSON出力
    const json = JSON.stringify(result, null, 2);
    writeFileSync(outputPath, json, 'utf-8');

    console.log(`✅ Compiled successfully`);
    console.log(`   Input:  ${inputPath}`);
    console.log(`   Output: ${outputPath}`);
    console.log(`   Ops:    ${result.ops.length} instructions`);
  } catch (error) {
    if (error instanceof CompilationException) {
      console.error('\n❌ Compilation failed:');
      console.error('');
      console.error(error.message);
      if (!options.watch) {
        process.exit(1);
      }
    } else if (error instanceof Error) {
      console.error(`\n❌ Error: ${error.message}`);
      if (!options.watch) {
        process.exit(1);
      }
    } else {
      throw error;
    }
  }
}
