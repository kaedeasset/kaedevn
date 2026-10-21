// blocks(episode json) → .ks 変換の単一exe用エントリ（UEノベルエディタの保存/ビルド結線用）。
//
// UE の works/ エピソード { id, name, blocks[] } を読み、@kaedevn/compiler の blocksToKs で .ks へ変換する。
// block→ks の「正」は packages/compiler/src/ksConverter.ts の blocksToKs。ここはその薄い CLI ラッパ。
//
//   node scripts/build/blocks-to-ks.mjs <episode.json> [--out <file.ks>]
//
// 注: UE の ch ブロックは charAssetId、blocksToKs は characterId を見るため
//     ここでシムする（両形式の差の吸収点。ロジック本体は触らない）。
//
// exe 化: node scripts/build/make-blocks2ks-exe.mjs → dist/kaedevn-blocks2ks.exe

import fs from 'node:fs';
import path from 'node:path';
import { blocksToKs, ksFilesToKsc } from '@kaedevn/compiler';

function parseArgs() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  return { input, ksOnly: args.includes('--ks-only') };
}

// 読めない・JSON でない・blocks が配列でないエピソードは ERROR 1 行で終了コード 1（スタックトレースを出さない）。
function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readEpisode(inPath) {
  let text;
  try {
    text = fs.readFileSync(inPath, 'utf-8');
  } catch (e) {
    fail(`エピソードを読めない: ${inPath}: ${e.message}`);
  }
  let ep;
  try {
    ep = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    fail(`エピソードの JSON が壊れている: ${inPath}: ${e.message}`);
  }
  if (ep === null || typeof ep !== 'object' || Array.isArray(ep)) {
    fail(`エピソードがオブジェクトでない: ${inPath}`);
  }
  if (ep.blocks !== undefined && !Array.isArray(ep.blocks)) {
    fail(`エピソードの blocks が配列でない: ${inPath}`);
  }
  return ep;
}

function main() {
  const { input, ksOnly } = parseArgs();
  if (!input) {
    console.error('Usage: kaedevn-blocks2ks <episode.json> [--ks-only]');
    console.error('  出力: 同じ場所へ <name>.ks と <name>.ksc（--ks-only なら .ks のみ）');
    process.exit(1);
  }
  const inPath = path.resolve(input);
  const ep = readEpisode(inPath);

  // UE block形式 → blocksToKs の block形式のシム（ch: charAssetId → characterId）。
  const blocks = (ep.blocks ?? []).map((b) =>
    b && b.type === 'ch' && b.charAssetId && b.characterId === undefined
      ? { ...b, characterId: b.charAssetId }
      : b,
  );

  // block → .ks（正は packages/compiler の blocksToKs）
  const ks = blocksToKs(blocks, [], [], {});
  const ksPath = inPath.replace(/\.json$/i, '.ks');
  fs.writeFileSync(ksPath, ks, 'utf-8');

  if (ksOnly) {
    console.log(`OK blocks -> KS: ${ksPath} (${ks.length} chars)`);
    return;
  }

  // .ks → .ksc（単話1ファイルとしてコンパイル。話末尾の fall-through 警告は無害）
  const base = path.basename(ksPath);
  const { ksc, issues } = ksFilesToKsc([{ name: base, content: ks }], base);
  const kscPath = inPath.replace(/\.json$/i, '.ksc');
  fs.writeFileSync(kscPath, ksc, 'utf-8');

  const warns = issues.filter((i) => i.severity !== 'info').length;
  console.log(`OK blocks -> KS+KSC: ${ksPath} / ${kscPath} (ks=${ks.length} ksc=${String(ksc).length}${warns ? `, ${warns} warn` : ''})`);
}

main();
