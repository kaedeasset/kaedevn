import { describe, it, expect } from 'vitest';
import { compile, CompilationException } from '../src/index.js';

describe('Phase 2: Command Extensions', () => {
  describe('Audio Commands', () => {
    it('should compile @bgm command', () => {
      const source = `@bgm calm vol 70 fade 500`;

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'BGM_PLAY', id: 'calm', vol: 70, fadeMs: 500 },
        { op: 'PAGE' },
      ]);
    });

    it('should compile @bgm without options', () => {
      const source = `@bgm battle`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'BGM_PLAY', id: 'battle' }, { op: 'PAGE' }]);
    });

    it('should compile @bgm_stop command', () => {
      const source = `@bgm_stop fade 300`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'BGM_STOP', fadeMs: 300 }, { op: 'PAGE' }]);
    });

    it('should compile @bgm_stop without fade', () => {
      const source = `@bgm_stop`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'BGM_STOP' }, { op: 'PAGE' }]);
    });

    it('should compile @se command', () => {
      const source = `@se click vol 80`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'SE_PLAY', id: 'click', vol: 80 }, { op: 'PAGE' }]);
    });

    it('should compile @voice command', () => {
      const source = `@voice hero_001`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'VOICE_PLAY', id: 'hero_001' }, { op: 'PAGE' }]);
    });

    it('should throw on @bgm without id', () => {
      const source = `@bgm`;

      expect(() => compile(source)).toThrow(CompilationException);
      expect(() => compile(source)).toThrow(/@bgm requires \(id\)/);
    });
  });

  describe('Wait Commands', () => {
    it('should compile @wait command', () => {
      const source = `@wait 0.5`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'WAIT_MS', ms: 500 }]);
    });

    it('should compile @wait with integer seconds', () => {
      const source = `@wait 2`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'WAIT_MS', ms: 2000 }]);
    });

    it('should compile @l command', () => {
      const source = `@l`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'WAIT_CLICK' }]);
    });

    it('should compile @p command', () => {
      const source = `@p`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'PAGE' }]);
    });

    it('should compile @r command', () => {
      const source = `@r`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'TEXT_NL' }, { op: 'PAGE' }]);
    });

    it('should throw on @wait without seconds', () => {
      const source = `@wait`;

      expect(() => compile(source)).toThrow(CompilationException);
      expect(() => compile(source)).toThrow(/@wait requires \(sec\)/);
    });
  });

  describe('Character Commands', () => {
    it('should compile @ch_hide command', () => {
      const source = `@ch_hide hero fade 200`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'CH_HIDE', name: 'hero', fadeMs: 200 }, { op: 'PAGE' }]);
    });

    it('should compile @ch_hide without fade', () => {
      const source = `@ch_hide hero`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'CH_HIDE', name: 'hero' }, { op: 'PAGE' }]);
    });

    it('should compile @ch_clear command', () => {
      const source = `@ch_clear`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'CH_CLEAR' }, { op: 'PAGE' }]);
    });

    it('should compile @ch_clear with fade', () => {
      const source = `@ch_clear fade 300`;

      const result = compile(source);

      expect(result.ops).toEqual([{ op: 'CH_CLEAR', fadeMs: 300 }, { op: 'PAGE' }]);
    });

    it('should throw on @ch_hide without name', () => {
      const source = `@ch_hide`;

      expect(() => compile(source)).toThrow(CompilationException);
      expect(() => compile(source)).toThrow(/@ch_hide requires \(name\)/);
    });
  });

  describe('Complex Scenarios', () => {
    it('should compile full scenario with all command types', () => {
      const source = `
@bg room_day
@ch hero smile center

@bgm calm vol 70

主人公：良い朝だ。
@l

@wait 0.5

@se door
扉が開いた。
@l

@ch_hide hero fade 300
@bgm_stop fade 500

@p
      `.trim();

      const result = compile(source);

      expect(result.ops).toHaveLength(12);
      expect(result.ops[0]).toEqual({ op: 'BG_SET', id: 'room_day' });
      expect(result.ops[2]).toEqual({ op: 'BGM_PLAY', id: 'calm', vol: 70 });
      expect(result.ops[4]).toEqual({ op: 'WAIT_CLICK' });
      expect(result.ops[5]).toEqual({ op: 'WAIT_MS', ms: 500 });
      expect(result.ops[8]).toEqual({ op: 'WAIT_CLICK' });
      expect(result.ops[9]).toEqual({ op: 'CH_HIDE', name: 'hero', fadeMs: 300 });
      expect(result.ops[11]).toEqual({ op: 'PAGE' });
    });

    it('should handle multiple @l and @p commands', () => {
      const source = `
こんにちは。
@l
元気ですか？
@p
また会いましょう。
@l
      `.trim();

      const result = compile(source);

      expect(result.ops).toEqual([
        { op: 'TEXT_APPEND', text: 'こんにちは。' },
        { op: 'WAIT_CLICK' },
        { op: 'TEXT_APPEND', text: '元気ですか？' },
        { op: 'PAGE' },
        { op: 'TEXT_APPEND', text: 'また会いましょう。' },
        { op: 'WAIT_CLICK' },
      ]);
    });
  });
});
