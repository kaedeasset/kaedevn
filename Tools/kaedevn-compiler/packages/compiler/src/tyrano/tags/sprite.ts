/**
 * 画像・文字スプライトとアニメのタグ（[image] [ptext] [mtext] [anim] [kanim] [free] ほか）。
 */
import { sanitizeId, storageToId } from '../../tyranoParser.js';
import { msArg, intArg, findJsAttr, bucketPixelToPosition } from '../args.js';
import { buildTimelineFromKeyframes, buildMtextInEffect } from '../timeline.js';
import type { ArgFn, ConvertContext, TagHandler } from '../types.js';

/** `@text <id> "<text>"` の 1 行目（\ と " を逃がす）。 */
function textHead(id: string, text: string): string {
  return `@text ${id} "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** [mtext] の in_effect を timeline にして登録し、再生 id を返す。 */
function registerMtextTimeline(ctx: ConvertContext, id: string, inEffect: string, arg: ArgFn, warnings: string[]): string {
  const durationMs = msArg(arg('in_time')) ?? msArg(arg('time')) ?? 500;
  const built = buildMtextInEffect(inEffect, durationMs);
  if (built.approximated) warnings.push(`[mtext] in_effect "${inEffect}" approximated to a fade-in.`);
  const timelineId = `mtext_${id}__${sanitizeId(inEffect)}__${durationMs}`;
  ctx.timelines[timelineId] = {
    schemaVersion: 1,
    durationMs,
    tracks: [
      {
        id: `track_spr_${id}`,
        kind: 'entity',
        order: 0,
        enabled: true,
        targetId: `spr_${id}`,
        clips: [{ id: 'clip_0', startMs: 0, endMs: durationMs, channels: built.channels }],
      },
    ],
  };
  return timelineId;
}

const image: TagHandler = (_node, ctx, arg) => {
  // Tyrano [image] → @sprite（overlayLayer 上の自由配置画像）。
  // layer=background 相当は @bg に振る。id は name があれば name、無ければ storage basename。
  const storage = arg('storage');
  if (!storage) return { kind: 'issue', severity: 'warning', message: '[image] has no storage attribute.' };
  const layerRaw = (arg('layer') ?? '').toLowerCase();
  if (layerRaw === 'background' || layerRaw === 'bg') {
    return { kind: 'lines', lines: [`@bg ${storageToId(storage)}`] };
  }
  const id = sanitizeId(arg('name') ?? storageToId(storage));
  const layer = layerRaw === 'fore' || layerRaw === 'foreground' || layerRaw === 'front' ? 'front' : layerRaw === 'back' ? 'back' : undefined;
  const parts = [`@sprite ${id} ${storageToId(storage)}`];
  if (layer) parts.push(`layer=${layer}`);
  const x = intArg(arg('left') ?? arg('x'));
  const y = intArg(arg('top') ?? arg('y'));
  if (x !== undefined) parts.push(`x=${x}`);
  if (y !== undefined) parts.push(`y=${y}`);
  ctx.spriteBases.set(id, { x, y }); // [kanim] の base 相対差分化用に配置座標を記録
  return { kind: 'lines', lines: [parts.join(' ')] };
};

const ptext: TagHandler = (node, ctx, arg) => {
  // Tyrano [ptext] → @text（メッセージ枠外の固定座標テキストスプライト）。
  // JS 式属性（& 前置）は値が実行時依存のため診断に倒す。face は既定フォント固定で warning。
  const jsAttr = findJsAttr(node);
  if (jsAttr) {
    return { kind: 'issue', severity: 'unsupported', message: `[ptext] attribute "${jsAttr[0]}" uses a JS expression (&...); manual migration needed.` };
  }
  const text = arg('text');
  if (!text) return { kind: 'issue', severity: 'warning', message: '[ptext] has no text attribute.' };
  const id = sanitizeId(arg('name') ?? `ptext_${++ctx.ptextCounter}`);
  const parts = [textHead(id, text)];
  const x = intArg(arg('x') ?? arg('left'));
  const y = intArg(arg('y') ?? arg('top'));
  if (x !== undefined) parts.push(`x=${x}`);
  if (y !== undefined) parts.push(`y=${y}`);
  ctx.spriteBases.set(id, { x, y }); // [kanim] の base 相対差分化用に配置座標を記録
  const size = intArg(arg('size'));
  if (size !== undefined) parts.push(`size=${size}`);
  const color = arg('color');
  if (color !== undefined) parts.push(`color=${color.replace(/^0x/i, '#')}`);
  if (node.args.bold === true || arg('bold') === 'true') parts.push('bold=true');
  const layerRaw = (arg('layer') ?? '').toLowerCase();
  // Tyrano の layer は数値・message 面など多様だが、kaedevn は front/back のみ → back 以外は front に丸める
  if (layerRaw === 'back') parts.push('layer=back');
  const time = msArg(arg('time'));
  if (time !== undefined) parts.push(`fade=${time}`);
  const face = arg('face');
  return {
    kind: 'lines',
    lines: [parts.join(' ')],
    warning: face ? `[ptext] face "${face}" dropped; kaedevn @text uses the default font.` : undefined,
  };
};

const mtext: TagHandler = (node, ctx, arg) => {
  // Tyrano [mtext]（演出文字）→ @text + in_effect の生成 timeline（P6-7 = P6-2 + P6-5 の合成）。
  // Tyrano は文字単位（per-letter）アニメだが、初期は全体一括に丸める。
  const jsAttr = findJsAttr(node);
  if (jsAttr) {
    return { kind: 'issue', severity: 'unsupported', message: `[mtext] attribute "${jsAttr[0]}" uses a JS expression (&...); manual migration needed.` };
  }
  const text = arg('text');
  if (!text) return { kind: 'issue', severity: 'warning', message: '[mtext] has no text attribute.' };
  const id = sanitizeId(arg('name') ?? `mtext_${++ctx.mtextCounter}`);
  const parts = [textHead(id, text)];
  const x = intArg(arg('x') ?? arg('left'));
  const y = intArg(arg('y') ?? arg('top'));
  if (x !== undefined) parts.push(`x=${x}`);
  if (y !== undefined) parts.push(`y=${y}`);
  ctx.spriteBases.set(id, { x, y });
  const size = intArg(arg('size'));
  if (size !== undefined) parts.push(`size=${size}`);
  const color = arg('color');
  if (color !== undefined) parts.push(`color=${color.replace(/^0x/i, '#')}`);
  if (node.args.bold === true || arg('bold') === 'true' || arg('bold') === 'bold') parts.push('bold=true');

  const warnings: string[] = ['[mtext] per-letter animation approximated as whole-text.'];
  const knownAttrs = ['name', 'text', 'x', 'left', 'y', 'top', 'size', 'color', 'bold', 'in_effect', 'in_time', 'time', 'wait', 'layer'];
  const dropped = Object.keys(node.args).filter((k) => !knownAttrs.includes(k));
  if (dropped.length > 0) warnings.push(`[mtext] unsupported attribute${dropped.length > 1 ? 's' : ''} dropped: ${dropped.join(', ')}.`);

  const lines = [parts.join(' ')];
  const inEffect = arg('in_effect');
  if (inEffect) lines.push(`@timeline_play ${registerMtextTimeline(ctx, id, inEffect, arg, warnings)}`);
  return { kind: 'lines', lines, warning: warnings.join(' ') };
};

const anim: TagHandler = (node, ctx, arg) => {
  // Tyrano [anim] → 静的 transform + 時間。spr_ 空間の対象は @sprite_move、
  // キャラはスロット近似の @ch_move（@ch_move はピクセル座標不可）。
  const name = arg('name');
  if (!name) return { kind: 'issue', severity: 'warning', message: '[anim] has no name attribute.' };
  const jsAttr = findJsAttr(node);
  if (jsAttr) {
    return { kind: 'issue', severity: 'unsupported', message: `[anim] attribute "${jsAttr[0]}" uses a JS expression (&...); manual migration needed.` };
  }
  const slug = sanitizeId(name);
  const time = msArg(arg('time'));
  const knownAttrs = ['name', 'left', 'top', 'opacity', 'time', 'effect'];
  const dropped = Object.keys(node.args).filter((k) => !knownAttrs.includes(k));
  const droppedWarning = dropped.length > 0 ? `[anim] unsupported propert${dropped.length > 1 ? 'ies' : 'y'} dropped: ${dropped.join(', ')}.` : undefined;

  const isCharacter = ctx.manifest.some((c) => c.slug === slug);
  if (isCharacter) {
    const leftRaw = arg('left');
    const left = leftRaw !== undefined ? Number(leftRaw) : undefined;
    const pos = left !== undefined && Number.isFinite(left) ? bucketPixelToPosition(left) : 'center';
    return {
      kind: 'lines',
      lines: [`@ch_move ${slug} ${pos}${time !== undefined ? ` time=${time}` : ''}`],
      warning: `[anim] on character "${slug}" approximated to @ch_move ${pos} (pixel position / opacity not supported by slots).${droppedWarning ? ` ${droppedWarning}` : ''}`,
    };
  }

  const parts = [`@sprite_move ${slug}`];
  const x = intArg(arg('left'));
  const y = intArg(arg('top'));
  if (x !== undefined) parts.push(`x=${x}`);
  if (y !== undefined) parts.push(`y=${y}`);
  const opacityRaw = arg('opacity');
  if (opacityRaw !== undefined) {
    const v = parseFloat(opacityRaw);
    // Tyrano の opacity は 0〜255。1 以下はそのまま、超えるものは 255 基準で 0〜1 に正規化。
    if (!isNaN(v)) parts.push(`opacity=${v > 1 ? Math.round((v / 255) * 100) / 100 : v}`);
  }
  if (time !== undefined) parts.push(`time=${time}`);
  return { kind: 'lines', lines: [parts.join(' ')], warning: droppedWarning };
};

const kanim: TagHandler = (_node, ctx, arg) => {
  // Tyrano [kanim keyframe=K name=T time=D] → 既存 timeline（TimelineRoot）+ @timeline_play。
  const targetRaw = arg('name');
  const keyframeName = arg('keyframe');
  if (!targetRaw || !keyframeName) {
    return { kind: 'issue', severity: 'warning', message: '[kanim] requires name and keyframe attributes.' };
  }
  const def = ctx.keyframes.get(keyframeName.trim());
  if (!def || def.frames.length === 0) {
    return { kind: 'issue', severity: 'unsupported', message: `[kanim] keyframe "${keyframeName}" is not defined by [keyframe] (or has no frames).` };
  }
  const slug = sanitizeId(targetRaw);
  const durationMs = msArg(arg('time')) ?? 1000;
  const isCharacter = ctx.manifest.some((c) => c.slug === slug);
  // キャラは sprite キーがそのままの名前、それ以外は spr_ キー空間（TimelineDelegate が解決）
  const targetId = isCharacter ? slug : `spr_${slug}`;
  const timelineId = `${sanitizeId(keyframeName)}__${slug}__${durationMs}`;

  const built = buildTimelineFromKeyframes(def, durationMs, targetId, isCharacter ? undefined : ctx.spriteBases.get(slug));
  ctx.timelines[timelineId] = built.timeline;
  return {
    kind: 'lines',
    lines: [`@timeline_play ${timelineId}`],
    warning: built.warnings.length > 0 ? built.warnings.join(' ') : undefined,
  };
};

export const spriteTags: Record<string, TagHandler> = {
  image,
  ptext,
  mtext,
  anim,
  // [anim]/[kanim] 完了待ち。kaedevn の move / timelinePlay は同期完了のため no-op で正しい。
  wa: () => ({ kind: 'lines', lines: [] }),
  kanim,
  // [freeimage] は全画像レイヤの解放 → スプライト一括消去
  freeimage: (_node, _ctx, arg) => ({ kind: 'lines', lines: [`@sprite_clear${msArg(arg('time')) !== undefined ? ` fade=${msArg(arg('time'))}` : ''}`] }),
  free: (_node, _ctx, arg) => {
    // [free name=] は特定オブジェクトの解放 → 個別スプライト消去
    const name = arg('name');
    if (!name) return { kind: 'lines', lines: ['@sprite_clear'] };
    return { kind: 'lines', lines: [`@sprite_hide ${sanitizeId(name)}`] };
  },
};
