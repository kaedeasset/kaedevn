/**
 * 音のタグ（BGM・効果音・既定音量）。
 */
import { storageToId } from '../../tyranoParser.js';
import { msArg, intArg } from '../args.js';
import type { TagHandler } from '../types.js';

export const audioTags: Record<string, TagHandler> = {
  playbgm: (_node, ctx, arg) => {
    const storage = arg('storage');
    if (!storage) return { kind: 'issue', severity: 'warning', message: '[playbgm] has no storage attribute.' };
    const vol = intArg(arg('volume')) ?? ctx.audioState.bgmVol;
    return { kind: 'lines', lines: [`@bgm ${storageToId(storage)}${vol !== undefined ? ` vol=${vol}` : ''}`] };
  },
  fadeinbgm: (_node, ctx, arg) => {
    const storage = arg('storage');
    if (!storage) return { kind: 'issue', severity: 'warning', message: '[fadeinbgm] has no storage attribute.' };
    const fade = msArg(arg('time'));
    const vol = intArg(arg('volume')) ?? ctx.audioState.bgmVol;
    const parts = [`@bgm ${storageToId(storage)}`];
    if (fade !== undefined) parts.push(`fade=${fade}`);
    if (vol !== undefined) parts.push(`vol=${vol}`);
    return { kind: 'lines', lines: [parts.join(' ')] };
  },
  stopbgm: () => ({ kind: 'lines', lines: ['@bgm_stop'] }),
  fadeoutbgm: (_node, _ctx, arg) => {
    const fade = msArg(arg('time'));
    return { kind: 'lines', lines: [`@bgm_stop${fade !== undefined ? ` fade=${fade}` : ''}`] };
  },
  bgmopt: (_node, ctx, arg) => {
    // 音量オプションの設定。後続の [playbgm]/[fadeinbgm] に vol を引き継ぐ（他オプションは無視）。
    const vol = intArg(arg('volume'));
    if (vol !== undefined) ctx.audioState.bgmVol = vol;
    return { kind: 'lines', lines: [] };
  },
  playse: (_node, ctx, arg) => {
    const storage = arg('storage');
    if (!storage) return { kind: 'issue', severity: 'warning', message: '[playse] has no storage attribute.' };
    const vol = intArg(arg('volume')) ?? ctx.audioState.seVol;
    return { kind: 'lines', lines: [`@se ${storageToId(storage)}${vol !== undefined ? ` vol=${vol}` : ''}`] };
  },
  stopse: () => ({ kind: 'lines', lines: ['@se_stop'] }),
  seopt: (_node, ctx, arg) => {
    // 音量オプションの設定。後続の [playse] に vol を引き継ぐ（他オプションは無視）。
    const vol = intArg(arg('volume'));
    if (vol !== undefined) ctx.audioState.seVol = vol;
    return { kind: 'lines', lines: [] };
  },
};
