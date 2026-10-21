import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname, basename, relative, sep } from 'path';
import { ksFilesToKsc } from '../../index.js';
import type { KsFile } from '../../index.js';

interface Ks2KscOptions {
  out?: string;
}

/**
 * editor→KS→KSC: エントリ .ks とその同一ディレクトリ配下の全 .ks を集めて
 * filesToKs でリンク → ksToKscB で KSC 化し、.ksc に書き出す。
 */
export function ks2kscCommand(input: string, options: Ks2KscOptions): void {
  try {
    const entryPath = resolve(input);
    const root = dirname(entryPath);

    // 同一ディレクトリツリーの全 .ks を収集（filesToKs はルート相対名で解決する）。
    const files: KsFile[] = collectKsFiles(root).map((abs) => ({
      name: relative(root, abs).split(sep).join('/'),
      content: readFileSync(abs, 'utf-8'),
    }));

    const entryName = relative(root, entryPath).split(sep).join('/');
    if (!files.some((f) => f.name === entryName)) {
      console.error(`\n❌ Entry file not found among collected .ks: ${entryName}`);
      process.exit(1);
    }

    const { ksc, issues } = ksFilesToKsc(files, entryName);

    const outputPath = options.out ? resolve(options.out) : entryPath.replace(/\.ks$/, '.ksc');
    writeFileSync(outputPath, ksc, 'utf-8');

    console.log(`✅ KS → KSC done`);
    console.log(`   Entry:  ${entryName}  (${files.length} .ks files linked)`);
    console.log(`   Output: ${outputPath}`);
    if (issues.length > 0) {
      console.log(`\n⚠️  ${issues.length} issue(s):`);
      for (const i of issues) {
        const loc = i.file ? `${i.file}:${i.line ?? '?'}` : `KS:${i.line ?? '?'}`;
        console.log(`   [${i.stage}/${i.severity}] ${loc} — ${i.message}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ Error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

/** root 配下（再帰）の .ks ファイルを絶対パスで集める。 */
function collectKsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && basename(ent.name).endsWith('.ks')) out.push(abs);
    }
  };
  walk(root);
  return out;
}
