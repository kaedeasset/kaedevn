/**
 * Tyrano → KS 変換の型（公開の結果型と、変換中に共有する状態）。
 */
import type { CompiledScenario, TimelineRoot } from '@kaedevn/core';
import type { TyranoNode, TyranoTagNode } from '../tyranoParser.js';
import type { TyranoCharacterManifest, TyranoMacro, TyranoKeyframeDef } from '../tyranoSemantics.js';
import type { DynamicVarScan } from './dynamicVars.js';

export type TyranoIssueSeverity = 'info' | 'warning' | 'unsupported';
export type TyranoRank = 'A' | 'B' | 'C' | 'D';

export interface TyranoConversionIssue {
  severity: TyranoIssueSeverity;
  command: string;
  line: number;
  source: string;
  message: string;
}

export interface TyranoConversionSummary {
  rank: TyranoRank;
  supportedCount: number;
  unsupportedCount: number;
  warningCount: number;
  commandCounts: Record<string, number>;
  supportedCommandCounts: Record<string, number>;
  unsupportedCommandCounts: Record<string, number>;
}

/** キャラクター表情（editor-json の Expression 互換 + 元 storage を併記）。 */
export interface TyranoToKsResult {
  ks: string;
  ast: TyranoNode[];
  summary: TyranoConversionSummary;
  issues: TyranoConversionIssue[];
  /** シナリオ走査で収集したキャラクター定義（converted/characters.json に出力）。 */
  manifest: TyranoCharacterManifest;
  /** [kanim] から生成した timeline 群（converted/timelines.json に出力。setTimelines で注入）。 */
  timelines: Record<string, TimelineRoot>;
}

export interface TyranoToScenarioResult extends TyranoToKsResult {
  scenario: CompiledScenario;
}

export interface ChoiceBufferItem {
  label: string;
  target: string;
  /** ファイル跨ぎ選択肢（Tyrano [glink storage=]）。設定時は @jump <file> <label> を出す。 */
  file?: string;
}

/** [bgmopt]/[seopt] で設定された既定音量を後続の再生タグへ引き継ぐための状態。 */
export interface AudioState {
  bgmVol?: number;
  seVol?: number;
}

/** convertTyranoToKs / convertIfBlock が共有する変換状態。 */
export interface ConvertContext {
  issues: TyranoConversionIssue[];
  lines: string[];
  commandCounts: Record<string, number>;
  supportedCommandCounts: Record<string, number>;
  unsupportedCommandCounts: Record<string, number>;
  supportedCount: number;
  choiceBuffer: ChoiceBufferItem[];
  audioState: AudioState;
  manifest: TyranoCharacterManifest;
  macros: Map<string, TyranoMacro>;
  /** 展開中のマクロ名スタック（循環・深さ検出用）。 */
  macroStack: string[];
  /** name 属性の無い [ptext] の自動採番カウンタ。 */
  ptextCounter: number;
  /** [mtext] の自動採番カウンタ。 */
  mtextCounter: number;
  /** 連続する [anim] の数（Tyrano は並行・kaedevn は直列のためタイミング差 warning 用）。 */
  animStreak: number;
  /** [keyframe] 定義（[kanim] が TimelineRoot へ変換する際に参照）。 */
  keyframes: Map<string, TyranoKeyframeDef>;
  /** [kanim] から生成した timeline 群（timeline id → TimelineRoot）。 */
  timelines: Record<string, TimelineRoot>;
  /** [image]/[ptext] の配置座標（timeline の base 相対差分化に使う）。key は sprite id。 */
  spriteBases: Map<string, { x?: number; y?: number }>;
  /** シナリオルート相対のファイル名（動的ジャンプの静的展開に使用。未指定なら畳み込みしない）。 */
  fileName?: string;
  /** [eval] 代入とラベルのプリスキャン結果（tyrano/dynamicVars.ts）。 */
  dyn: DynamicVarScan;
  /** 変換出力に代入が既に現れた f.変数（Rule A/C の「代入が使用より前」判定。
   *  loc 行比較はマクロ展開でノード行がマクロ本体相対になり壊れるため、実出力順で追跡する）。 */
  dynEmitted: Set<string>;
}

/** タグ 1 つの変換結果。行・選択肢の蓄積・診断のいずれか。 */
export type TagLines = { kind: 'lines'; lines: string[]; warning?: string };
export type TagIssue = { kind: 'issue'; severity: TyranoIssueSeverity; message: string };
export type TagResult = TagLines | { kind: 'choice'; buffer: ChoiceBufferItem[] } | TagIssue;

/** タグの文字列属性を取り出す関数（タグ 1 つに束ねたもの）。 */
export type ArgFn = (name: string) => string | undefined;

/** タグ名 → 変換関数の表の 1 項目。 */
export type TagHandler = (node: TyranoTagNode, ctx: ConvertContext, arg: ArgFn) => TagResult;
