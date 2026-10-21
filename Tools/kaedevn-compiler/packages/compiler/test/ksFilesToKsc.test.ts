import { describe, expect, it } from 'vitest';
import { ksFilesToKsc } from '../src/index';

describe('ksFilesToKsc (editor→KS→KSC 一気通貫)', () => {
  it('多ファイルをリンクしてから KSC 化する（ファイル跨ぎ jump が解決）', () => {
    const files = [
      { name: 'page-001.ks', content: '; 導入\n@bg forest\n#ルカ\n泉が枯れている。\n@l\n@jump page-002.ks' },
      { name: 'page-002.ks', content: '#ミラ\n待って。\n@l' },
    ];
    const { ksc, linkedKs, issues } = ksFilesToKsc(files, 'page-001.ks');

    // link 段: ファイル先頭ラベルが入る
    expect(linkedKs).toContain('*page_001');
    expect(linkedKs).toContain('*page_002');

    // convert 段: KSC 形へ
    expect(ksc).toContain('// 導入');
    expect(ksc).toContain('@bg forest'); // @シーンは素通し（execOp）
    expect(ksc).toContain('#ルカ\n泉が枯れている。\n#');
    expect(ksc).toContain('label page_001');
    expect(ksc).toContain('label page_002');
    expect(ksc).toContain('jump page_002');
    expect(ksc).not.toContain('@jump');
    expect(ksc).not.toContain('@l');
    expect(ksc).not.toMatch(/^;/m);

    // 変換段(convert)は無 issue。link 段の警告は filesToKs の領分（stage で区別できる）。
    expect(issues.filter((i) => i.stage === 'convert')).toHaveLength(0);
  });

  it('link 段と convert 段の issue を stage 付きで統合する', () => {
    const files = [{ name: 'a.ks', content: '@battle slime\n@bg x' }];
    const { issues } = ksFilesToKsc(files, 'a.ks');
    const convertIssues = issues.filter((i) => i.stage === 'convert');
    expect(convertIssues.length).toBeGreaterThanOrEqual(1);
    expect(convertIssues[0].message).toContain('@battle');
  });
});
