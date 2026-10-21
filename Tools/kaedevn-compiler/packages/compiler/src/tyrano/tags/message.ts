/**
 * 本文の送り・改行・消去のタグ（[p] [l] [r] [cm] [er]）。
 */
import type { TagHandler } from '../types.js';

export const messageTags: Record<string, TagHandler> = {
  p: () => ({ kind: 'lines', lines: ['@p'] }),
  l: () => ({ kind: 'lines', lines: ['@l'] }),
  r: () => ({ kind: 'lines', lines: ['@r'] }),
  cm: () => ({ kind: 'lines', lines: ['@text_clear all'] }),
  er: () => ({ kind: 'lines', lines: ['@text_clear current'] }),
};
