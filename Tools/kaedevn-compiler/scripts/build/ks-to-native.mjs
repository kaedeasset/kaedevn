// KS スクリプト群 → native エンジン用 scenario.json（Op IR）一発変換（DB / API 不要）
//
// UE 行単位 KS エディタの保存データ（KS ファイル群が正）をビルドする経路。
//
//   <ksProjectDir>/scenario/**/*.ks（ファイル名昇順 = ページ順、先頭が entry）
//     → filesToKs（ファイル跨ぎジャンプ解決・ラベル名前空間化・連結）
//     → compile → scenario.json（Op IR）
//     → extractAssetRefs → asset-manifest.json
//
// editor-json-to-native.mjs（editor-json 入力版）の後段 compile 部分と同じ流儀。
// こちらは KS が正なので restage / 線形 jump 挿入は行わない（人間の記述が正、
// 演出上の問題は UE エディタ側 lint が担う）。画像コピーも行わない
// （UE プロジェクトの assets.json / 画像実体をそのまま使う）。
//
// Usage:
//   node scripts/build/ks-to-native.mjs <ksProjectDir> \
//     [--out <dir>]      # 出力先（default: <ksProjectDir>）
//     [--id <scenarioId>]# scenario.json の id（default: <ksProjectDir> のディレクトリ名）
//     [--emit-ks]        # 連結後の1本 KS を linked.ks として出力（デバッグ用）

import fs from 'node:fs';
import path from 'node:path';
import { compile, filesToKs, extractAssetRefs } from '@kaedevn/compiler';

// ---- helpers ----------------------------------------------------------------

/** dir 配下の *.ks を再帰列挙し、base からの相対パス（/ 区切り・名前昇順）で返す。 */
function walkKs(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (fs.statSync(full).isDirectory()) out.push(...walkKs(full, rel));
    else if (entry.endsWith('.ks')) out.push(rel);
  }
  return out.sort();
}

/** UTF-8 読み込み（UE 側が付ける可能性のある BOM を除去）。 */
function readKs(file) {
  const s = fs.readFileSync(file, 'utf-8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; // U+FEFF (BOM)
}

/** entry ファイル先頭の `; title:` コメントからタイトル抽出（無ければファイル名から）。 */
function extractTitle(content, entryName) {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^;\s*title:\s*(.+)$/);
    if (m) return m[1].trim();
    if (!t.startsWith(';')) break; // 先頭コメント群を抜けたら打ち切り
  }
  // "page-001_枯れた泉.ks" → "枯れた泉"、区切りが無ければ拡張子抜きファイル名
  const base = path.basename(entryName, '.ks');
  const us = base.indexOf('_');
  return us >= 0 ? base.slice(us + 1) : base;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const flagValues = new Set([opt('--out'), opt('--id')].filter(Boolean));
  const ksProjectDir = args.find((a) => !a.startsWith('--') && !flagValues.has(a));
  if (!ksProjectDir) {
    console.error('Usage: node scripts/build/ks-to-native.mjs <ksProjectDir> [--out <dir>] [--id <scenarioId>] [--emit-ks]');
    process.exit(1);
  }
  const resolved = path.resolve(ksProjectDir);
  return {
    ksProjectDir: resolved,
    outDir: path.resolve(opt('--out') ?? resolved),
    scenarioId: opt('--id') ?? path.basename(resolved),
    emitKs: args.includes('--emit-ks'),
  };
}

// ---- main --------------------------------------------------------------------

function main() {
  const { ksProjectDir, outDir, scenarioId, emitKs } = parseArgs();

  // 1. scenario/**/*.ks を名前昇順で読む（先頭 = entry = 開始ページ）
  const scenarioDir = path.join(ksProjectDir, 'scenario');
  if (!fs.existsSync(scenarioDir)) {
    console.error(`ERROR: scenario/ が見つからない: ${scenarioDir}`);
    process.exit(1);
  }
  const relPaths = walkKs(scenarioDir);
  if (relPaths.length === 0) {
    console.error(`ERROR: *.ks が1つもない: ${scenarioDir}`);
    process.exit(1);
  }
  const files = relPaths.map((name) => ({ name, content: readKs(path.join(scenarioDir, name)) }));
  const entry = files[0].name;
  const title = extractTitle(files[0].content, entry);
  console.log(`[load] "${title}" files=${files.length} entry=${entry}`);

  // 2. filesToKs でファイル跨ぎジャンプを解決して1本の KS へ連結
  const link = filesToKs(files, entry);
  const lastFile = files[files.length - 1].name;
  for (const issue of link.issues) {
    // 最終ページのみ jump なし＝スクリプト終了が正規の書き方（仕様書）。
    // 連結上も最後尾に置かれるため fall-through は起きない → この warning は抑制する
    if (issue.kind === 'fall_through' && issue.file === lastFile) continue;
    const line = `${issue.file}:${issue.line}: ${issue.message}`;
    if (issue.severity === 'unsupported') console.error(`ERROR: ${line}`);
    else console.warn(`  WARN: ${line}`);
  }
  if (link.issues.some((i) => i.severity === 'unsupported')) {
    console.error('ERROR: 未解決のファイル跨ぎジャンプ等があるため中断');
    process.exit(1);
  }

  // 3. compile → Op IR
  let compiled;
  try {
    compiled = compile(link.ks, {
      scenarioId,
      // 書き間違いのラベル等を UE の Output Log へ出す（exe の stderr を UE が読む）
      onWarning: (w) => console.warn(`[Parser] ${w.line ? `Line ${w.line}: ` : ''}${w.message}`),
    });
  } catch (e) {
    console.error(`ERROR: コンパイル失敗: ${e.message}`);
    if (e.errors) for (const err of e.errors) console.error(`  ${err.line != null ? `line ${err.line}: ` : ''}${err.message}`);
    process.exit(1);
  }

  const refs = extractAssetRefs(compiled.ops);

  // 4. 出力（scenario.json は editor-json-to-native.mjs と同スキーマ: id/title/ops/labels）
  fs.mkdirSync(outDir, { recursive: true });
  const scenario = { id: scenarioId, title, ops: compiled.ops, labels: compiled.labels ?? {} };
  fs.writeFileSync(path.join(outDir, 'scenario.json'), JSON.stringify(scenario, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(outDir, 'asset-manifest.json'),
    JSON.stringify({ version: 1, projectId: scenarioId, ...refs }, null, 2),
    'utf-8',
  );
  if (emitKs) fs.writeFileSync(path.join(outDir, 'linked.ks'), link.ks + '\n', 'utf-8');

  console.log(
    `[write] ${path.join(outDir, 'scenario.json')} ops=${scenario.ops.length} labels=${Object.keys(scenario.labels).length} ` +
    `refs(bg=${refs.bg.length} ch=${refs.ch.length} bgm=${refs.bgm.length} se=${refs.se.length})`,
  );
}

main();
