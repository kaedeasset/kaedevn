/**
 * 複数 KS ファイルを1本の KS に連結するリンカ（Phase 5-A）。
 *
 * Tyrano の分割シナリオ（`data/scenario/**\/*.ks`）を converter で各ファイル KS へ
 * 変換したあと、本リンカが「ファイル跨ぎジャンプの解決 + ラベル名前空間化 + 連結」を
 * コンパイル時に行う。ランタイム（Op[]/OpRunner/セーブスキーマ）は無変更で、出力は
 * 既存の KS コンパイルパイプラインにそのまま渡せる1本の KS 文字列。
 *
 * ファイル跨ぎジャンプ構文（converter が出す形）:
 *   @jump intro                        ; ファイル内ラベル
 *   @jump chapter01/010_opening.ks     ; 別ファイル先頭へ
 *   @jump chapter01/010_opening.ks x   ; 別ファイル → ラベル
 * `@call` も同形。第1引数が `.ks(c)` 拡張子ならファイル跨ぎと判定する。
 */
import { KS_EXT_RE, toSlug } from './ksSlug.js';
import { splitWords } from './parser/splitCommandLine.js';

export interface KsFile {
  /** シナリオルート相対のパス（例 "chapter01/010_opening.ks"）。 */
  name: string;
  /** 変換済み KS テキスト。 */
  content: string;
}

/** 診断の種類。呼び出し側は message の文言でなくこれで判定する。 */
export type FilesToKsIssueKind = 'missing_entry' | 'fall_through' | 'unresolved_jump' | 'dynamic_target';

export interface FilesToKsIssue {
  kind: FilesToKsIssueKind;
  severity: 'warning' | 'unsupported';
  file: string;
  line: number;
  message: string;
}

export interface FilesToKsResult {
  ks: string;
  issues: FilesToKsIssue[];
}

const LABEL_RE = /^\s*\*(\S+)\s*$/;
const JUMP_RE = /^(\s*)@(jump|call)\s+(.+?)\s*$/;

function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * KS ファイル群を1本の KS へ連結する。entry を先頭に、他ファイルは後続に並べる。
 * pagesToKs と違いファイル末尾に @return は自動挿入しない（Tyrano はファイル境界を
 * fall-through しないため）。末尾が jump/return/} でないファイルは診断 warning。
 */
export function filesToKs(files: KsFile[], entry: string): FilesToKsResult {
  const issues: FilesToKsIssue[] = [];
  const pathToSlug = new Map<string, string>();
  for (const f of files) pathToSlug.set(normalizePath(f.name), toSlug(f.name));

  const entryNorm = normalizePath(entry);
  if (!pathToSlug.has(entryNorm)) {
    issues.push({ kind: 'missing_entry', severity: 'unsupported', file: entry, line: 0, message: `entry file "${entry}" not found among files.` });
  }

  // entry を先頭、残りは与えられた順で後続に
  const ordered = [
    ...files.filter((f) => normalizePath(f.name) === entryNorm),
    ...files.filter((f) => normalizePath(f.name) !== entryNorm),
  ];

  const out: string[] = [];
  for (const f of ordered) {
    const slug = toSlug(f.name);
    out.push(`*${slug}`); // ファイル先頭の暗黙ラベル
    const lines = f.content.replace(/\r\n?/g, '\n').split('\n');
    let lastSignificant = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        out.push(line);
        continue;
      }

      const labelM = line.match(LABEL_RE);
      if (labelM) {
        out.push(`*${slug}__${labelM[1]}`); // ファイル内ラベルを名前空間化
        lastSignificant = trimmed;
        continue;
      }

      const jumpM = line.match(JUMP_RE);
      if (jumpM) {
        const [, indent, kind, argStr] = jumpM;
        const resolved = resolveJumpTarget(argStr, slug, pathToSlug, f.name, i + 1, issues);
        out.push(`${indent}@${kind} ${resolved}`);
        lastSignificant = trimmed;
        continue;
      }

      out.push(line);
      // コメントは「意味のある末尾」に数えない（定義ファイルの誤検知回避）
      if (!trimmed.startsWith(';')) lastSignificant = trimmed;
    }

    // fall-through 検査: jump/return/} で終わらないと次ファイルへ流れてしまう
    if (lastSignificant && !isFileEnd(lastSignificant)) {
      issues.push({
        kind: 'fall_through',
        severity: 'warning',
        file: f.name,
        line: lines.length,
        message: `file does not end with a jump/return/choice; execution would fall through to the next file.`,
      });
    }
  }

  return { ks: out.join('\n'), issues };
}

function isFileEnd(line: string): boolean {
  return /^@jump\b/.test(line) || /^@return\b/.test(line) || line === '}';
}

/**
 * `@jump`/`@call` の引数（"label" or "path.ks [label]"）を名前空間化ラベルへ解決する。
 */
function resolveJumpTarget(
  argStr: string,
  thisSlug: string,
  pathToSlug: Map<string, string>,
  file: string,
  line: number,
  issues: FilesToKsIssue[],
): string {
  const parts = splitWords(argStr);
  const first = parts[0];

  // 実行時変数（&f.x 等）が converter の動的ジャンプの静的展開（tyrano/dynamicVars.ts）を
  // すり抜けて残った場合は無言で名前空間化せず診断を出す
  // （従来はここで target を握りつぶす誤変換になっていた）
  if (argStr.includes('&')) {
    issues.push({
      kind: 'dynamic_target',
      severity: 'unsupported',
      file,
      line,
      message: `dynamic jump/call target "${argStr}" cannot be resolved statically; kept as-is.`,
    });
  }

  if (KS_EXT_RE.test(first)) {
    // ファイル跨ぎ: path.ks [label]
    const targetSlug = pathToSlug.get(normalizePath(first));
    const label = parts[1];
    if (!targetSlug) {
      issues.push({ kind: 'unresolved_jump', severity: 'unsupported', file, line, message: `unresolved cross-file jump to "${first}" (file not found).` });
      // 未解決でも壊れない名前にする（末尾へ飛ぶ扱い）
      return `__unresolved_${toSlug(first)}`;
    }
    return label ? `${targetSlug}__${label}` : targetSlug;
  }

  // ファイル内ラベル
  return `${thisSlug}__${first}`;
}
