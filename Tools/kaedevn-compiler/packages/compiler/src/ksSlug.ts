/**
 * KS ファイル名・ラベル名のスラグ化（filesToKs と ksToKscB が共有する）。
 */

/** `.ks` / `.ksc` 拡張子（大文字小文字を問わない）。 */
export const KS_EXT_RE = /\.ksc?$/i;

/** パスやラベルをラベル用スラグへ（拡張子除去・区切りや非英数を _ に・前後の _ を落とす）。 */
export function toSlug(name: string): string {
  return name
    .trim()
    .replace(KS_EXT_RE, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
