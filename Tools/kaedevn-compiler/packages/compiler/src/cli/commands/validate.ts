import { readFileSync } from 'fs';
import { resolve } from 'path';
import { compile } from '../../index.js';
import { CompilationException } from '../../types/CompilerError.js';

export function validateCommand(inputs: string[]): void {
  let hasErrors = false;

  for (const input of inputs) {
    const inputPath = resolve(input);

    try {
      const source = readFileSync(inputPath, 'utf-8');

      // バリデーション付きでコンパイル（出力は破棄）
      compile(source, { validate: true });

      console.log(`✅ ${input}: OK`);
    } catch (error) {
      hasErrors = true;

      if (error instanceof CompilationException) {
        console.error(`\n❌ ${input}: Validation failed\n`);
        console.error(error.message);
      } else if (error instanceof Error) {
        console.error(`\n❌ ${input}: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  if (hasErrors) {
    console.error('\n❌ Validation failed for one or more files');
    process.exit(1);
  } else {
    console.log('\n✅ All files validated successfully');
  }
}
