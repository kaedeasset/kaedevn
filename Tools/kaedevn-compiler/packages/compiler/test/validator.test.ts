import { describe, it, expect } from 'vitest';
import type { Op } from '@kaedevn/core';
import { Validator } from '../src/validator/Validator.js';
import { CompilationException } from '../src/types/CompilerError.js';

describe('Validator', () => {
  const validator = new Validator();

  describe('ID形式バリデーション', () => {
    it('正常なIDは通過する', () => {
      const ops: Op[] = [
        { op: 'BG_SET', id: 'room_day' },
        { op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center' },
        { op: 'BGM_PLAY', id: 'calm' },
        { op: 'SE_PLAY', id: 'door_open' },
        { op: 'VOICE_PLAY', id: 'hero_001' },
      ];

      expect(() => validator.validate(ops)).not.toThrow();
    });

    it('空文字列IDはエラー', () => {
      const ops: Op[] = [{ op: 'BG_SET', id: '' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].code).toBe('INVALID_VALUE');
          expect(e.errors[0].message).toContain('Empty');
        }
      }
    });

    it('先頭スペース付きIDはエラー', () => {
      const ops: Op[] = [{ op: 'BG_SET', id: ' room_day' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].code).toBe('INVALID_VALUE');
          expect(e.errors[0].message).toContain('whitespace');
        }
      }
    });

    it('末尾スペース付きIDはエラー', () => {
      const ops: Op[] = [{ op: 'BGM_PLAY', id: 'calm ' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('whitespace');
        }
      }
    });

    it('改行文字を含むIDはエラー', () => {
      const ops: Op[] = [{ op: 'SE_PLAY', id: 'door\nopen' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('newline');
        }
      }
    });

    it('キャラクター名の空文字列はエラー', () => {
      const ops: Op[] = [{ op: 'CH_SET', name: '', pose: 'smile', pos: 'center' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('Empty');
        }
      }
    });

    it('ポーズIDの空文字列はエラー', () => {
      const ops: Op[] = [{ op: 'CH_SET', name: 'hero', pose: '', pos: 'center' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
    });
  });

  describe('TEXT_APPENDバリデーション', () => {
    it('正常なテキストは通過する', () => {
      const ops: Op[] = [
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'TEXT_APPEND', who: '主人公', text: 'やあ。' },
      ];

      expect(() => validator.validate(ops)).not.toThrow();
    });

    it('空のテキストはエラー', () => {
      const ops: Op[] = [{ op: 'TEXT_APPEND', text: '' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('Empty text');
        }
      }
    });

    it('空のキャラクター名（who）はエラー', () => {
      const ops: Op[] = [{ op: 'TEXT_APPEND', who: '', text: 'こんにちは。' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('Empty character name');
        }
      }
    });

    it('whoに先頭/末尾スペースがあるとエラー', () => {
      const ops: Op[] = [{ op: 'TEXT_APPEND', who: ' 主人公 ', text: 'やあ。' }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('whitespace');
        }
      }
    });
  });

  describe('数値バリデーション', () => {
    it('正常なフェード時間は通過する', () => {
      const ops: Op[] = [
        { op: 'BG_SET', id: 'room', fadeMs: 500 },
        { op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center', fadeMs: 300 },
        { op: 'BGM_PLAY', id: 'calm', fadeMs: 1000 },
      ];

      expect(() => validator.validate(ops)).not.toThrow();
    });

    it('負のフェード時間はエラー', () => {
      const ops: Op[] = [{ op: 'BG_SET', id: 'room', fadeMs: -100 }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('Negative fade time');
        }
      }
    });

    it('正常なボリューム（0-100）は通過する', () => {
      const ops: Op[] = [
        { op: 'BGM_PLAY', id: 'calm', vol: 0 },
        { op: 'BGM_PLAY', id: 'calm', vol: 50 },
        { op: 'BGM_PLAY', id: 'calm', vol: 100 },
        { op: 'SE_PLAY', id: 'click', vol: 80 },
      ];

      expect(() => validator.validate(ops)).not.toThrow();
    });

    it('範囲外のボリュームはエラー', () => {
      const ops1: Op[] = [{ op: 'BGM_PLAY', id: 'calm', vol: -10 }];
      const ops2: Op[] = [{ op: 'SE_PLAY', id: 'click', vol: 101 }];

      expect(() => validator.validate(ops1)).toThrow(CompilationException);
      expect(() => validator.validate(ops2)).toThrow(CompilationException);

      try {
        validator.validate(ops1);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('Volume out of range');
        }
      }
    });

    it('負の待機時間はエラー', () => {
      const ops: Op[] = [{ op: 'WAIT_MS', ms: -500 }];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors[0].message).toContain('Negative wait time');
        }
      }
    });
  });

  describe('複数エラーの収集', () => {
    it('複数のエラーをまとめて報告する', () => {
      const ops: Op[] = [
        { op: 'BG_SET', id: '' }, // エラー1: 空ID
        { op: 'CH_SET', name: ' hero', pose: 'smile', pos: 'center' }, // エラー2: スペース
        { op: 'BGM_PLAY', id: 'calm', vol: 150 }, // エラー3: ボリューム範囲外
      ];

      expect(() => validator.validate(ops)).toThrow(CompilationException);
      try {
        validator.validate(ops);
      } catch (e) {
        if (e instanceof CompilationException) {
          expect(e.errors.length).toBe(3);
          expect(e.errors[0].message).toContain('Empty');
          expect(e.errors[1].message).toContain('whitespace');
          expect(e.errors[2].message).toContain('Volume');
        }
      }
    });
  });

  describe('バリデーション不要なOp', () => {
    it('待機系Opは追加バリデーション不要', () => {
      const ops: Op[] = [
        { op: 'WAIT_CLICK' },
        { op: 'PAGE' },
        { op: 'TEXT_NL' },
        { op: 'WAIT_VOICE_END' },
        { op: 'BGM_STOP' },
        { op: 'CH_CLEAR' },
      ];

      expect(() => validator.validate(ops)).not.toThrow();
    });
  });
});
