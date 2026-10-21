import type { CompiledScenario } from '@kaedevn/core';
import type { CompilerOptions } from './types/CompilerOptions.js';
import { Compiler } from './compiler/Compiler.js';

export { CompilationException } from './types/CompilerError.js';
export type { CompilerError, ErrorCode } from './types/CompilerError.js';
export type { CompilerOptions, CompilerWarning } from './types/CompilerOptions.js';
export { Validator } from './validator/Validator.js';

// KS Parser exports
export { KsParser } from './parser/KsParser.js';
export { KsPrinter } from './parser/KsPrinter.js';
export { KsScanner } from './parser/KsScanner.js';
export type { KsAST, KsBlock, KsBlockType } from './types/KsAST.js';

// Block-to-KS conversion
export { blocksToKs, pagesToKs, expandInlineTags } from './ksConverter.js';
export type { ConvertibleAsset, ConvertibleCharacter } from './ksConverter.js';

// Asset reference extraction（シナリオが使うアセットの明示マニフェスト導出）
export { extractAssetRefs } from './assets/extractAssetRefs.js';
export type { AssetRefs } from './assets/extractAssetRefs.js';

// TyranoScript limited conversion
export { parseTyrano, convertTyranoToKs, convertTyranoToScenario, collectCharacterManifest, collectMacros, collectKeyframes } from './tyranoConverter.js';
export type { TyranoMacro, TyranoKeyframeDef, TyranoKeyframeFrame } from './tyranoConverter.js';
export { filesToKs } from './filesToKs.js';
export type { KsFile, FilesToKsIssue, FilesToKsIssueKind, FilesToKsResult } from './filesToKs.js';

// KS → KSC 変換（戦略B: 上位集合埋め込み。@シーンは execOp で素通し）
export { ksToKscB } from './ksToKscB.js';
export type { KsToKscBIssue, KsToKscBResult } from './ksToKscB.js';

// editor→KS→KSC 一気通貫（filesToKs リンク → ksToKscB 変換）
export { ksFilesToKsc } from './ksFilesToKsc.js';
export type { KsFilesToKscResult, KsToKscPipelineIssue } from './ksFilesToKsc.js';
export type {
  TyranoBlockNode,
  TyranoCharacter,
  TyranoCharacterExpression,
  TyranoCharacterManifest,
  TyranoCommentNode,
  TyranoConversionIssue,
  TyranoConversionSummary,
  TyranoIssueSeverity,
  TyranoLabelNode,
  TyranoNode,
  TyranoRank,
  TyranoSourceLocation,
  TyranoSpeakerNode,
  TyranoTagNode,
  TyranoTextNode,
  TyranoToKsResult,
  TyranoToScenarioResult,
} from './tyranoConverter.js';

// Line classification — 行種別判定の単一定義源
export { classifyLine } from './tokenizer/lineClassifier.js';
export type { LineType } from './types/Token.js';

// Command registry — 既知コマンド名の単一定義源（外部のツールが参照する）
export { KNOWN_COMMAND_NAMES, STANDALONE_COMMAND_NAMES } from './registry/commandRegistry.js';

// KSC 混在（P6-9）: @ 行テキスト → Op（KSC compile の atCommandParser として注入する）
export { parseKsCommandLine } from './parser/parseKsCommandLine.js';

/**
 * DSLソースをOp命令列にコンパイル
 */
export function compile(source: string, options: CompilerOptions = {}): CompiledScenario {
  const compiler = new Compiler();
  return compiler.compile(source, options);
}
