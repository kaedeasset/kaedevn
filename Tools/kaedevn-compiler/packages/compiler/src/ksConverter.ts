/**
 * Block-to-KS conversion utilities.
 *
 * This module is the single source of truth for converting editor blocks to KS
 * script.
 *
 * The bulk per-block dispatch lives in ./blockToKsBlocks.ts; this file keeps the
 * page-level orchestration (blocksToKs / pagesToKs) and re-exports the public API.
 */
import { KsPrinter } from './parser/KsPrinter.js';
import type { KsBlock } from './types/KsAST.js';
import {
  blockToKsBlocks,
  characterSlug,
  expandInlineTags,
  type ConvertibleAsset,
  type ConvertibleCharacter,
  type SpeakerColorsMap,
} from './blockToKsBlocks.js';

// 公開 API の維持（index.ts はここから import している）
export { expandInlineTags };
export type { ConvertibleAsset, ConvertibleCharacter, SpeakerColorsMap };

/**
 * Convert an array of blocks to KS script string.
 * Single-page version — used by the editor for per-page preview.
 */
export function blocksToKs(
  blocks: any[],
  assets: ConvertibleAsset[] = [],
  characters: ConvertibleCharacter[] = [],
  speakerColors: SpeakerColorsMap = {},
): string {
  let lastSpeakerSlug: string | undefined;

  const ksBlocks: KsBlock[] = [];
  blocks.forEach((b, index) => {
    const result = blockToKsBlocks(b, assets, characters, lastSpeakerSlug, speakerColors, `gen-${index}`);
    ksBlocks.push(...result);

    // 直前のキャラ操作から話者を更新
    if ((b.type === 'ch' || b.type === 'ch_expr') && b.characterId) {
      lastSpeakerSlug = characterSlug(characters, b.characterId);
    } else if (b.type === 'ch_hide' && lastSpeakerSlug === b.characterId) {
      lastSpeakerSlug = undefined;
    }
  });

  const printer = new KsPrinter();
  return printer.print({ blocks: ksBlocks });
}

/**
 * Convert multi-page blocks to KS script string.
 * Replaces generateKSCScript — single source of truth for block→script conversion.
 */
export function pagesToKs(
  title: string,
  pages: Array<{ id?: string; name?: string; blocks: any[] }>,
  assets: ConvertibleAsset[] = [],
  characters: ConvertibleCharacter[] = [],
  speakerColors: SpeakerColorsMap = {},
): string {
  // ラベル名の決定（ラベル＝ページの正規写像）:
  // ページ名が ASCII 識別子形式かつプロジェクト内で一意なら、ページ名をそのまま
  // ラベルにする（Tyrano 取込のラベル名を round-trip で保存する）。
  // それ以外（日本語ページ名等の既存プロジェクト）は従来どおり位置ラベル（start / pageN）
  // — 既存プロジェクトの出力・セーブ互換を変えないため意図的に ASCII 限定。
  const KS_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_\-.]*$/;
  const nameCount = new Map<string, number>();
  for (const p of pages) {
    if (p.name) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
  }
  const positional = (index: number) => (index === 0 ? 'start' : `page${index + 1}`);
  const positionalSet = new Set(pages.map((_, i) => positional(i)));
  const labelOf = (page: { name?: string }, index: number): string => {
    const n = page.name;
    if (
      n && KS_SAFE.test(n) && nameCount.get(n) === 1 &&
      (!positionalSet.has(n) || n === positional(index))
    ) {
      return n;
    }
    return positional(index);
  };

  const pageIdToLabel = new Map<string, string>();
  pages.forEach((page, index) => {
    if (page.id) pageIdToLabel.set(page.id, labelOf(page, index));
  });

  return pages
    .map((page, index) => {
      const pageNumber = index + 1;
      const primary = labelOf(page, index);
      // 先頭ページが名前ラベルでも *start への既存動線を保つ（エイリアス併記。
      // 連続ラベルは同一位置を指し、取込側 ksToPages は畳み込みで1ページへ戻す）
      const label = index === 0 && primary !== 'start' ? `*start\n*${primary}` : `*${primary}`;

      const header = [
        '; ========================================',
        `; Title: ${title || 'Untitled'}`,
        `; Page: ${pageNumber}`,
        '; ========================================',
        '',
      ].join('\n');

      // jump/call の page-id → label 解決を if/choice の nested ブロックまで再帰的に行う。
      // Why: 解決を top-level だけにすると、then/else や choice option 内の
      //      jump/call が生 page-id (例: "page-2") を抱えたまま emit され、
      //      ランタイム Parser が label を解決できず末尾に飛んでしまう。
      const resolveBlock = (b: any): any => {
        if ((b.type === 'jump' || b.type === 'call') && b.toPageId && pageIdToLabel.has(b.toPageId)) {
          return { ...b, toPageId: pageIdToLabel.get(b.toPageId) };
        }
        if (b.type === 'if') {
          return {
            ...b,
            thenBlocks: (b.thenBlocks || []).map(resolveBlock),
            elseBlocks: b.elseBlocks ? b.elseBlocks.map(resolveBlock) : b.elseBlocks,
          };
        }
        if (b.type === 'choice') {
          return {
            ...b,
            options: (b.options || []).map((opt: any) => ({
              ...opt,
              actions: (opt.actions || []).map(resolveBlock),
            })),
          };
        }
        return b;
      };
      // start ブロックはページ内で emit しない。従来は各ページが `*start` ラベルを
      // 重複 emit していた（blockToKsBlocks の start → *start）が、ページのアンカーは
      // 本関数が出すページラベルであり、重複 *start は jump 解決の曖昧さと
      // 再取込時の偽ページ分割を生むだけのため除外する。
      const resolvedBlocks = (page.blocks || [])
        .filter((b: any) => b.type !== 'start')
        .map(resolveBlock);

      const pageVar = `_page = ${pageNumber}\n_totalPages = ${pages.length}`;
      const script = blocksToKs(resolvedBlocks, assets, characters, speakerColors);

      // 各ページの末尾に @return を自動挿入する。
      // Why: ページは原則「サブルーチン」として CALL される可能性があるため、
      //      末尾で必ず RETURN して呼び出し元 (CALL の次 pc) に戻る必要がある。
      //      stack が空のとき RETURN は script を終了させる (runtime 仕様) ので、
      //      最初のページが CALL されずに最後まで進んだ場合は自然に終了する。
      //      明示的に次ページへ遷移したい場合は最後に @jump を置けば
      //      この @return は到達不能になり問題ない。
      return `${header}${label}\n${pageVar}\n${script}\n@return`;
    })
    .join('\n\n');
}
