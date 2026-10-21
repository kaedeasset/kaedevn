import { describe, it, expect } from 'vitest';
import { compile } from '../src/index.js';

describe('Phase 5: Auto Page at End', () => {
  describe('Should add PAGE at end', () => {
    it('should add PAGE after text', () => {
      const source = `こんにちは。`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'PAGE' },
      ]);
    });

    it('should add PAGE after command', () => {
      const source = `@bg room_day`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'BG_SET', id: 'room_day' },
        { op: 'PAGE' },
      ]);
    });

    it('should add PAGE after character show', () => {
      const source = `
@bg room_day
@ch hero smile center
      `.trim();

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'BG_SET', id: 'room_day' },
        { op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center' },
        { op: 'PAGE' },
      ]);
    });

    it('should add PAGE after BGM', () => {
      const source = `@bgm calm vol 70`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'BGM_PLAY', id: 'calm', vol: 70 },
        { op: 'PAGE' },
      ]);
    });

    it('should add PAGE after TEXT_NL', () => {
      const source = `一行目。@r`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: '一行目。' },
        { op: 'TEXT_NL' },
        { op: 'PAGE' },
      ]);
    });
  });

  describe('Should NOT add PAGE', () => {
    it('should not add PAGE after @l', () => {
      const source = `こんにちは。@l`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'WAIT_CLICK' },
      ]);
    });

    it('should not add PAGE after @p', () => {
      const source = `こんにちは。@p`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'PAGE' },
      ]);
    });

    it('should not add PAGE after @wait', () => {
      const source = `@wait 1`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'WAIT_MS', ms: 1000 },
      ]);
    });

    it('should not add PAGE after standalone @l', () => {
      const source = `
こんにちは。
@l
      `.trim();

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'WAIT_CLICK' },
      ]);
    });

    it('should not add PAGE after standalone @p', () => {
      const source = `
こんにちは。
@p
      `.trim();

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'PAGE' },
      ]);
    });
  });

  describe('Complex scenarios', () => {
    it('should add PAGE to complete scenario without explicit wait', () => {
      const source = `
@bg room_day
@ch hero smile center
主人公：おはよう。
      `.trim();

      const result = compile(source);

      expect(result.ops).toHaveLength(4);
      expect(result.ops[result.ops.length - 1]).toEqual({ op: 'PAGE' });
    });

    it('should not add PAGE when scenario ends with @l', () => {
      const source = `
@bg room_day
主人公：おはよう。@l
      `.trim();

      const result = compile(source);

      const last = result.ops[result.ops.length - 1];
      expect(last.op).toBe('WAIT_CLICK');
    });

    it('should handle mixed scenario correctly', () => {
      const source = `
@bg room_day
主人公：一行目。@l
主人公：二行目。
      `.trim();

      const result = compile(source);

      // 最後はテキストなので PAGE が追加される
      expect(result.ops[result.ops.length - 1]).toEqual({ op: 'PAGE' });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty scenario', () => {
      const source = ``;

      const result = compile(source);

      expect(result.ops).toEqual([]);
    });

    it('should handle only comments', () => {
      const source = `
// comment 1
// comment 2
      `.trim();

      const result = compile(source);

      expect(result.ops).toEqual([]);
    });

    it('should add PAGE after single command', () => {
      const source = `@bgm calm`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'BGM_PLAY', id: 'calm' },
        { op: 'PAGE' },
      ]);
    });
  });
});
