import { describe, expect, it } from 'vitest';
import { filesToKs, compile } from '../src/index';

describe('filesToKs', () => {
  it('namespaces labels and resolves cross-file jumps', () => {
    const { ks, issues } = filesToKs(
      [
        { name: 'first.ks', content: '@jump chapter01/010_opening.ks start' },
        { name: 'chapter01/010_opening.ks', content: '*start\n本文\n@jump next\n*next\n続き\n@jump ending.ks' },
        { name: 'ending.ks', content: '終わり\n@return' },
      ],
      'first.ks',
    );

    // ファイル先頭の暗黙ラベル
    expect(ks).toContain('*first');
    expect(ks).toContain('*chapter01_010_opening');
    // ファイル内ラベルの名前空間化
    expect(ks).toContain('*chapter01_010_opening__start');
    expect(ks).toContain('*chapter01_010_opening__next');
    // 跨ぎジャンプの解決（path.ks label → slug__label）
    expect(ks).toContain('@jump chapter01_010_opening__start');
    // ファイル内ジャンプの名前空間化
    expect(ks).toContain('@jump chapter01_010_opening__next');
    // ファイル先頭への跨ぎジャンプ（label 無し → slug）
    expect(ks).toContain('@jump ending');
    expect(issues.filter((i) => i.severity === 'unsupported')).toHaveLength(0);
  });

  it('places the entry file first', () => {
    const { ks } = filesToKs(
      [
        { name: 'b.ks', content: 'B\n@return' },
        { name: 'a.ks', content: '@jump b.ks' },
      ],
      'a.ks',
    );
    expect(ks.indexOf('*a')).toBeLessThan(ks.indexOf('*b'));
  });

  it('flags unresolved cross-file jumps and fall-through', () => {
    const { issues } = filesToKs(
      [
        { name: 'first.ks', content: '@jump missing.ks x' }, // 未解決
        { name: 'other.ks', content: '本文だけ' },            // fall-through（jump/return なし）
      ],
      'first.ks',
    );
    const msgs = issues.map((i) => i.message).join(' | ');
    expect(msgs).toContain('unresolved cross-file jump');
    expect(msgs).toContain('fall through');
  });

  it('produces KS that compiles through the existing pipeline', () => {
    const { ks } = filesToKs(
      [
        { name: 'first.ks', content: '@jump scene.ks start' },
        { name: 'scene.ks', content: '*start\nこんにちは@l\n@return' },
      ],
      'first.ks',
    );
    const scenario = compile(ks, { scenarioId: 'linked', validate: false });
    const ops = scenario.ops.map((o) => o.op);
    expect(ops).toContain('JUMP');
    expect(ops).toContain('TEXT_APPEND');
  });
});
