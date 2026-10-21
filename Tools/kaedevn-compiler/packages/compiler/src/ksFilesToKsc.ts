/**
 * editor→KS→KSC パイプライン（Hop1 + Hop2 の合成）。
 *
 * エディタ出力の KS ファイル群を、多ファイルリンク（`filesToKs`）→ KSC 変換（`ksToKscB`）
 * の順で1本の KSC 文字列にする。エディタの正は KS テキストなので、これが「editor→KS→KSC」
 * の一気通貫エントリになる。ブロックエディタ側は先に `blocksToKs`/`pagesToKs` で KS 化し、
 * その KS を本関数へ渡す。
 *
 * 設計: kaedevn(UE) Docs/Reports/2026/07/23/03。
 */
import { filesToKs, type KsFile } from './filesToKs.js';
import { ksToKscB } from './ksToKscB.js';

export interface KsToKscPipelineIssue {
  /** どの段で出た issue か。 */
  stage: 'link' | 'convert';
  severity: string;
  message: string;
  /** link 段のみ（該当ファイル）。 */
  file?: string;
  /** 1-based 行番号（link 段はファイル内、convert 段はリンク後 KS 内）。 */
  line?: number;
}

export interface KsFilesToKscResult {
  ksc: string;
  /** リンク後の単一 KS（デバッグ・中間確認用）。 */
  linkedKs: string;
  issues: KsToKscPipelineIssue[];
}

/**
 * KS ファイル群 → KSC。
 * @param files 変換済み KS テキストのファイル群（エディタ出力）。
 * @param entry 開始ファイル名（`files[].name` のいずれか）。
 */
export function ksFilesToKsc(files: KsFile[], entry: string): KsFilesToKscResult {
  const linked = filesToKs(files, entry);
  const converted = ksToKscB(linked.ks);

  const issues: KsToKscPipelineIssue[] = [
    ...linked.issues.map((i) => ({
      stage: 'link' as const,
      severity: i.severity,
      message: i.message,
      file: i.file,
      line: i.line,
    })),
    ...converted.issues.map((i) => ({
      stage: 'convert' as const,
      severity: i.severity,
      message: i.message,
      line: i.line,
    })),
  ];

  return { ksc: converted.ksc, linkedKs: linked.ks, issues };
}
