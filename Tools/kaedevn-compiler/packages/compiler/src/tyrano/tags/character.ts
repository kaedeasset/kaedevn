/**
 * キャラクターのタグ（[chara_*]）。
 */
import { sanitizeId, storageToId } from '../../tyranoParser.js';
import { resolveExpression } from '../../tyranoSemantics.js';
import { msArg, tyranoPosition, bucketPixelToPosition } from '../args.js';
import type { TagHandler } from '../types.js';

// 宣言タグ。manifest 収集パスで処理済みのため KS 本文には何も出さない。
const declaration: TagHandler = () => ({ kind: 'lines', lines: [] });

export const characterTags: Record<string, TagHandler> = {
  chara_new: declaration,
  chara_face: declaration,
  chara_ptext: (_node, ctx, arg) => {
    // ネームプレートへの話者名表示 → KS の話者行。manifest に居れば表示名（jname）、無ければ slug。
    const name = arg('name');
    if (!name) return { kind: 'issue', severity: 'warning', message: '[chara_ptext] has no name attribute.' };
    const slug = sanitizeId(name);
    const char = ctx.manifest.find((c) => c.slug === slug);
    return { kind: 'lines', lines: [`#${char?.name ?? slug}`] };
  },
  chara_show: (_node, ctx, arg) => {
    const name = arg('name') ?? storageToId(arg('storage') ?? 'character');
    const pos = tyranoPosition(arg('pos') ?? arg('position'));
    const slug = sanitizeId(name);
    const storage = arg('storage');
    const resolved = resolveExpression(ctx.manifest, slug, { mode: 'show', storage });
    return { kind: 'lines', lines: [`@ch ${slug} ${resolved.expr} ${pos}`], warning: resolved.warning };
  },
  chara_hide: (_node, _ctx, arg) => {
    const name = arg('name');
    if (!name) return { kind: 'issue', severity: 'warning', message: '[chara_hide] has no name attribute.' };
    return { kind: 'lines', lines: [`@ch_hide ${sanitizeId(name)}`] };
  },
  chara_hide_all: (_node, _ctx, arg) => {
    const fade = msArg(arg('time'));
    return { kind: 'lines', lines: [`@ch_clear${fade !== undefined ? ` fade=${fade}` : ''}`] };
  },
  chara_mod: (_node, ctx, arg) => {
    const name = arg('name');
    const face = arg('face');
    const storage = arg('storage');
    if (!name || (!face && !storage)) {
      return { kind: 'issue', severity: 'warning', message: '[chara_mod] requires name and (face or storage).' };
    }
    const slug = sanitizeId(name);
    const resolved = resolveExpression(ctx.manifest, slug, { mode: 'mod', face, storage });
    return { kind: 'lines', lines: [`@ch_expr ${slug} ${resolved.expr}`], warning: resolved.warning };
  },
  chara_move: (_node, _ctx, arg) => {
    const name = arg('name');
    if (!name) return { kind: 'issue', severity: 'warning', message: '[chara_move] has no name attribute.' };
    const leftRaw = arg('left');
    const left = leftRaw !== undefined ? Number(leftRaw) : undefined;
    const pos = left !== undefined && Number.isFinite(left) ? bucketPixelToPosition(left) : 'center';
    const time = msArg(arg('time'));
    return {
      kind: 'lines',
      lines: [`@ch_move ${sanitizeId(name)} ${pos}${time !== undefined ? ` time=${time}` : ''}`],
      warning: `[chara_move] pixel position (left=${leftRaw ?? '?'}) approximated to "${pos}"; kaedevn @ch_move uses named slots (left/center/right).`,
    };
  },
};
