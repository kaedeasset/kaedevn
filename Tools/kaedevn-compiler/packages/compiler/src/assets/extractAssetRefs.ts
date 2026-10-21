import type { Op } from '@kaedevn/core';

/**
 * AssetRefs — シナリオ(Op IR)が実際に参照するアセットの集合。
 *
 * `keys` は data/<project>/assets.json のキー形式に揃える:
 *   - 背景/オーバーレイ: アセット id（例 "01KSC1EH43..."）
 *   - 立ち絵: "name:pose"（例 "hashim:sad"、assets.json の `${slug}:${expr}` と一致）
 * これにより fetch / pack / preload が同じキーで「使う物だけ」を絞れる。
 */
export interface AssetRefs {
  /** assets.json のキー（背景 id ＋ "name:pose"）。fetch/preload はこれを使う */
  keys: string[];
  bg: string[];
  ch: string[]; // "name:pose"
  bgm: string[];
  se: string[];
  voice: string[];
}

/**
 * コンパイル済み Op 列から、実際に参照されるアセットを抽出する。
 * ブラウザで作ったプロジェクト（= この Op 列の元）が「使う物」の単一の真実。
 * fetch-assets / pak / native preload が共通でこれを使い、未使用アセットの
 * ダウンロード・同梱・デコードを無くす。
 */
export function extractAssetRefs(ops: readonly Op[]): AssetRefs {
  const bg = new Set<string>();
  const ch = new Set<string>();
  const bgm = new Set<string>();
  const se = new Set<string>();
  const voice = new Set<string>();

  for (const op of ops) {
    switch (op.op) {
      case 'BG_SET':
      case 'OVERLAY_SET':
        if (op.id) bg.add(op.id);
        break;
      case 'CH_SET':
        if (op.name && op.pose) ch.add(`${op.name}:${op.pose}`);
        break;
      case 'BGM_PLAY':
        if (op.id) bgm.add(op.id);
        break;
      case 'SE_PLAY':
        if (op.id) se.add(op.id);
        break;
      case 'VOICE_PLAY':
        if (op.id) voice.add(op.id);
        break;
      default:
        break;
    }
  }

  const keys = [...bg, ...ch];
  return {
    keys,
    bg: [...bg],
    ch: [...ch],
    bgm: [...bgm],
    se: [...se],
    voice: [...voice],
  };
}
