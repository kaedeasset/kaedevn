import { describe, it, expect } from 'vitest';
import { parseKsCommandLine } from '../src/index';
import { splitCommandLine } from '../src/parser/splitCommandLine';
import { normalizePosition } from '../src/parser/position';

describe('parseKsCommandLine (P6-9 execOp)', () => {
  it('converts an @ command line to the same Op as the KS pipeline', () => {
    expect(parseKsCommandLine('@bg classroom fade=500', 1)).toMatchObject({
      op: 'BG_SET',
      id: 'classroom',
      fadeMs: 500,
    });
  });

  it('converts Phase 6 ops (@text / @sprite_move) without extra wiring', () => {
    expect(parseKsCommandLine('@text t1 "こんにちは" x=100 y=200 bold=true', 1)).toMatchObject({
      op: 'TEXT_SPRITE_SET',
      id: 't1',
      text: 'こんにちは',
      x: 100,
      y: 200,
      bold: true,
    });
    expect(parseKsCommandLine('@sprite_move photo x=300 opacity=0.5 time=400', 2)).toMatchObject({
      op: 'SPRITE_MOVE',
      id: 'photo',
      x: 300,
      opacity: 0.5,
      durationMs: 400,
    });
  });

  it('accepts standalone commands (@l / @p / @r)', () => {
    expect(parseKsCommandLine('@l', 1)).toEqual({ op: 'WAIT_CLICK' });
    expect(parseKsCommandLine('@p', 2)).toEqual({ op: 'PAGE' });
    expect(parseKsCommandLine('@r', 3)).toEqual({ op: 'TEXT_NL' });
  });

  it('rejects control-flow commands with a KSC-native hint', () => {
    expect(() => parseKsCommandLine('@jump intro', 1)).toThrowError(/jump <label>/);
    expect(() => parseKsCommandLine('@call sub', 2)).toThrowError(/function call/);
    expect(() => parseKsCommandLine('@return', 3)).toThrowError(/function return/);
    expect(() => parseKsCommandLine('@battle troop1', 4)).toThrowError(/battleStart/);
  });

  it('rejects unknown commands and empty lines', () => {
    expect(() => parseKsCommandLine('@no_such_command', 1)).toThrowError(/Unknown command/);
    expect(() => parseKsCommandLine('@', 1)).toThrowError(/empty/);
  });
});

describe('splitCommandLine', () => {
  it('@ の有無・空白の並び・前後の空白を同じに切る', () => {
    expect(splitCommandLine('@ch  hero smile   L ')).toEqual({ command: 'ch', args: ['hero', 'smile', 'L'] });
    expect(splitCommandLine('  wait 1')).toEqual({ command: 'wait', args: ['1'] });
    expect(splitCommandLine('@')).toEqual({ command: '', args: [] });
  });
});

describe('normalizePosition', () => {
  it('名前と 1 文字の両方を受け、表に無いものは undefined', () => {
    expect(['left', 'center', 'right', 'L', 'C', 'R'].map(normalizePosition)).toEqual(['left', 'center', 'right', 'left', 'center', 'right']);
    expect(normalizePosition('X')).toBeUndefined();
    expect(normalizePosition('toString')).toBeUndefined();
    expect(normalizePosition(undefined)).toBeUndefined();
  });
});
