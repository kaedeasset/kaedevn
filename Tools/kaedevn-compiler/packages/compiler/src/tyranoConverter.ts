/**
 * TyranoScript → KS の限定変換（入口）。
 * ノード列の走査・[if] ブロック・マクロ展開はここ、タグ 1 つの変換は tyrano/tags/ の表、
 * 動的ジャンプの静的展開は tyrano/dynamicVars、timeline 生成は tyrano/timeline に置く。
 */
import type { CompilerOptions } from './types/CompilerOptions.js';
import { Compiler } from './compiler/Compiler.js';
import {
  parseTyrano,
  normalizeTarget,
  type TyranoNode,
  type TyranoTagNode,
  type TyranoBlockNode,
} from './tyranoParser.js';

import {
  collectCharactersFromNodes,
  collectMacrosFromNodes,
  collectKeyframesFromNodes,
  convertCondition,
  type TyranoCharacter,
  type TyranoCharacterManifest,
  type TyranoMacro,
  type TyranoKeyframeDef,
} from './tyranoSemantics.js';
import type {
  ConvertContext,
  TagResult,
  TyranoConversionSummary,
  TyranoToKsResult,
  TyranoToScenarioResult,
} from './tyrano/types.js';
import { ctxMarkSupported, ctxMarkCommand, ctxAddIssue, ctxFlushChoices } from './tyrano/context.js';
import { tagArg, protectTextLine } from './tyrano/args.js';
import { scanDynamicVars } from './tyrano/dynamicVars.js';
import { rankConversion } from './tyrano/rank.js';
import { TAG_HANDLERS } from './tyrano/tags/index.js';

// パーサ層の型を再エクスポート（index.ts / 既存 import の互換維持）
export type {
  TyranoNode,
  TyranoSourceLocation,
  TyranoTextNode,
  TyranoTagNode,
  TyranoLabelNode,
  TyranoSpeakerNode,
  TyranoCommentNode,
  TyranoBlockNode,
} from './tyranoParser.js';
export { parseTyrano } from './tyranoParser.js';

// 意味論レイヤの API/型を再エクスポート（index.ts / 既存 import の互換維持）
export { collectCharacterManifest, collectMacros, collectKeyframes } from './tyranoSemantics.js';
export type { TyranoCharacter, TyranoCharacterExpression, TyranoCharacterManifest, TyranoMacro, TyranoKeyframeDef, TyranoKeyframeFrame } from './tyranoSemantics.js';

// 変換結果の型を再エクスポート（index.ts / 既存 import の互換維持）
export type {
  TyranoIssueSeverity,
  TyranoRank,
  TyranoConversionIssue,
  TyranoConversionSummary,
  TyranoToKsResult,
  TyranoToScenarioResult,
} from './tyrano/types.js';

export function convertTyranoToKs(
  source: string,
  options: {
    manifest?: TyranoCharacterManifest;
    macros?: Map<string, TyranoMacro>;
    keyframes?: Map<string, TyranoKeyframeDef>;
    /** シナリオルート相対のファイル名（例 "escape/chest.ks"）。
     *  動的ジャンプの静的展開（tyrano/dynamicVars.ts）に使う。 */
    fileName?: string;
  } = {},
): TyranoToKsResult {
  const ast = parseTyrano(source);

  // manifest: 外部（他ファイル）定義 + このファイル自身の定義をマージ
  const manifestMap = new Map<string, TyranoCharacter>();
  for (const c of options.manifest ?? []) manifestMap.set(c.slug, c);
  collectCharactersFromNodes(ast, manifestMap);
  const manifest = [...manifestMap.values()];

  // macros: 外部（他ファイル）定義 + このファイル自身の定義をマージ（後勝ち）
  const macros = new Map<string, TyranoMacro>(options.macros ?? []);
  collectMacrosFromNodes(ast, macros);

  // keyframes: 外部（他ファイル）定義 + このファイル自身の定義をマージ（後勝ち）
  const keyframes = new Map<string, TyranoKeyframeDef>(options.keyframes ?? []);
  collectKeyframesFromNodes(ast, keyframes);

  const ctx: ConvertContext = {
    issues: [],
    lines: [],
    commandCounts: {},
    supportedCommandCounts: {},
    unsupportedCommandCounts: {},
    supportedCount: 0,
    choiceBuffer: [],
    audioState: {},
    manifest,
    macros,
    macroStack: [],
    ptextCounter: 0,
    mtextCounter: 0,
    animStreak: 0,
    keyframes,
    timelines: {},
    spriteBases: new Map(),
    fileName: options.fileName,
    dyn: scanDynamicVars(ast),
    dynEmitted: new Set(),
  };

  processNodes(ast, ctx);
  ctxFlushChoices(ctx);

  const unsupportedCount = ctx.issues.filter((issue) => issue.severity === 'unsupported').length;
  const warningCount = ctx.issues.filter((issue) => issue.severity === 'warning').length;
  const summary: TyranoConversionSummary = {
    rank: rankConversion(unsupportedCount, warningCount, ctx.unsupportedCommandCounts),
    supportedCount: ctx.supportedCount,
    unsupportedCount,
    warningCount,
    commandCounts: ctx.commandCounts,
    supportedCommandCounts: ctx.supportedCommandCounts,
    unsupportedCommandCounts: ctx.unsupportedCommandCounts,
  };

  return {
    ks: ctx.lines.join('\n').replace(/\n{3,}/g, '\n\n'),
    ast,
    summary,
    issues: ctx.issues,
    manifest,
    timelines: ctx.timelines,
  };
}
/** ノード列を KS 行へ変換して ctx に追記する（トップレベルと if ブランチで共用・再帰可能）。 */
function processNodes(nodes: TyranoNode[], ctx: ConvertContext): void {
  for (const node of nodes) {
    if (node.type === 'tag' || node.type === 'block') ctxMarkCommand(ctx, node.name);

    // 選択肢バッファは glink/button/s 以外のノードが来たら確定する
    if (node.type !== 'tag' || (node.name !== 'glink' && node.name !== 'button' && node.name !== 's')) {
      ctxFlushChoices(ctx);
    }

    // [anim] の並行性差の warning: Tyrano は非同期並行、kaedevn の move は同期完了のため
    // 連続する [anim] は直列化され演出タイミングが変わる。連続グループごとに1回だけ警告する。
    if (node.type === 'tag' && node.name === 'anim') {
      ctx.animStreak++;
      if (ctx.animStreak === 2) {
        ctxAddIssue(ctx, node, 'warning', 'Consecutive [anim] tags run in parallel in Tyrano but are serialized in kaedevn; animation timing may differ.');
      }
    } else if (node.type === 'tag' || node.type === 'block') {
      ctx.animStreak = 0;
    }

    switch (node.type) {
      case 'comment':
        ctx.lines.push(`; ${node.text}`);
        break;
      case 'label':
        ctx.lines.push(`*${normalizeTarget(node.name)}`);
        break;
      case 'speaker':
        ctx.lines.push(`#${node.name}`);
        break;
      case 'text': {
        const text = node.text.trim();
        if (text) ctx.lines.push(protectTextLine(text));
        break;
      }
      case 'block':
        if (node.name === 'if') {
          convertIfBlock(node, ctx);
        } else if (node.name === 'macro' || node.name === 'keyframe') {
          // 宣言ブロック。収集パスで登録済みのため KS 本文には何も出さない（chara_new と同じ扱い）。
          ctxMarkSupported(ctx, node.name);
        } else {
          ctxAddIssue(ctx, node, 'unsupported', `Tyrano block [${node.name}] is not executed or converted automatically.`);
        }
        break;
      case 'tag': {
        if (!TAG_HANDLERS.has(node.name)) {
          const macro = ctx.macros.get(node.name);
          if (macro) {
            expandMacro(node, macro, ctx);
            break;
          }
          ctxAddIssue(ctx, node, 'unsupported', `Unsupported Tyrano tag: [${node.name}].`);
          break;
        }
        const converted = convertTag(node, ctx);
        if (converted.kind === 'choice') {
          ctx.choiceBuffer = converted.buffer;
          ctxMarkSupported(ctx, node.name);
          break;
        }
        if (converted.kind === 'lines') {
          ctx.lines.push(...converted.lines);
          ctxMarkSupported(ctx, node.name);
          if (converted.warning) ctxAddIssue(ctx, node, 'warning', converted.warning);
          break;
        }
        ctxAddIssue(ctx, node, converted.severity, converted.message);
        break;
      }
    }
  }
}

/**
 * [if]/[elsif]/[else]/[endif] ブロックを KS の if/else へ変換する。
 * 安全サブセット（単一比較・f./tf. スコープ）で全条件が変換できる場合のみ変換し、
 * 一つでもサブセット外なら全体を「手動移植対象」の診断にして本文を出力しない。
 * KS の tokenizer は `if (c) {` / `} else {` / `}` を各行独立でのみ受理するため、
 * elsif は `} else {` + `if (c) {` のネスト展開で表現する。
 */
function convertIfBlock(block: TyranoBlockNode, ctx: ConvertContext): void {
  // block.children を if/elsif/else の分岐に分割する（if の条件は block.args.exp）。
  // exp を持たない [if]/[elsif] は else と区別できるよう isElse で管理する
  // （cond === null だけだと exp 欠落の分岐が else 扱いになり素通りする）。
  const branches: Array<{ cond: string | null; isElse: boolean; nodes: TyranoNode[] }> = [
    { cond: tagArg(block, 'exp') ?? null, isElse: false, nodes: [] },
  ];
  for (const child of block.children) {
    if (child.type === 'tag' && child.name === 'elsif') {
      branches.push({ cond: tagArg(child, 'exp') ?? null, isElse: false, nodes: [] });
    } else if (child.type === 'tag' && child.name === 'else') {
      branches.push({ cond: null, isElse: true, nodes: [] });
    } else {
      branches[branches.length - 1].nodes.push(child);
    }
  }

  // 条件を変換。if/elsif（else 以外）が全て変換できなければ全体を診断のみにする。
  // exp 欠落（cond === null かつ非 else）もここで unconvertible に落とす。
  const conds = branches.map((b) => (b.cond === null ? null : convertCondition(b.cond)));
  const unconvertible = branches
    .map((b, i) => ({ b, c: conds[i] }))
    .filter((x) => !x.b.isElse && !(x.c && 'ks' in x.c));
  if (unconvertible.length > 0) {
    ctxAddIssue(
      ctx,
      block,
      'unsupported',
      `[if] condition(s) outside the safe subset: ${unconvertible.map((x) => (x.b.cond === null ? '(missing exp)' : `"${x.b.cond}"`)).join(' / ')}. Manual migration needed.`,
    );
    return;
  }

  ctxMarkSupported(ctx, 'if');
  const condKs = (i: number): string => (conds[i] as { ks: string }).ks;

  ctx.lines.push(`if (${condKs(0)}) {`);
  processNodes(branches[0].nodes, ctx);
  let elsifCount = 0;
  for (let i = 1; i < branches.length; i++) {
    ctx.lines.push('} else {');
    if (!branches[i].isElse) {
      elsifCount++;
      ctx.lines.push(`if (${condKs(i)}) {`);
    }
    processNodes(branches[i].nodes, ctx);
  }
  for (let k = 0; k < 1 + elsifCount; k++) ctx.lines.push('}');

  // tf. スコープ等の warning を集約
  for (const c of conds) {
    if (c && 'ks' in c && c.warning) ctxAddIssue(ctx, block, 'warning', c.warning);
  }
}

/** マクロ展開の深さ上限。超過は循環に準じた診断へ倒す。 */
const MACRO_DEPTH_LIMIT = 8;

/** マクロ本体の %param / %param|default 参照。default は空白・]・クォートの手前まで。 */
const MACRO_PARAM_RE = /%([A-Za-z_]\w*)(?:\|([^\s\]"']*))?/g;

/**
 * 作者定義マクロの呼び出しを展開する（P6-1）。
 * 本体（raw テキスト）の %param を実引数で置換 → parseTyrano で再パース → processNodes を再帰。
 * children のフラット列ではなく raw 再パースを使うことで、本体内の [if]…[endif] が正しくブロック化される。
 */
function expandMacro(node: TyranoTagNode, macro: TyranoMacro, ctx: ConvertContext): void {
  if (ctx.macroStack.includes(macro.name)) {
    ctxAddIssue(
      ctx,
      node,
      'unsupported',
      `[${macro.name}] macro expansion is cyclic (${[...ctx.macroStack, macro.name].join(' -> ')}); manual migration needed.`,
    );
    return;
  }
  if (ctx.macroStack.length >= MACRO_DEPTH_LIMIT) {
    ctxAddIssue(ctx, node, 'unsupported', `[${macro.name}] macro nesting exceeds depth ${MACRO_DEPTH_LIMIT}; manual migration needed.`);
    return;
  }
  // 置換値に " が入るとタグ属性のクォートを破壊して誤パースするため、展開せず診断に倒す
  for (const [key, value] of Object.entries(node.args)) {
    if (typeof value === 'string' && value.includes('"')) {
      ctxAddIssue(ctx, node, 'unsupported', `[${macro.name}] argument "${key}" contains a double quote; expansion would break tag quoting. Manual migration needed.`);
      return;
    }
  }

  const substituted = macro.body.replace(MACRO_PARAM_RE, (_m, name: string, def: string | undefined) => {
    const v = node.args[name];
    if (typeof v === 'string') return v;
    if (v === true) return 'true';
    return def ?? '';
  });

  ctx.macroStack.push(macro.name);
  processNodes(parseTyrano(substituted), ctx);
  ctx.macroStack.pop();
  ctxMarkSupported(ctx, node.name);
}

export function convertTyranoToScenario(source: string, options: CompilerOptions = {}): TyranoToScenarioResult {
  const result = convertTyranoToKs(source);
  const compiler = new Compiler();
  return {
    ...result,
    scenario: compiler.compile(result.ks, options),
  };
}

/** タグ 1 つを表の変換関数へ渡す。表に無いタグは未対応の診断。 */
function convertTag(node: TyranoTagNode, ctx: ConvertContext): TagResult {
  const handler = TAG_HANDLERS.get(node.name);
  if (!handler) return { kind: 'issue', severity: 'unsupported', message: `Unsupported Tyrano tag: [${node.name}].` };
  return handler(node, ctx, (name) => tagArg(node, name));
}
