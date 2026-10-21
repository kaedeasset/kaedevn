import type { Op } from '@kaedevn/core';
import type { TextToken } from '../types/Token.js';

/**
 * テキストトークンをOp命令に変換
 * 全角コロン（：）で名前とテキストを分離
 */
export function parseText(token: TextToken): Op {
  const { text } = token;

  // 名前付きテキストのチェック（全角コロン）
  const colonIndex = text.indexOf('：');

  if (colonIndex !== -1) {
    const who = text.substring(0, colonIndex);
    const content = text.substring(colonIndex + 1);

    return {
      op: 'TEXT_APPEND',
      who,
      text: content,
    };
  }

  // 地の文
  return {
    op: 'TEXT_APPEND',
    text,
  };
}
