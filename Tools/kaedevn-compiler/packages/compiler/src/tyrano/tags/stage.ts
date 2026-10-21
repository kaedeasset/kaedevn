/**
 * 画面全体のタグ（背景・揺れ・トランジション・レイヤ・待ち・マスク・カメラ・フィルタ）。
 */
import { storageToId } from '../../tyranoParser.js';
import { msArg, intArg } from '../args.js';
import type { TagHandler } from '../types.js';

// kaedevn @filter と名前が一致する Tyrano [filter] 属性のみ変換対象にする。
const SHARED_FILTER_NAMES = new Set(['sepia', 'grayscale', 'blur']);

const quake: TagHandler = (node, _ctx, arg) => {
  const intensity = intArg(arg('hmax') ?? arg('vmax'));
  const duration = msArg(arg('time'));
  const parts = ['@shake'];
  if (intensity !== undefined) parts.push(`intensity=${intensity}`);
  if (duration !== undefined) parts.push(`duration=${duration}`);
  const line = parts.join(' ');
  if (node.name === 'quake2') {
    return { kind: 'lines', lines: [line], warning: '[quake2] approximated to @shake (directional/count parameters dropped).' };
  }
  return { kind: 'lines', lines: [line] };
};

export const stageTags: Record<string, TagHandler> = {
  bg: (_node, _ctx, arg) => {
    const storage = arg('storage');
    if (!storage) return { kind: 'issue', severity: 'warning', message: '[bg] has no storage attribute.' };
    return { kind: 'lines', lines: [`@bg ${storageToId(storage)}`] };
  },
  quake,
  quake2: quake,
  // Phase 4-C: [trans] 完了待ち。旧 @wait 0.5 近似を @wait_transition に正式化。
  wt: () => ({ kind: 'lines', lines: ['@wait_transition'] }),
  trans: (_node, _ctx, arg) => {
    // Tyrano [trans] → レイヤの fade トランジション（既定 overlay）。method は fade のみ対応。
    const time = msArg(arg('time'));
    const layerRaw = (arg('layer') ?? '').toLowerCase();
    const target = layerRaw === 'background' || layerRaw === 'bg' ? 'background'
      : layerRaw === 'fore' || layerRaw === 'foreground' || layerRaw === 'front' ? 'overlay'
      : undefined;
    const parts = ['@transition type=fade'];
    if (target) parts.push(`target=${target}`);
    if (time !== undefined) parts.push(`time=${time}`);
    return { kind: 'lines', lines: [parts.join(' ')] };
  },
  layopt: (_node, _ctx, arg) => {
    const layerRaw = (arg('layer') ?? '').toLowerCase();
    const name = layerRaw === 'background' || layerRaw === 'bg' ? 'background'
      : layerRaw === 'message' || layerRaw === 'fore' || layerRaw === 'foreground' || layerRaw === 'front' ? 'overlay'
      : layerRaw === 'character' || layerRaw === 'chara' ? 'character'
      : undefined;
    if (!name) return { kind: 'issue', severity: 'warning', message: `[layopt] layer "${arg('layer') ?? '?'}" has no kaedevn equivalent; skipped.` };
    const parts = [`@layer name=${name}`];
    const visible = arg('visible');
    if (visible !== undefined) parts.push(`visible=${visible === 'true' || visible === '1' ? 'true' : 'false'}`);
    const opacity = arg('opacity');
    if (opacity !== undefined) { const v = parseFloat(opacity); if (!isNaN(v)) parts.push(`opacity=${v}`); }
    return { kind: 'lines', lines: [parts.join(' ')] };
  },
  wait: (_node, _ctx, arg) => {
    const time = Number(arg('time') ?? arg('ms') ?? 0);
    if (!Number.isFinite(time) || time <= 0) {
      return { kind: 'issue', severity: 'warning', message: '[wait] has no positive time attribute.' };
    }
    return { kind: 'lines', lines: [`@wait ${time / 1000}`] };
  },
  mask: (_node, _ctx, arg) => {
    // Tyrano [mask] → @mask（全画面カラーマスク、[mask_off] まで維持）
    const parts = ['@mask'];
    const color = arg('color');
    if (color) parts.push(`color=${color}`);
    const opacity = arg('opacity');
    if (opacity !== undefined) { const v = parseFloat(opacity); if (!isNaN(v)) parts.push(`opacity=${v}`); }
    const time = msArg(arg('time'));
    if (time !== undefined) parts.push(`time=${time}`);
    return { kind: 'lines', lines: [parts.join(' ')] };
  },
  mask_off: (_node, _ctx, arg) => {
    const time = msArg(arg('time'));
    return { kind: 'lines', lines: [`@mask_clear${time !== undefined ? ` time=${time}` : ''}`] };
  },
  camera: (_node, _ctx, arg) => {
    // Tyrano [camera] → @camera（基本パラメータのみ）。scale→zoom, time→time。
    const parts = ['@camera'];
    const x = intArg(arg('x'));
    const y = intArg(arg('y'));
    const zoom = arg('scale') ?? arg('zoom');
    const time = msArg(arg('time'));
    if (x !== undefined) parts.push(`x=${x}`);
    if (y !== undefined) parts.push(`y=${y}`);
    if (zoom !== undefined) { const v = parseFloat(zoom); if (!isNaN(v)) parts.push(`zoom=${v}`); }
    if (time !== undefined) parts.push(`time=${time}`);
    return { kind: 'lines', lines: [parts.join(' ')] };
  },
  reset_camera: () => ({ kind: 'lines', lines: ['@camera reset'] }),
  wait_camera: () => ({ kind: 'lines', lines: ['@wait_camera'] }),
  filter: (node, _ctx, arg) => {
    // Tyrano [filter] は CSS フィルタ準拠で kaedevn と名前系が異なる。
    // 共通名（sepia/grayscale/blur）が属性にある場合のみ変換し、他は診断のみ。
    const name = [...SHARED_FILTER_NAMES].find((n) => node.args[n] !== undefined || arg('name') === n);
    if (!name) {
      return { kind: 'issue', severity: 'unsupported', message: '[filter] uses a filter system incompatible with kaedevn (only sepia/grayscale/blur map); manual migration needed.' };
    }
    return {
      kind: 'lines',
      lines: [`@filter ${name}`],
      warning: `[filter] intensity/parameters dropped (Tyrano CSS filter → kaedevn @filter ${name}); tune manually.`,
    };
  },
  free_filter: () => ({ kind: 'lines', lines: ['@filter_clear'] }),
};
