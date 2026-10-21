/**
 * TyranoScript の軽量パーサ層。
 *
 * `.ks` テキストを行単位で分類し、タグ・テキスト・ラベル・話者・コメント・
 * ブロック（iscript/macro/if）の AST ノード列に変換する。変換ロジック本体は
 * tyranoConverter.ts 側に置き、ここは「字句・構文の取り出し」と共有文字列ヘルパーに閉じる。
 */

export interface TyranoSourceLocation {
  line: number;
  column: number;
  source: string;
}

export interface TyranoTextNode {
  type: 'text';
  text: string;
  loc: TyranoSourceLocation;
}

export interface TyranoTagNode {
  type: 'tag';
  name: string;
  args: Record<string, string | boolean>;
  raw: string;
  loc: TyranoSourceLocation;
}

export interface TyranoLabelNode {
  type: 'label';
  name: string;
  loc: TyranoSourceLocation;
}

export interface TyranoSpeakerNode {
  type: 'speaker';
  name: string;
  loc: TyranoSourceLocation;
}

export interface TyranoCommentNode {
  type: 'comment';
  text: string;
  loc: TyranoSourceLocation;
}

export interface TyranoBlockNode {
  type: 'block';
  name: 'iscript' | 'macro' | 'if' | 'keyframe';
  args: Record<string, string | boolean>;
  children: TyranoNode[];
  raw: string;
  loc: TyranoSourceLocation;
}

export type TyranoNode =
  | TyranoTextNode
  | TyranoTagNode
  | TyranoLabelNode
  | TyranoSpeakerNode
  | TyranoCommentNode
  | TyranoBlockNode;

const UNSAFE_BLOCK_TAGS = new Set(['iscript', 'macro', 'if', 'keyframe']);
const BLOCK_END_TAGS: Record<string, string> = {
  iscript: 'endscript',
  macro: 'endmacro',
  if: 'endif',
  keyframe: 'endkeyframe',
};

export function parseTyrano(source: string): TyranoNode[] {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const nodes: TyranoNode[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNum = index + 1;
    const trimmed = line.trim();

    if (!trimmed) continue;

    const fullLineLoc = makeLoc(lineNum, line.indexOf(trimmed) + 1, line);

    if (trimmed.startsWith(';')) {
      nodes.push({ type: 'comment', text: trimmed.slice(1).trim(), loc: fullLineLoc });
      continue;
    }

    if (trimmed.startsWith('*')) {
      nodes.push({ type: 'label', name: normalizeTarget(trimmed.slice(1).trim()), loc: fullLineLoc });
      continue;
    }

    if (trimmed.startsWith('#')) {
      nodes.push({ type: 'speaker', name: trimmed.slice(1).trim(), loc: fullLineLoc });
      continue;
    }

    const lineNodes = parseTyranoLine(line, lineNum);
    const firstTag = lineNodes.find((node): node is TyranoTagNode => node.type === 'tag');
    if (firstTag && UNSAFE_BLOCK_TAGS.has(firstTag.name)) {
      if (firstTag.name === 'if') {
        // [if] は同一行の [endif]（inline 形式）とネストに対応した専用収集を使う
        index = collectIfBlock(lines, index, lineNodes, firstTag, nodes);
        continue;
      }
      const endTag = BLOCK_END_TAGS[firstTag.name];
      const rawLines = [line];
      const children: TyranoNode[] = [];
      while (index + 1 < lines.length) {
        index++;
        rawLines.push(lines[index]);
        if (containsTag(lines[index], endTag)) break;
        children.push(...parseTyranoLine(lines[index], index + 1));
      }
      nodes.push({
        type: 'block',
        name: firstTag.name as TyranoBlockNode['name'],
        args: firstTag.args,
        children,
        raw: rawLines.join('\n'),
        loc: firstTag.loc,
      });
      continue;
    }

    nodes.push(...lineNodes);
  }

  return nodes;
}

/**
 * [if]…[endif] ブロックを収集する。
 * - inline 形式（同一行に `[if ...]text[endif]`）は 1 行で閉じ、[endif] より後の
 *   同一行ノードはブロックの外の兄弟として out へ出す
 * - ネストした [if] は深度を数え、対応する [endif] でのみ閉じる（内側の [if] は
 *   ネストした block ノードとして children に入る）
 * - EOF まで [endif] が無い場合はそこまでを children として確定する（従来挙動）
 *
 * @returns ブロックが閉じた（または EOF に達した）行の index。呼び出し側の
 *          for ループがこの次の行から再開する。
 */
function collectIfBlock(
  lines: string[],
  startIndex: number,
  startLineNodes: TyranoNode[],
  openTag: TyranoTagNode,
  out: TyranoNode[],
): number {
  const openPos = startLineNodes.indexOf(openTag);
  // [if] より前の同一行ノード（テキスト等）はブロックの外の兄弟として出力する
  out.push(...startLineNodes.slice(0, openPos));

  const root: TyranoBlockNode = {
    type: 'block',
    name: 'if',
    args: openTag.args,
    children: [],
    raw: '',
    loc: openTag.loc,
  };
  // スタックの底が root。[if] タグで push、[endif] で pop（= 深度カウント）。
  const stack: TyranoBlockNode[] = [root];
  const rawLines = [lines[startIndex]];

  let index = startIndex;
  let queue = startLineNodes.slice(openPos + 1);

  for (;;) {
    for (let q = 0; q < queue.length; q++) {
      const node = queue[q];
      if (node.type === 'tag' && node.name === 'if') {
        const nested: TyranoBlockNode = {
          type: 'block',
          name: 'if',
          args: node.args,
          children: [],
          raw: node.raw,
          loc: node.loc,
        };
        stack[stack.length - 1].children.push(nested);
        stack.push(nested);
        continue;
      }
      if (node.type === 'tag' && node.name === 'endif') {
        stack.pop();
        if (stack.length === 0) {
          // root の [if] が閉じた。同一行の残りはブロックの外の兄弟として出力する
          root.raw = rawLines.join('\n');
          out.push(root);
          out.push(...queue.slice(q + 1));
          return index;
        }
        continue;
      }
      stack[stack.length - 1].children.push(node);
    }
    if (index + 1 >= lines.length) break; // EOF: 未閉鎖のまま確定
    index++;
    rawLines.push(lines[index]);
    queue = parseTyranoLine(lines[index], index + 1);
  }

  root.raw = rawLines.join('\n');
  out.push(root);
  return index;
}

function parseTyranoLine(line: string, lineNum: number): TyranoNode[] {
  const nodes: TyranoNode[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    const open = line.indexOf('[', cursor);
    if (open === -1) {
      pushText(nodes, line.slice(cursor), lineNum, cursor + 1, line);
      break;
    }

    pushText(nodes, line.slice(cursor, open), lineNum, cursor + 1, line);

    // 引用符内の ] をスキップして終端を探す。引用符が閉じないまま行末に達した
    // 場合（閉じ引用符忘れ等の壊れた原文）は、従来どおり素の indexOf(']') に
    // フォールバックして「タグ丸ごとテキストに漏れる」劣化を避ける。
    const quoteAwareClose = findTagClose(line, open + 1);
    const close = quoteAwareClose !== -1 ? quoteAwareClose : line.indexOf(']', open + 1);
    if (close === -1) {
      pushText(nodes, line.slice(open), lineNum, open + 1, line);
      break;
    }

    const raw = line.slice(open, close + 1);
    const content = raw.slice(1, -1).trim();
    if (!content) {
      pushText(nodes, raw, lineNum, open + 1, line);
      cursor = close + 1;
      continue;
    }

    const { name, args } = parseTagContent(content);
    nodes.push({
      type: 'tag',
      name: name.toLowerCase(),
      args,
      raw,
      loc: makeLoc(lineNum, open + 1, line),
    });
    cursor = close + 1;
  }

  return nodes;
}

function parseTagContent(content: string): { name: string; args: Record<string, string | boolean> } {
  const parts = content.match(/(?:[^\s"'=]+=(?:"[^"]*"|'[^']*'|[^\s]+))|(?:[^\s]+)/g) ?? [];
  const [name = '', ...argParts] = parts;
  const args: Record<string, string | boolean> = {};
  for (const part of argParts) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      args[part] = true;
      continue;
    }
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    args[key] = stripQuotes(value);
  }
  return { name, args };
}

/**
 * タグの終端 `]` を、引用符（"…" / '…'）内をスキップしながら探す。
 * `[glink text="選択肢[A]" target=*next]` のような属性値中の `]` でタグを
 * 途切れさせないため、単純な indexOf(']') は使わない。
 * 引用符が閉じないまま行末に達した場合は -1（タグ未閉鎖扱い）。
 */
function findTagClose(line: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ']') {
      return i;
    }
  }
  return -1;
}

function pushText(nodes: TyranoNode[], text: string, line: number, column: number, source: string): void {
  if (!text) return;
  nodes.push({ type: 'text', text, loc: makeLoc(line, column, source) });
}

function containsTag(line: string, tagName: string): boolean {
  return new RegExp(`\\[\\s*${escapeRegExp(tagName)}(?:\\s|\\])`, 'i').test(line);
}

function makeLoc(line: number, column: number, source: string): TyranoSourceLocation {
  return { line, column: Math.max(1, column), source };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── 共有文字列ヘルパー（パーサ・コンバータ双方が使う） ──

export function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** storage（画像パス）を basename の ID へ正規化する（拡張子・ディレクトリを除去）。 */
export function storageToId(storage: string): string {
  const normalized = stripQuotes(storage).replace(/\\/g, '/');
  const file = normalized.split('/').filter(Boolean).pop() ?? normalized;
  const withoutExt = file.replace(/\.[^.]+$/, '');
  return sanitizeId(withoutExt);
}

/** 任意文字列を ID 化する（前後空白除去・空白を _ に）。 */
export function sanitizeId(value: string): string {
  return stripQuotes(value).trim().replace(/\s+/g, '_');
}

/**
 * ジャンプ/ラベルのターゲット名を正規化する（先頭 `*` を除去し、`|` 以降の
 * save-title 見出しを除去）。Tyrano の `*label|見出し` はラベル名が `label` であり、
 * ラベル定義側・jump target 側の双方で対称に正規化しないと参照が解決できない。
 */
export function normalizeTarget(target: string): string {
  const cleaned = stripQuotes(target).trim();
  const noStar = cleaned.startsWith('*') ? cleaned.slice(1) : cleaned;
  const pipe = noStar.indexOf('|');
  return pipe === -1 ? noStar : noStar.slice(0, pipe).trim();
}
