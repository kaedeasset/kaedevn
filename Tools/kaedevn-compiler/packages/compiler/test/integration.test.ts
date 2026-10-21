import { describe, it, expect } from 'vitest';
import { compile, CompilationException } from '../src/index.js';

describe('Integration: DSL to Op (Phase 1)', () => {
  it('should compile basic scenario', () => {
    const source = `
@bg room_day
今日は良い天気。
    `.trim();

    const result = compile(source);

    expect(result.id).toBe('scenario');
    expect(result.ops).toEqual([
      { op: 'BG_SET', id: 'room_day' },
      { op: 'TEXT_APPEND', text: '今日は良い天気。' },
      { op: 'PAGE' }, // 自動付与
    ]);
  });

  it('should handle named text with 全角コロン', () => {
    const source = `主人公：……帰るか。`;

    const result = compile(source);

    expect(result.ops).toEqual([
      { op: 'TEXT_APPEND', who: '主人公', text: '……帰るか。' },
      { op: 'PAGE' }, // 自動付与
    ]);
  });

  it('should attach #speaker to following TEXT_APPEND.who', () => {
    const source = `
#赤音
久しぶり
@l
    `.trim();

    const result = compile(source);

    expect(result.ops[0]).toEqual({ op: 'TEXT_APPEND', who: '赤音', text: '久しぶり' });
  });

  it('#speaker persists across multiple text lines until changed', () => {
    const source = `
#赤音
こんにちは
笑顔ね
#太郎
やあ
    `.trim();

    const result = compile(source);

    const textOps = result.ops.filter(o => o.op === 'TEXT_APPEND');
    expect(textOps[0]).toMatchObject({ who: '赤音', text: 'こんにちは' });
    expect(textOps[1]).toMatchObject({ who: '赤音', text: '笑顔ね' });
    expect(textOps[2]).toMatchObject({ who: '太郎', text: 'やあ' });
  });

  it('should compile character commands', () => {
    const source = `
@ch hero smile center
@ch heroine sad left fade 300
    `.trim();

    const result = compile(source);

    expect(result.ops).toEqual([
      { op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center' },
      { op: 'CH_SET', name: 'heroine', pose: 'sad', pos: 'left', fadeMs: 300 },
      { op: 'PAGE' }, // 自動付与
    ]);
  });

  it('should handle background with fade', () => {
    const source = `@bg room_night fade 500`;

    const result = compile(source);

    expect(result.ops).toEqual([
      { op: 'BG_SET', id: 'room_night', fadeMs: 500, effect: 'fade' },
      { op: 'PAGE' }, // 自動付与
    ]);
  });

  it('should ignore comments', () => {
    const source = `
// This is a comment
@bg room_day
// Another comment
今日は良い天気。
    `.trim();

    const result = compile(source);

    expect(result.ops).toHaveLength(3); // BG_SET + TEXT + PAGE
    expect(result.ops[0]).toEqual({ op: 'BG_SET', id: 'room_day' });
    expect(result.ops[2]).toEqual({ op: 'PAGE' });
  });

  it('should handle mixed scenario', () => {
    const source = `
@bg room_day
@ch hero smile center

主人公：良い朝だ。
今日は何をしようか。
    `.trim();

    const result = compile(source);

    expect(result.ops).toEqual([
      { op: 'BG_SET', id: 'room_day' },
      { op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center' },
      { op: 'TEXT_APPEND', who: '主人公', text: '良い朝だ。' },
      { op: 'TEXT_APPEND', text: '今日は何をしようか。' },
      { op: 'PAGE' }, // 自動付与
    ]);
  });

  it('should throw CompilationException for unknown command', () => {
    const source = `@unknown_cmd zoom`;

    // 未知のコマンドは CompilationException (UNKNOWN_COMMAND) をスロー
    expect(() => compile(source)).toThrow();
  });

  it('should throw on invalid position', () => {
    const source = `@ch hero smile top`;

    expect(() => compile(source)).toThrow(CompilationException);
    expect(() => compile(source)).toThrow(/Invalid position/);
  });

  it('@bg with no args produces BG_CLEAR', () => {
    const source = `@bg`;

    const result = compile(source);

    expect(result.ops[0]).toEqual({ op: 'BG_CLEAR' });
  });

  it('should throw on insufficient args for @ch', () => {
    const source = `@ch hero smile`;

    expect(() => compile(source)).toThrow(CompilationException);
    expect(() => compile(source)).toThrow(/@ch requires \(name pose pos\)/);
  });

  it('should set custom scenario id', () => {
    const source = `@bg room_day`;

    const result = compile(source, { scenarioId: 'custom-id' });

    expect(result.id).toBe('custom-id');
    expect(result.ops[result.ops.length - 1]).toEqual({ op: 'PAGE' });
  });

  // === X/Y/S transform params ===

  it('should parse @bg with x/y/s params', () => {
    const source = `@bg forest x 100 y -50 s 1.5`;
    const result = compile(source);
    expect(result.ops[0]).toEqual({
      op: 'BG_SET', id: 'forest', x: 100, y: -50, s: 1.5,
    });
  });

  it('should parse @bg with mixed fade and x/y/s params', () => {
    const source = `@bg castle fade 500 x 200 s 2`;
    const result = compile(source);
    expect(result.ops[0]).toEqual({
      op: 'BG_SET', id: 'castle', fadeMs: 500, effect: 'fade', x: 200, s: 2,
    });
  });

  it('should parse @ch with x/y/s params', () => {
    const source = `@ch hero smile center x 30 y -20 s 1.2`;
    const result = compile(source);
    expect(result.ops[0]).toEqual({
      op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center', x: 30, y: -20, s: 1.2,
    });
  });

  it('should parse @ch with fade and x/y/s params', () => {
    const source = `@ch hero smile left fade 300 x 50`;
    const result = compile(source);
    expect(result.ops[0]).toEqual({
      op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'left', fadeMs: 300, x: 50,
    });
  });

  it('should parse @overlay with x/y/s params', () => {
    const source = `@overlay rain x 0 y 0 s 2`;
    const result = compile(source);
    expect(result.ops[0]).toEqual({
      op: 'OVERLAY_SET', id: 'rain', x: 0, y: 0, s: 2,
    });
  });

  it('should ignore non-numeric x/y/s values', () => {
    const source = `@bg forest x abc`;
    const result = compile(source);
    expect(result.ops[0]).toEqual({ op: 'BG_SET', id: 'forest' });
  });

  it('@bg without x/y/s produces clean Op', () => {
    const source = `@bg room_day`;
    const result = compile(source);
    expect(result.ops[0]).toEqual({ op: 'BG_SET', id: 'room_day' });
    expect(result.ops[0]).not.toHaveProperty('x');
    expect(result.ops[0]).not.toHaveProperty('y');
    expect(result.ops[0]).not.toHaveProperty('s');
  });
});
