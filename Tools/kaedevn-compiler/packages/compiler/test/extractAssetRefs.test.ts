import { describe, it, expect } from 'vitest';
import { extractAssetRefs } from '../src/index.js';
import type { Op } from '@kaedevn/core';

describe('extractAssetRefs', () => {
  it('背景・立ち絵・音の参照だけを抽出し、未使用は含めない', () => {
    const ops: Op[] = [
      { op: 'BG_SET', id: 'bg-001' },
      { op: 'CH_SET', name: 'hashim', pose: 'sad', pos: 'left' },
      { op: 'CH_SET', name: 'hashim', pose: 'sad', pos: 'left' }, // 重複は1回
      { op: 'CH_SET', name: 'hashim', pose: 'happy', pos: 'left' },
      { op: 'TEXT_APPEND', text: 'こんにちは' },
      { op: 'BGM_PLAY', id: 'bgm-001' },
      { op: 'SE_PLAY', id: 'se-001' },
      { op: 'WAIT_CLICK' },
    ];

    const refs = extractAssetRefs(ops);

    expect(refs.bg).toEqual(['bg-001']);
    expect(refs.ch.sort()).toEqual(['hashim:happy', 'hashim:sad']);
    expect(refs.bgm).toEqual(['bgm-001']);
    expect(refs.se).toEqual(['se-001']);
    // keys は assets.json のキー形式（背景 id ＋ "name:pose"）
    expect(refs.keys.sort()).toEqual(['bg-001', 'hashim:happy', 'hashim:sad']);
  });

  it('アセットを使わないシナリオでは空配列を返す', () => {
    const ops: Op[] = [
      { op: 'TEXT_APPEND', text: 'text' },
      { op: 'WAIT_CLICK' },
    ];
    const refs = extractAssetRefs(ops);
    expect(refs.keys).toEqual([]);
    expect(refs.bg).toEqual([]);
    expect(refs.ch).toEqual([]);
  });
});
