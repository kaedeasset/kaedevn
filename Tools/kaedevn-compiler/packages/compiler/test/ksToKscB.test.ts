import { describe, expect, it } from 'vitest';
import { ksToKscB } from '../src/index';

describe('ksToKscB (KS → KSC 戦略B)', () => {
  it('KS コメント ; を KSC コメント // にする', () => {
    const { ksc } = ksToKscB('; title: 枯れた泉\n@bg forest');
    expect(ksc).toContain('// title: 枯れた泉');
    expect(ksc).not.toMatch(/^;/m);
  });

  it('@シーンコマンドは素通し（execOp 経由で KSC 有効）', () => {
    const { ksc, issues } = ksToKscB('@bg forest fade=500\n@ch hero smile center');
    expect(ksc).toContain('@bg forest fade=500');
    expect(ksc).toContain('@ch hero smile center');
    expect(issues).toHaveLength(0);
  });

  it('*label → label, @jump file.ks → jump slug', () => {
    const { ksc } = ksToKscB('*chapter1\n@jump page-002_それぞれの夜明け.ks');
    expect(ksc).toContain('label chapter1');
    expect(ksc).toContain('jump page_002');
    expect(ksc).not.toContain('@jump');
    expect(ksc).not.toContain('.ks');
  });

  it('セリフ: #話者…@l を #話者…# に閉じ、@l は落とす', () => {
    const { ksc } = ksToKscB('#ルカ\n……泉が、枯れている。\n@l\n@ch mira normal left');
    expect(ksc).toBe('#ルカ\n……泉が、枯れている。\n#\n@ch mira normal left');
  });

  it('複数ページのセリフ: @l 区切りの各行を残し、末尾で閉じる', () => {
    const { ksc } = ksToKscB('#ルカ\nページ1\n@l\nページ2\n@l\n@bg next');
    expect(ksc).toBe('#ルカ\nページ1\nページ2\n#\n@bg next');
  });

  it('末尾がセリフでも # で閉じる', () => {
    const { ksc } = ksToKscB('#ミラ\n待って。');
    expect(ksc).toBe('#ミラ\n待って。\n#');
  });

  it('choice{} を showChoice + if/else-if へ lower する', () => {
    const src = ['choice {', '"はい" {', 'はい！', '@l', '}', '"いいえ" {', 'いいえ！', '@l', '}', '}'].join(
      '\n',
    );
    const { ksc } = ksToKscB(src);
    expect(ksc).toContain('const _choice0 = await engine.showChoice([{ text: "はい" }, { text: "いいえ" }]);');
    expect(ksc).toContain('if (_choice0 == 0) {');
    expect(ksc).toContain('else if (_choice0 == 1) {');
    // 選択肢本文の地の文は空話者ダイアログへ、@l は落とす
    expect(ksc).toContain('# "はい！"');
    expect(ksc).toContain('# "いいえ！"');
    expect(ksc).not.toContain('@l');
  });

  it('#話者のない裸テキストは地の文（空話者ダイアログ）にする', () => {
    const { ksc } = ksToKscB('今日は良い天気だ。\n@l');
    expect(ksc).toBe('# "今日は良い天気だ。"');
  });

  it('代入・if・else は KSC ネイティブとして素通し', () => {
    const src = 'affection = 10\nif (affection >= 15) {\n@bg happy\n} else {\n@bg sad\n}';
    const { ksc } = ksToKscB(src);
    expect(ksc).toContain('affection = 10');
    expect(ksc).toContain('if (affection >= 15) {');
    expect(ksc).toContain('} else {');
    expect(ksc).toContain('@bg happy');
  });

  it('@call/@return/@battle は //@ks: へ退避し issue 化', () => {
    const { ksc, issues } = ksToKscB('@call sub01\n@battle slime');
    expect(ksc).toContain('//@ks: @call sub01');
    expect(ksc).toContain('//@ks: @battle slime');
    expect(issues.filter((x) => x.severity === 'unsupported')).toHaveLength(2);
    expect(issues[0].line).toBe(1);
  });

  it('実サンプル形（page-001）が構造的に KSC 化される', () => {
    const src = [
      '; title: 枯れた泉',
      '',
      '@bg bg_spring_dry',
      '#ナレーション',
      'ルカは村の泉へ向かっていた…',
      '@l',
      '@ch luca normal center',
      '#ルカ',
      '……泉が、枯れている。',
      '@l',
      '@jump page-002_それぞれの夜明け.ks',
    ].join('\n');
    const { ksc, issues } = ksToKscB(src);
    expect(issues).toHaveLength(0);
    expect(ksc).toContain('// title: 枯れた泉');
    expect(ksc).toContain('@bg bg_spring_dry');
    expect(ksc).toContain('#ナレーション\nルカは村の泉へ向かっていた…\n#');
    expect(ksc).toContain('jump page_002');
    expect(ksc).not.toContain('@l');
    expect(ksc).not.toContain('@jump');
  });
});
