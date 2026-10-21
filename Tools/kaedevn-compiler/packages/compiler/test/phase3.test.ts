import { describe, it, expect } from 'vitest';
import { compile } from '../src/index.js';

describe('Phase 3: Embedded Commands', () => {
  describe('Text with @r (newline)', () => {
    it('should split text at @r', () => {
      const source = `夜だ。@r……帰るか。`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: '夜だ。' },
        { op: 'TEXT_NL' },
        { op: 'TEXT_APPEND', text: '……帰るか。' },
        { op: 'PAGE' },
      ]);
    });

    it('should handle multiple @r', () => {
      const source = `一行目。@r二行目。@r三行目。`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: '一行目。' },
        { op: 'TEXT_NL' },
        { op: 'TEXT_APPEND', text: '二行目。' },
        { op: 'TEXT_NL' },
        { op: 'TEXT_APPEND', text: '三行目。' },
        { op: 'PAGE' },
      ]);
    });

    it('should preserve character name with @r', () => {
      const source = `主人公：おはよう。@rいい天気だね。`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', who: '主人公', text: 'おはよう。' },
        { op: 'TEXT_NL' },
        { op: 'TEXT_APPEND', who: '主人公', text: 'いい天気だね。' },
        { op: 'PAGE' },
      ]);
    });
  });

  describe('Text with @l (click wait)', () => {
    it('should split text at @l', () => {
      const source = `こんにちは。@l元気ですか？`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'WAIT_CLICK' },
        { op: 'TEXT_APPEND', text: '元気ですか？' },
        { op: 'PAGE' },
      ]);
    });

    it('should handle @l at end', () => {
      const source = `こんにちは。@l`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'WAIT_CLICK' },
      ]);
    });

    it('should preserve character name with @l', () => {
      const source = `主人公：こんにちは。@lまた明日。`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', who: '主人公', text: 'こんにちは。' },
        { op: 'WAIT_CLICK' },
        { op: 'TEXT_APPEND', who: '主人公', text: 'また明日。' },
        { op: 'PAGE' },
      ]);
    });
  });

  describe('Text with @p (page break)', () => {
    it('should split text at @p', () => {
      const source = `夜だ。@r……帰るか。@p`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: '夜だ。' },
        { op: 'TEXT_NL' },
        { op: 'TEXT_APPEND', text: '……帰るか。' },
        { op: 'PAGE' },
      ]);
    });

    it('should handle text after @p', () => {
      const source = `前ページ。@p次ページ。`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: '前ページ。' },
        { op: 'PAGE' },
        { op: 'TEXT_APPEND', text: '次ページ。' },
        { op: 'PAGE' },
      ]);
    });
  });

  describe('Mixed embedded commands', () => {
    it('should handle @r, @l, @p together', () => {
      const source = `一行目。@r二行目。@l三行目。@p`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: '一行目。' },
        { op: 'TEXT_NL' },
        { op: 'TEXT_APPEND', text: '二行目。' },
        { op: 'WAIT_CLICK' },
        { op: 'TEXT_APPEND', text: '三行目。' },
        { op: 'PAGE' },
      ]);
    });

    it('should handle complex scenario', () => {
      const source = `
@bg room_day
主人公：おはよう。@r今日はいい天気だね。@l
@p
また会いましょう。@l
      `.trim();

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'BG_SET', id: 'room_day' },
        { op: 'TEXT_APPEND', who: '主人公', text: 'おはよう。' },
        { op: 'TEXT_NL' },
        { op: 'TEXT_APPEND', who: '主人公', text: '今日はいい天気だね。' },
        { op: 'WAIT_CLICK' },
        { op: 'PAGE' },
        { op: 'TEXT_APPEND', text: 'また会いましょう。' },
        { op: 'WAIT_CLICK' },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should handle consecutive embedded commands as text', () => {
      const source = `@r@l@p`;

      const result = compile(source);

      // @r@l@p はテキスト行として扱われ、埋め込み分解される
      expect(result.ops).toEqual([
        { op: 'TEXT_NL' },
        { op: 'WAIT_CLICK' },
        { op: 'PAGE' },
      ]);
    });

    it('should handle only embedded command', () => {
      const source = `@l`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'WAIT_CLICK' }]);
    });

    it('should not expand standalone @l command', () => {
      const source = `
こんにちは。
@l
元気ですか？
      `.trim();

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'WAIT_CLICK' },
        { op: 'TEXT_APPEND', text: '元気ですか？' },
        { op: 'PAGE' },
      ]);
    });
  });
});
