/**
 * 立ち位置の表（@ch / @ch_anim / @ch_move / @vrmShow・ブロック変換・Tyrano 変換が共有する）。
 * 名前（left/center/right）と 1 文字（L/C/R）の両方を受ける。
 */
export type StagePosition = 'left' | 'center' | 'right';

const POSITIONS: Readonly<Record<string, StagePosition>> = {
  left: 'left', center: 'center', right: 'right',
  L: 'left', C: 'center', R: 'right',
};

/** 立ち位置の綴りを正規化する。表に無ければ undefined（呼び出し側が誤りか既定値かを決める）。 */
export function normalizePosition(raw: string | undefined): StagePosition | undefined {
  return raw != null && Object.prototype.hasOwnProperty.call(POSITIONS, raw) ? POSITIONS[raw] : undefined;
}
