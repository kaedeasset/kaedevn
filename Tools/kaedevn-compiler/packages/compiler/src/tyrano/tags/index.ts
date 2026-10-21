/**
 * タグ名 → 変換関数の表。ここに載っているタグが「対応タグ」（載っていないタグはマクロか未対応）。
 */
import type { TagHandler } from '../types.js';
import { messageTags } from './message.js';
import { characterTags } from './character.js';
import { audioTags } from './audio.js';
import { stageTags } from './stage.js';
import { spriteTags } from './sprite.js';
import { flowTags } from './flow.js';

export const TAG_HANDLERS: ReadonlyMap<string, TagHandler> = new Map(Object.entries({
  ...messageTags,
  ...characterTags,
  ...audioTags,
  ...stageTags,
  ...spriteTags,
  ...flowTags,
}));
