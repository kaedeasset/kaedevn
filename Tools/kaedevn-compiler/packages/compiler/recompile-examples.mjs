import { compile } from './dist/index.js';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const examplesDir = './examples';
const files = readdirSync(examplesDir).filter(f => f.endsWith('.ks'));

for (const file of files) {
  const ksPath = join(examplesDir, file);
  const jsonPath = join(examplesDir, file.replace('.ks', '.json'));

  console.log(`コンパイル中: ${file}`);

  const source = readFileSync(ksPath, 'utf-8');
  const scenarioId = file.replace('.ks', '');
  const result = compile(source, { scenarioId });

  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`✓ ${jsonPath} を生成しました`);
  console.log(`  ops数: ${result.ops.length}`);
  console.log(`  最後のop: ${result.ops[result.ops.length - 1].op}`);
}

console.log('\n✅ すべてのサンプルファイルを再コンパイルしました');
