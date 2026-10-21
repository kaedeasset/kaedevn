/**
 * Internal: editor block → KsBlock[] conversion (the bulk of the serializer).
 * Split out of ksConverter.ts to keep each file under the size budget.
 * Blocks are accepted as `any` to avoid coupling with editor-specific types;
 * dispatch is on `block.type` (always a string).
 */
import { normalizePosition } from './parser/position.js';
import { splitCommandLine } from './parser/splitCommandLine.js';
import type { KsBlock } from './types/KsAST.js';

/** Minimal asset reference for slug resolution */
export interface ConvertibleAsset {
  id: string;
  slug?: string;
}

/** Minimal character definition for slug/expression resolution */
export interface ConvertibleCharacter {
  id?: string;
  slug: string;
  name?: string;
  expressions: Array<{
    id?: string;
    slug: string;
    kind?: string;
  }>;
}

/** 話者ごとの枠色マップ（key: speaker、空文字 "" はナレーション） */
export type SpeakerColorsMap = Record<string, { nameColor?: string; bodyColor?: string }>;

/**
 * Expand inline tags in text body.
 * [e:smile] → @ch_expr speaker smile, [m:idle] → @ch_motion, etc.
 */
export function expandInlineTags(
  body: string,
  speaker?: string,
): Array<{ text: string } | { command: string }> {
  const segments: Array<{ text: string } | { command: string }> = [];
  const tagPattern = /\[([^\]]+)\]/g;
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: body.slice(lastIndex, match.index) });
    }

    const tagContent = match[1];
    const [tagType, ...tagArgs] = tagContent.split(':');

    switch (tagType) {
      case 'e':
        if (speaker && tagArgs[0]) {
          segments.push({ command: `@ch_expr ${speaker} ${tagArgs[0]}` });
        }
        break;
      case 'm':
        if (speaker && tagArgs[0]) {
          segments.push({ command: `@ch_motion ${speaker} ${tagArgs[0]}` });
        }
        break;
      case 'lip':
        if (speaker && tagArgs[0]) {
          const mode = tagArgs[0] === 'off' ? 'off' : 'auto';
          segments.push({ command: `@ch_lip ${speaker} ${mode}` });
        }
        break;
      case 'wait':
        if (tagArgs[0]) {
          const ms = parseInt(tagArgs[0], 10);
          const sec = ms / 1000;
          segments.push({ command: `@wait ${sec}` });
        }
        break;
      case 'click':
        segments.push({ command: '@l' });
        break;
      case 'cam':
        if (tagArgs[0] === 'shake') {
          segments.push({ command: '@shake' });
        }
        break;
      default:
        segments.push({ text: match[0] });
        break;
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ text: body.slice(lastIndex) });
  }

  return segments;
}
// ===== Internal: block → KsBlock[] conversion =====

/** 変換中のブロックに共通の材料。id は block.id、無ければ親 id＋連番（決定的）。 */
interface BlockContext {
  id: string;
  assets: ConvertibleAsset[];
  characters: ConvertibleCharacter[];
  lastSpeakerSlug?: string;
  speakerColors: SpeakerColorsMap;
}

type BlockHandler = (block: any, ctx: BlockContext) => KsBlock[];

/** 出力の行番号（ブロック変換はソース行を持たない） */
const LINE = 0;

function commandBlock(
  id: string,
  command: string,
  raw: string,
  args: Record<string, any> = {},
  positional?: string[],
): KsBlock {
  return { id, type: 'command', line: LINE, raw, command, ...(positional ? { positional } : {}), args };
}

function textBlock(id: string, raw: string): KsBlock {
  return { id, type: 'text', line: LINE, raw, content: raw };
}

function speakerBlock(id: string, name: string): KsBlock {
  return { id, type: 'command', line: LINE, raw: `#${name}`, command: 'speaker', content: name };
}

/** キャラを slug → id の順で引く（blocksToKs の話者追跡も同じ規則を使う） */
export function resolveCharacter(
  characters: ConvertibleCharacter[],
  ref: string | undefined,
): ConvertibleCharacter | undefined {
  return characters.find(c => c.slug === ref) || characters.find(c => c.id === ref);
}

/** キャラの slug。定義に無ければ参照をそのまま使う */
export function characterSlug(characters: ConvertibleCharacter[], ref: string | undefined): string | undefined {
  return resolveCharacter(characters, ref)?.slug || ref;
}

function resolveExpression(character: ConvertibleCharacter | undefined, ref: string | undefined) {
  return character?.expressions.find(e => e.slug === ref) || character?.expressions.find(e => e.id === ref);
}

/** 素材の slug。定義に無ければ assetId をそのまま使う */
function assetSlug(ctx: BlockContext, assetId: string | undefined): string | undefined {
  return ctx.assets.find(a => a.id === assetId)?.slug || assetId;
}

/** x / y / s の省略規則（x・y は 0、s は 1 なら出さない） */
function transformEntries(block: { x?: number; y?: number; s?: number }): Array<[string, number]> {
  const entries: Array<[string, number]> = [];
  if (block.x != null && block.x !== 0) entries.push(['x', block.x]);
  if (block.y != null && block.y !== 0) entries.push(['y', block.y]);
  if (block.s != null && block.s !== 1) entries.push(['s', block.s]);
  return entries;
}

function withTransform<T extends Record<string, any>>(args: T, block: any): T {
  for (const [k, v] of transformEntries(block)) (args as Record<string, any>)[k] = v;
  return args;
}

function transformSuffix(block: { x?: number; y?: number; s?: number }): string {
  return transformEntries(block).map(([k, v]) => ` ${k}=${v}`).join('');
}

/** 立ち位置（L/C/R）。表に無ければ center */
function stagePosition(pos: string | undefined): string {
  return normalizePosition(pos) ?? 'center';
}

/** `"本文"` 用に引用符と改行を逃がす */
function quoteEscape(text: string): string {
  return text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** 名前付き引数を値があるものだけ詰める（undefined / null は出さない） */
function definedArgs(pairs: Array<[string, any]>): Record<string, any> {
  const args: Record<string, any> = {};
  for (const [k, v] of pairs) if (v != null) args[k] = v;
  return args;
}

function convertText(block: any, ctx: BlockContext): KsBlock[] {
  const { id } = ctx;
  // 話者単位の色設定を参照（speakerColors[block.speaker || ""]）。
  // 同じ speaker キーを持つ全 text ブロックで同じ色になる。
  // すべての text ブロックで色を明示する（前ブロックの色が引きずられないようにする）
  const colors = ctx.speakerColors[block.speaker || ''] || {};
  const styleArgs = { nameColor: colors.nameColor || 'default', bgColor: colors.bodyColor || 'default' };
  const result: KsBlock[] = [
    commandBlock(`${id}-style`, 'text_style', `@text_style nameColor ${styleArgs.nameColor} bgColor ${styleArgs.bgColor}`, styleArgs),
    // text ブロックは毎回 #<speaker> を出す（前ブロックからの話者漏れ防止）。
    // ナレーション（空話者）は "ナレーション" 固定表示。
    speakerBlock(`${id}-speaker`, block.speaker || 'ナレーション'),
  ];
  const body: string = block.body || '';

  // インラインタグ用に話者キャラを引く
  const tagSpeakerChar = block.speaker
    ? (ctx.characters.find(c => c.slug === block.speaker) || ctx.characters.find(c => c.name === block.speaker))
    : undefined;
  const tagSpeaker = tagSpeakerChar?.slug || ctx.lastSpeakerSlug;
  if (tagSpeaker && body.includes('[')) {
    expandInlineTags(body, tagSpeaker).forEach((seg, segIdx) => {
      if ('text' in seg && seg.text) {
        result.push(textBlock(`${id}-seg${segIdx}`, seg.text));
      } else if ('command' in seg) {
        const [head, ...rest] = seg.command.split(' ');
        const args: Record<string, boolean> = {};
        for (const a of rest) args[a] = true;
        result.push(commandBlock(`${id}-seg${segIdx}`, head.replace('@', ''), seg.command, args));
      }
    });
  } else {
    // body 内の \n はメッセージ内改行。KsPrinter は content をそのまま複数行に
    // 出してしまい 1 行 = 1 テキストとして再パースされるため、@r（TEXT_NL）を
    // 挟んだ行分割で emit する（import 側 ksToBlocks の @r→\n マージと対称）
    body.split('\n').forEach((ln, i) => {
      if (i > 0) result.push(commandBlock(`${id}-r${i}`, 'r', '@r'));
      if (ln) result.push(textBlock(`${id}-ln${i}`, ln));
    });
  }

  result.push(commandBlock(`${id}-l`, 'l', '@l'));
  return result;
}

function convertBg(block: any, ctx: BlockContext): KsBlock[] {
  const storage = assetSlug(ctx, block.assetId);
  return [commandBlock(ctx.id, 'bg', `@bg ${storage}${transformSuffix(block)}`, withTransform({ [storage as string]: true }, block))];
}

function convertCh(block: any, ctx: BlockContext): KsBlock[] {
  const character = resolveCharacter(ctx.characters, block.characterId);
  const charSlug = character?.slug || block.characterId;
  // characterId が空 → KSC 出力をスキップ
  if (!charSlug) return [];

  // 旧フォーマット互換: ch ブロックに visible:false が付いていれば退場として扱う。
  // restage-characters.mjs など API 直投入のデータは editor の migration を通らず
  // {type:'ch', visible:false} のまま残るため、ここで @ch_hide に正規化する。
  if (block.visible === false) {
    return [commandBlock(ctx.id, 'ch_hide', `@ch_hide ${charSlug}`, { [charSlug]: true })];
  }

  const expression = resolveExpression(character, block.expressionId);
  const exprSlug = expression?.slug || block.expressionId || 'default';
  const position = stagePosition(block.pos);
  const args = withTransform({ [charSlug]: true, [exprSlug]: true, [position]: true }, block);
  // animated expression → @ch_anim
  const command = expression?.kind === 'animated' ? 'ch_anim' : 'ch';
  return [commandBlock(ctx.id, command, `@${command} ${charSlug} ${exprSlug} ${position}${transformSuffix(block)}`, args)];
}

function convertChHide(block: any, ctx: BlockContext): KsBlock[] {
  const charSlug = characterSlug(ctx.characters, block.characterId);
  if (!charSlug) return [];
  return [commandBlock(ctx.id, 'ch_hide', `@ch_hide ${charSlug}`, { [charSlug]: true })];
}

function convertChExpr(block: any, ctx: BlockContext): KsBlock[] {
  const character = resolveCharacter(ctx.characters, block.characterId);
  const charSlug = character?.slug || block.characterId;
  if (!charSlug) return [];
  const exprSlug = resolveExpression(character, block.expressionId)?.slug || block.expressionId;
  if (!exprSlug) return [];
  return [commandBlock(ctx.id, 'ch_expr', `@ch_expr ${charSlug} ${exprSlug}`, { [charSlug]: true, [exprSlug]: true })];
}

function convertChMove(block: any, ctx: BlockContext): KsBlock[] {
  const charSlug = characterSlug(ctx.characters, block.characterId);
  if (!charSlug) return [];
  const position = stagePosition(block.pos);
  const args: Record<string, boolean | number> = { [charSlug]: true, [position]: true };
  // duration は名前付き引数 time=N で出力（整数キーが KsPrinter で並べ替えられるのを避ける）
  if (block.durationMs != null) args.time = block.durationMs;
  const time = block.durationMs != null ? ` time=${block.durationMs}` : '';
  return [commandBlock(ctx.id, 'ch_move', `@ch_move ${charSlug} ${position}${time}`, args)];
}

function convertLive2dCh(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.modelId) return [];
  return [commandBlock(ctx.id, 'live2d', `@live2d ${block.modelId}`, {
    [block.modelId]: true, path: block.modelPath, motion: block.motionGroup, index: String(block.motionIndex),
    x: String(block.x), y: String(block.y), scale: String(block.scale),
  })];
}

function convertLive2dHide(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.modelId) return [];
  return [commandBlock(ctx.id, 'live2d_hide', `@live2d_hide ${block.modelId}`, { [block.modelId]: true })];
}

function convertLive2dMotion(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.modelId) return [];
  return [commandBlock(ctx.id, 'live2d_motion', `@live2d_motion ${block.modelId} ${block.motionGroup} ${block.motionIndex}`,
    { [block.modelId]: true, [block.motionGroup]: true, index: String(block.motionIndex) })];
}

function convertLive2dExpression(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.modelId || !block.expression) return [];
  return [commandBlock(ctx.id, 'live2d_expression', `@live2d_expression ${block.modelId} ${block.expression}`,
    { [block.modelId]: true, [block.expression]: true })];
}

function vrmExpressionBlock(id: string, expression: string): KsBlock {
  return commandBlock(id, 'vrmExpression', `@vrmExpression ${expression}`, { [expression]: true });
}

function vrmPoseBlock(id: string, pose: string): KsBlock {
  return commandBlock(id, 'vrmPose', `@vrmPose ${pose}`, { [pose]: true });
}

function convertVrm(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.modelId) return [];
  const { id } = ctx;
  const position = stagePosition(block.pos);
  const vrmArgs: Record<string, any> = { [block.modelId]: true, pos: position };
  if (block.fadeMs) vrmArgs.fade = block.fadeMs;
  if (block.rotY) vrmArgs.rotY = block.rotY;
  // transform（位置・スケール）はエディタの buildVrmShowLines と同じデフォルト基準で
  // emit する。これが無いと editor preview には出るのに Play で反映されない。
  const blocks: KsBlock[] = [
    commandBlock(`${id}-mode`, 'sceneMode', '@sceneMode vrm', { vrm: true }),
    commandBlock(id, 'vrmShow', `@vrmShow ${block.modelId} pos=${position}${transformSuffix(block)}`, withTransform(vrmArgs, block)),
  ];
  if (block.expression && block.expression !== 'neutral') blocks.push(vrmExpressionBlock(`${id}-expr`, block.expression));
  // idle / aPose どちらも emit する（runtime 側 applyPose で区別される）
  if (block.pose) blocks.push(vrmPoseBlock(`${id}-pose`, block.pose));
  return blocks;
}

function convertVrmHide(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.modelId) return [];
  const args: Record<string, any> = {};
  if (block.fadeMs != null) args.fade = block.fadeMs;
  return [
    commandBlock(ctx.id, 'vrmHide', block.fadeMs != null ? `@vrmHide fade ${block.fadeMs}` : '@vrmHide', args),
    // 3D ビューポートを 2D に戻す (VRM のみシーンを抜けると残像が残るため)
    commandBlock(`${ctx.id}-mode`, 'sceneMode', '@sceneMode 2d', { '2d': true }),
  ];
}

function convertIf(block: any, ctx: BlockContext): KsBlock[] {
  // ランタイムの Tokenizer は `if (cond) { ... }` 形式しか認識しない
  // （@if / @endif のコマンド形式は UNKNOWN_COMMAND になる）。
  // editor の getBlockScript と同じ block syntax で emit する。
  const conditionStr = (block.conditions || [])
    .map((c: any, idx: number, arr: any[]) => {
      const base = `${c.variable || c.varName} ${c.operator || '=='} ${c.value}`;
      return idx < arr.length - 1 && c.logicalOp ? `${base} ${c.logicalOp}` : base;
    })
    .join(' ');
  const { id } = ctx;
  const nested = (blocks: any[], part: string) =>
    blocks.flatMap((b: any, i: number) => blockToKsBlocks(b, ctx.assets, ctx.characters, undefined, {}, `${id}-${part}${i}`));

  const result: KsBlock[] = [textBlock(`${id}-open`, `if (${conditionStr}) {`), ...nested(block.thenBlocks || [], 'then')];
  if (block.elseBlocks?.length) {
    result.push(textBlock(`${id}-else`, '} else {'), ...nested(block.elseBlocks, 'else'));
  }
  result.push(textBlock(`${id}-close`, '}'));
  return result;
}

function convertJump(block: any, ctx: BlockContext): KsBlock[] {
  // 空の toPageId は no-op として捨てる（editor が分岐末尾に空 jump を入れることがある）。
  if (!block.toPageId) return [];
  // ランタイム Parser は args[0] をラベル名として読む。
  // key=value 形式（target=...）だと "target=label" がそのままラベル名扱いになり、
  // "Label not found" 警告で常に最後に飛んでしまう。
  return [commandBlock(ctx.id, 'jump', `@jump ${block.toPageId}`, { [block.toPageId]: true })];
}

function convertSetVar(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.varName) return [];
  // Emit as raw expression line (e.g. `score += 10`). The KSC runtime
  // parses this directly; the legacy `@set_var name= op= val=` form is
  // unknown to commandRegistry and would throw UNKNOWN_COMMAND at runtime.
  return [textBlock(ctx.id, `${block.varName} ${block.operator} ${block.value}`)];
}

/** 選択肢の中の 1 アクション（set_var / text / jump）。id は選択肢の id＋連番 */
function choiceActionBlocks(act: any, actId: string): KsBlock[] {
  if (act.type === 'set_var') {
    return [textBlock(actId, `${act.varName} ${act.operator} ${act.value}`)];
  }
  if (act.type === 'text') {
    // speaker は `#name` 行、本文はそのまま、終端の `@l` でクリック待ち。
    return [
      ...(act.speaker ? [speakerBlock(`${actId}-speaker`, act.speaker)] : []),
      textBlock(`${actId}-body`, act.body),
      commandBlock(`${actId}-l`, 'l', '@l'),
    ];
  }
  if (act.type === 'jump' && act.toPageId) {
    return [commandBlock(actId, 'jump', `@jump ${act.toPageId}`, { [act.toPageId]: true })];
  }
  return [];
}

function convertChoice(block: any, ctx: BlockContext): KsBlock[] {
  // ランタイムの Tokenizer は `choice { "label" { ... } }` 形式を期待する。
  // KsPrinter は type:'choice' を扱わないため、text-line として直接 emit する。
  const result: KsBlock[] = [textBlock(`${ctx.id}-open`, 'choice {')];
  (block.options || []).forEach((opt: any, i: number) => {
    const optId = opt.id || `${ctx.id}-opt${i}`;
    const condStr = opt.condition ? ` if (${opt.condition})` : '';
    result.push(textBlock(`${optId}-open`, `"${opt.text}"${condStr} {`));
    (opt.actions || []).forEach((act: any, j: number) => result.push(...choiceActionBlocks(act, `${optId}-act${j}`)));
    result.push(textBlock(`${optId}-close`, '}'));
  });
  result.push(textBlock(`${ctx.id}-close`, '}'));
  return result;
}

/** effect の種類 → コマンド名（表に無い種類は @effect） */
const EFFECT_COMMANDS: Record<string, string> = {
  shake: 'shake', flash: 'flash', fade_black: 'fade_black', fade_white: 'fade_white', black_in: 'black_in', white_in: 'white_in',
};

function convertEffect(block: any, ctx: BlockContext): KsBlock[] {
  const { id } = ctx;
  const dur = block.duration ?? 500;

  // vignette / blur は @filter のショートカット。effect ブロックの
  // duration を活かすため「適用 → 待機 → 解除」の 3 op に展開する。
  // これがないと filter が永続的にかかり続けて期待外。
  if (block.effect === 'vignette' || block.effect === 'blur') {
    // vignette は @filter vignette=0..1 (intensity 1-5 → 0.2..1.0)。
    // blur は @filter blur=N (N は GaussianBlur strength を screen pixel 単位
    // で受ける。default 4。intensity 1-5 → 2..10 にマップし、中央 (3) で
    // フィルター側 default よりやや強い 6 になるよう設定)。
    const isVignette = block.effect === 'vignette';
    const intensity = isVignette ? (block.intensity ?? 3) / 5 : (block.intensity ?? 3) * 2;
    const sec = dur / 1000;
    return [
      commandBlock(id, 'filter', '@filter', { [block.effect]: intensity }),
      commandBlock(`${id}-wait`, 'wait', `@wait ${sec}`, { sec }),
      commandBlock(`${id}-clear`, 'filter_clear', '@filter_clear'),
    ];
  }

  const cmd = Object.prototype.hasOwnProperty.call(EFFECT_COMMANDS, block.effect) ? EFFECT_COMMANDS[block.effect] : 'effect';
  const args: Record<string, any> = { duration: dur };
  if (cmd === 'shake') args.intensity = block.intensity ?? 3;
  return [commandBlock(id, cmd, `@${cmd}`, args)];
}

function filterTarget(args: Record<string, any>, block: any): void {
  if (block.target === 'bg' || block.target === 'ch') args.target = block.target;
}

function convertScreenFilter(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.filterType) return [commandBlock(ctx.id, 'filter_clear', '@filter_clear')];
  // filterType を「フィルタ名 = intensity」として持たせつつ、block.params
  // （bloom の centerX/centerY/area、vignette の radius/softness 等）と
  // target / pc98Tiling も全部 args に詰める。これらが落ちると play 側で
  // 固有スライダーが効かない。
  const args: Record<string, any> = { [block.filterType]: block.intensity ?? 0.5 };
  Object.assign(args, definedArgs(Object.entries(block.params || {})));
  filterTarget(args, block);
  if (block.filterType === 'pc98' && block.pc98Tiling) args.tiling = true;
  return [commandBlock(ctx.id, 'filter', '@filter', args)];
}

function convertFilterMix(block: any, ctx: BlockContext): KsBlock[] {
  const validLayers = (block.layers || []).filter((l: any) => l.filterType);
  if (validLayers.length === 0) return [commandBlock(ctx.id, 'filter_clear', '@filter_clear')];
  const args: Record<string, any> = {};
  for (const layer of validLayers) args[layer.filterType] = layer.intensity ?? 0.5;
  filterTarget(args, block);
  return [commandBlock(ctx.id, 'filter_mix', '@filter_mix', args)];
}

function convertOverlay(block: any, ctx: BlockContext): KsBlock[] {
  const slug = assetSlug(ctx, block.assetId) as string;
  const command = block.visible ? 'overlay' : 'overlay_hide';
  const args: Record<string, boolean | number> = { [slug]: true };
  if (block.visible) withTransform(args, block);
  return [commandBlock(ctx.id, command, `@${command} ${slug}${block.visible ? transformSuffix(block) : ''}`, args)];
}

function convertCamera(block: any, ctx: BlockContext): KsBlock[] {
  if (block.reset) return [commandBlock(ctx.id, 'camera', '@camera reset', { reset: true })];
  const args: Record<string, any> = {};
  if (block.x != null && block.x !== 0) args.x = block.x;
  if (block.y != null && block.y !== 0) args.y = block.y;
  if (block.zoom != null && block.zoom !== 1) args.zoom = block.zoom;
  if (block.time != null) args.time = block.time;
  if (block.easing) args.easing = block.easing;
  if (block.shake != null && block.shake !== 0) args.shake = block.shake;
  return [commandBlock(ctx.id, 'camera', '@camera', args)];
}

function particleArgs(b: any): Record<string, any> {
  const a: Record<string, any> = { [b.preset]: true };
  if (b.x != null) a.x = b.x;
  if (b.y != null) a.y = b.y;
  if (b.s != null && b.s !== 1) a.s = b.s;
  if (b.range != null && b.range !== 1) a.range = b.range;
  if (b.duration != null) a.duration = b.duration;
  if (b.intensity != null) a.intensity = b.intensity;
  if (b.blendMode === 'add') a.blend = 'add';
  return a;
}

function convertParticle(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.preset) return [];
  const { id } = ctx;
  // 新しい particle ブロックは前のエミッターを上書きする想定なので、メイン発火前に
  // @particle_stop を入れて累積を防ぐ。同一ブロック内の emitters[] は意図的な
  // 重ね合わせなので stop しない。
  const result: KsBlock[] = [
    commandBlock(`${id}-stop`, 'particle_stop', '@particle_stop'),
    commandBlock(id, 'particle', `@particle ${block.preset}`, particleArgs(block)),
  ];
  for (const em of (block.emitters || []) as any[]) {
    if (!em.preset) continue;
    // emitters[] には duration は無い（メインのみ）
    const { duration: _omitDuration, ...emNoDuration } = em;
    result.push(commandBlock(`${id}-em`, 'particle', `@particle ${em.preset}`, particleArgs(emNoDuration)));
  }
  return result;
}

function convertSlash(block: any, ctx: BlockContext): KsBlock[] {
  // 三日月スプライト + 残像のワンショット。パーティクルとは別経路。
  // color は editor では "#RRGGBB" 文字列で持つので 0xRRGGBB 形式に変換して emit する。
  const args: Record<string, any> = {
    x: block.x, y: block.y, angle: block.angle, length: block.length, duration: block.duration,
    color: (block.color || '#FFFFFF').replace(/^#/, '0x'), width: block.width,
  };
  if (block.blendMode === 'normal') args.blend = 'normal';
  return [commandBlock(ctx.id, 'slash', '@slash', args)];
}

function convertColorAdjust(block: any, ctx: BlockContext): KsBlock[] {
  if (block.brightness === 0 && block.contrast === 0 && block.saturation === 0 && block.temperature === 0) return [];
  const args: Record<string, any> = {
    brightness: block.brightness, contrast: block.contrast, saturation: block.saturation, temperature: block.temperature,
  };
  filterTarget(args, block);
  return [commandBlock(ctx.id, 'color_adjust', '@color_adjust', args)];
}

function convertScrollText(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.text) return [];
  // 本文は位置引数として emit する（@bg と同じパターン）。
  // 名前付き args { text: "..." } にすると KsPrinter が `text=...` を吐き、
  // parseScrollTextCommand が `text=` プレフィックスを本文に取り込んでしまう。
  const args: Record<string, any> = { [`"${quoteEscape(block.text)}"`]: true };
  if (block.speed != null) args.speed = block.speed;
  return [commandBlock(ctx.id, 'scroll_text', '@scroll_text', args)];
}

function convertCall(block: any, ctx: BlockContext): KsBlock[] {
  // 空 toPageId はno-op (editor が空セレクタ状態で保存することがある)
  const target = block.templateId || block.toPageId;
  if (!target) return [];
  // templateId 指定は旧来のテンプレート呼び出し。新規 toPageId はサブルーチン call。
  const command = block.templateId ? 'call_template' : 'call';
  return [commandBlock(ctx.id, command, `@${command} ${target}`, { [target]: true })];
}

/** 素材を位置引数に取る音のコマンド（@bgm / @se） */
function soundBlock(command: string, extra: Array<[string, any]>) {
  return (block: any, ctx: BlockContext): KsBlock[] => {
    const storage = assetSlug(ctx, block.assetId);
    if (!storage) return [];
    return [commandBlock(ctx.id, command, `@${command} ${storage}`, { [storage]: true, ...definedArgs(extra.map(([k, f]) => [k, block[f]])) })];
  };
}

/** 引数が名前付きだけのコマンド。pairs は [引数名, block のキー]（値が無いものは出さない） */
function namedArgsBlock(command: string, pairs: Array<[string, string]>) {
  return (block: any, ctx: BlockContext): KsBlock[] =>
    [commandBlock(ctx.id, command, `@${command}`, definedArgs(pairs.map(([k, f]) => [k, block[f]])))];
}

function convertTransition(block: any, ctx: BlockContext): KsBlock[] {
  const args: Record<string, string | number> = {};
  if (block.transType) args.type = block.transType;
  if (block.durationMs != null) args.time = block.durationMs;
  if (block.target) args.target = block.target;
  return [commandBlock(ctx.id, 'transition', '@transition', args)];
}

function convertWaitTransition(block: any, ctx: BlockContext): KsBlock[] {
  return [commandBlock(ctx.id, 'wait_transition', '@wait_transition', block.target ? { target: block.target } : {})];
}

function convertMask(block: any, ctx: BlockContext): KsBlock[] {
  const args: Record<string, string | number> = {};
  if (block.color) args.color = block.color;
  if (block.opacity != null) args.opacity = block.opacity;
  if (block.durationMs != null) args.time = block.durationMs;
  return [commandBlock(ctx.id, 'mask', '@mask', args)];
}

function convertLayer(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.name) return [];
  const args: Record<string, string | number> = { name: block.name };
  // visible は key=value で出す（bare `visible` だと parseLayerSetCommand が拾えない）
  if (block.visible != null) args.visible = block.visible ? 'true' : 'false';
  if (block.opacity != null) args.opacity = block.opacity;
  return [commandBlock(ctx.id, 'layer', `@layer name=${block.name}`, args)];
}

function convertTextClear(block: any, ctx: BlockContext): KsBlock[] {
  const target = block.target || 'all';
  return [commandBlock(ctx.id, 'text_clear', `@text_clear ${target}`, { [target]: true })];
}

function convertSprite(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.spriteId) return [];
  const storage = assetSlug(ctx, block.assetId);
  if (!storage) return [];
  // positional: <spriteId> <storage>、以降は名前付き。
  // args の { 値: true } キー表現は spriteId === storage でキーが潰れ、
  // 純数値 slug は integer-like キー並べ替えで順序が崩れるため positional で出す
  const args: Record<string, string | number> = {};
  if (block.layer) args.layer = block.layer;
  Object.assign(args, definedArgs([['x', block.x], ['y', block.y], ['opacity', block.opacity], ['fade', block.fadeMs]]));
  return [commandBlock(ctx.id, 'sprite', `@sprite ${block.spriteId} ${storage}`, args, [block.spriteId, storage])];
}

/** 先頭の位置引数が spriteId のコマンド（@sprite_move / @sprite_hide） */
function spriteIdBlock(command: string, pairs: Array<[string, string]>) {
  return (block: any, ctx: BlockContext): KsBlock[] => {
    if (!block.spriteId) return [];
    const args = { [block.spriteId]: true, ...definedArgs(pairs.map(([k, f]) => [k, block[f]])) };
    return [commandBlock(ctx.id, command, `@${command} ${block.spriteId}`, args)];
  };
}

function convertSpriteClear(block: any, ctx: BlockContext): KsBlock[] {
  const args: Record<string, string | number> = {};
  if (block.layer) args.layer = block.layer;
  if (block.fadeMs != null) args.fade = block.fadeMs;
  return [commandBlock(ctx.id, 'sprite_clear', '@sprite_clear', args)];
}

function convertTextSprite(block: any, ctx: BlockContext): KsBlock[] {
  if (!block.spriteId) return [];
  // 本文はクォートで囲む（@scroll_text と同じパターン）。
  // positional: <spriteId> "<本文>"、以降は名前付き（sprite と同じ理由で positional を使う）
  const quoted = `"${quoteEscape(block.text || '')}"`;
  const args: Record<string, string | number> = definedArgs([['x', block.x], ['y', block.y], ['size', block.size]]);
  if (block.color) args.color = block.color;
  // bold は key=value で出す（bare `bold` だと parseTextSpriteCommand が本文へ取り込む）
  if (block.bold) args.bold = 'true';
  if (block.layer) args.layer = block.layer;
  if (block.fadeMs != null) args.fade = block.fadeMs;
  return [commandBlock(ctx.id, 'text', `@text ${block.spriteId} ${quoted}`, args, [block.spriteId, quoted])];
}

function convertKsc(block: any, ctx: BlockContext): KsBlock[] {
  const script: string | undefined = block.script;
  if (!script) return [];
  if (script.startsWith(';')) {
    return [{ id: ctx.id, type: 'command', line: LINE, raw: script, command: 'comment', content: script.substring(1).trim() }];
  }
  if (script.startsWith('@')) {
    // 引数は positional で原文どおり再出力する（args: {} だと
    // `@timeline_play tl_x` の tl_x が落ちて compile が INVALID_ARGS になる）
    const { command, args } = splitCommandLine(script);
    return [commandBlock(ctx.id, command, script, {}, args)];
  }
  return [textBlock(ctx.id, script)];
}

/** 引数の無い固定のコマンド */
function fixedCommand(command: string, raw = `@${command}`): BlockHandler {
  return (_block, ctx) => [commandBlock(ctx.id, command, raw)];
}

/** block.type → 変換関数。表に無い type は何も出さない */
const BLOCK_HANDLERS: Record<string, BlockHandler> = {
  start: (_block, ctx) => [{ id: ctx.id, type: 'label', line: LINE, raw: '*start', content: 'start' }],
  text: convertText,
  bg: convertBg,
  ch: convertCh,
  ch_hide: convertChHide,
  ch_expr: convertChExpr,
  ch_move: convertChMove,
  live2d_ch: convertLive2dCh,
  live2d_hide: convertLive2dHide,
  live2d_motion: convertLive2dMotion,
  live2d_expression: convertLive2dExpression,
  vrm: convertVrm,
  vrm_hide: convertVrmHide,
  vrm_expression: (block, ctx) => (block.expression ? [vrmExpressionBlock(ctx.id, block.expression)] : []),
  vrm_pose: (block, ctx) => (block.pose ? [vrmPoseBlock(ctx.id, block.pose)] : []),
  if: convertIf,
  jump: convertJump,
  set_var: convertSetVar,
  choice: convertChoice,
  effect: convertEffect,
  screen_filter: convertScreenFilter,
  filter_mix: convertFilterMix,
  overlay: convertOverlay,
  timeline: (block, ctx) => [commandBlock(ctx.id, 'timeline_play', '@timeline_play', { id: block.id })],
  camera: convertCamera,
  particle: convertParticle,
  slash: convertSlash,
  color_adjust: convertColorAdjust,
  scroll_text: convertScrollText,
  call: convertCall,
  bgm: soundBlock('bgm', [['vol', 'vol'], ['fade', 'fadeMs']]),
  bgm_stop: namedArgsBlock('bgm_stop', [['fade', 'fadeMs']]),
  se: soundBlock('se', [['vol', 'vol']]),
  se_stop: fixedCommand('se_stop'),
  wait: (block, ctx) => (block.sec == null ? [] : [commandBlock(ctx.id, 'wait', `@wait ${block.sec}`, { sec: block.sec })]),
  transition: convertTransition,
  wait_transition: convertWaitTransition,
  mask: convertMask,
  mask_clear: namedArgsBlock('mask_clear', [['time', 'durationMs']]),
  layer: convertLayer,
  text_clear: convertTextClear,
  ch_clear: namedArgsBlock('ch_clear', [['fade', 'fadeMs']]),
  return: fixedCommand('return'),
  wait_camera: fixedCommand('wait_camera'),
  sprite: convertSprite,
  sprite_move: spriteIdBlock('sprite_move', [['x', 'x'], ['y', 'y'], ['opacity', 'opacity'], ['scale', 'scale'], ['time', 'durationMs']]),
  sprite_hide: spriteIdBlock('sprite_hide', [['fade', 'fadeMs']]),
  sprite_clear: convertSpriteClear,
  text_sprite: convertTextSprite,
  ksc: convertKsc,
};

/**
 * エディタのブロック 1 つを KsBlock[] へ変換する。fallbackId は block.id が無いときの id
 * （blocksToKs が並び順から決める。入れ子のブロックは親 id＋連番）。
 */
export function blockToKsBlocks(
  block: any,
  assets: ConvertibleAsset[],
  characters: ConvertibleCharacter[],
  lastSpeakerSlug?: string,
  speakerColors: SpeakerColorsMap = {},
  fallbackId = 'gen',
): KsBlock[] {
  const handler = Object.prototype.hasOwnProperty.call(BLOCK_HANDLERS, block.type) ? BLOCK_HANDLERS[block.type] : undefined;
  if (!handler) return [];
  return handler(block, { id: block.id || fallbackId, assets, characters, lastSpeakerSlug, speakerColors });
}
