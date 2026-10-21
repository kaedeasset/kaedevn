/**
 * タグ属性の読み取りと、Tyrano の値 → kaedevn の値の小さな写し。
 */
import { normalizePosition, type StagePosition } from '../parser/position.js';
import type { TyranoTagNode, TyranoBlockNode } from '../tyranoParser.js';

/** タグ/ブロックの文字列属性を取り出す。 */
export function tagArg(node: TyranoTagNode | TyranoBlockNode, name: string): string | undefined {
  const v = node.args[name];
  return typeof v === 'string' ? v : undefined;
}

/** Parse a Tyrano ms attribute (e.g. time=500) to an integer, or undefined if absent/invalid. */
export function msArg(value?: string): number | undefined {
  return intArg(value);
}

export function intArg(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** `&...` の JS 式になっている属性を 1 つ探す（値が実行時依存のため変換できない）。 */
export function findJsAttr(node: TyranoTagNode): [string, unknown] | undefined {
  return Object.entries(node.args).find(([, v]) => typeof v === 'string' && v.trim().startsWith('&'));
}

/**
 * Bucket a Tyrano absolute x-pixel into kaedevn's named slots.
 * Tyrano's default game width is 1280 (matches kaedevn's logical width),
 * so split into thirds. This is inherently lossy — callers attach a warning.
 */
export function bucketPixelToPosition(px: number): StagePosition {
  const width = 1280;
  if (px < width / 3) return 'left';
  if (px > (width * 2) / 3) return 'right';
  return 'center';
}

/** Tyrano の pos は大文字小文字を問わない（l / Left など）。表に無ければ center。 */
export function tyranoPosition(value?: string): StagePosition {
  const lower = value?.toLowerCase();
  return normalizePosition(lower?.length === 1 ? lower.toUpperCase() : lower) ?? 'center';
}

// KS の lineClassifier が VAR_SET（`word=value`）と判定する形。ASCII の \w+ 始まりのみ該当。
const VAR_SET_LIKE = /^\s*\w+\s*(?:\+=|-=|=)\s*\S/;
// U+200B ZERO WIDTH SPACE（不可視）。ソースにリテラルを埋めず codepoint から構築する。
const ZWSP = String.fromCharCode(0x200b);

/**
 * KS は `word=value` を変数代入として扱うため、それに見える地の文（Tyrano では単なる本文）を
 * ゼロ幅スペース(U+200B)で無害化し、KS にテキストとして解釈させる。表示は不変。
 * 例: `time=%timeに着目してね。`（マクロ解説の本文）が VAR_SET 誤判定で compile を止めるのを防ぐ。
 * 日本語の変数名は \w に含まれないため、実害があるのは ASCII 始まりの本文だけ。
 */
export function protectTextLine(text: string): string {
  return VAR_SET_LIKE.test(text) ? ZWSP + text : text;
}
