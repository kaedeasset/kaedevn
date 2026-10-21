/**
 * @file ksConverter.test.ts
 * @description blocksToKs / pagesToKs / expandInlineTags のユニットテスト
 */
import { describe, it, expect } from 'vitest';
import { blocksToKs, pagesToKs, expandInlineTags } from '../src/ksConverter';
import { blockToKsBlocks } from '../src/blockToKsBlocks';
import { compile, KsParser, KsPrinter, KsScanner } from '../src/index';

// ===== expandInlineTags =====
describe('expandInlineTags', () => {
  it('タグなしはテキストのみ', () => {
    const result = expandInlineTags('Hello world');
    expect(result).toEqual([{ text: 'Hello world' }]);
  });

  it('[e:smile] → @ch_expr speaker smile', () => {
    const result = expandInlineTags('Hello[e:smile]world', 'hero');
    expect(result).toEqual([
      { text: 'Hello' },
      { command: '@ch_expr hero smile' },
      { text: 'world' },
    ]);
  });

  it('[m:idle] → @ch_motion speaker idle', () => {
    const result = expandInlineTags('[m:idle]', 'hero');
    expect(result).toEqual([{ command: '@ch_motion hero idle' }]);
  });

  it('[lip:off] → @ch_lip speaker off', () => {
    const result = expandInlineTags('[lip:off]', 'hero');
    expect(result).toEqual([{ command: '@ch_lip hero off' }]);
  });

  it('[wait:500] → @wait 0.5', () => {
    const result = expandInlineTags('[wait:500]', 'hero');
    expect(result).toEqual([{ command: '@wait 0.5' }]);
  });

  it('[click] → @l', () => {
    const result = expandInlineTags('[click]', 'hero');
    expect(result).toEqual([{ command: '@l' }]);
  });

  it('[cam:shake] → @shake', () => {
    const result = expandInlineTags('[cam:shake]', 'hero');
    expect(result).toEqual([{ command: '@shake' }]);
  });

  it('speaker なしでは展開されない (タグは消費される)', () => {
    const result = expandInlineTags('[e:smile]');
    // speaker がないので @ch_expr は生成されず、タグ自体も消費される
    expect(result).toEqual([]);
  });
});

// ===== blocksToKs =====
describe('blocksToKs', () => {
  it('空ブロックは空文字列', () => {
    const result = blocksToKs([]);
    expect(result.trim()).toBe('');
  });

  it('bg ブロック → @bg', () => {
    const result = blocksToKs([{ id: 'b1', type: 'bg', assetId: 'forest' }]);
    expect(result).toContain('@bg forest');
  });

  it('ch ブロック → @ch slug expr pos', () => {
    const result = blocksToKs(
      [{ id: 'b1', type: 'ch', characterId: 'hero', expressionId: 'smile', pos: 'C' }],
      [],
      [{ slug: 'hero', expressions: [{ slug: 'smile' }] }],
    );
    expect(result).toContain('@ch hero smile center');
  });

  it('ch_expr ブロック → @ch_expr (C-2: 明示ブロック)', () => {
    const chars = [{ slug: 'hero', expressions: [{ slug: 'smile' }, { slug: 'angry' }] }];
    const result = blocksToKs([
      { id: 'b1', type: 'ch', characterId: 'hero', expressionId: 'smile', pos: 'C' },
      { id: 'b2', type: 'ch_expr', characterId: 'hero', expressionId: 'angry' },
    ], [], chars);
    expect(result).toContain('@ch hero smile center');
    expect(result).toContain('@ch_expr hero angry');
  });

  it('ch_hide ブロック → @ch_hide', () => {
    const result = blocksToKs([
      { id: 'b1', type: 'ch_hide', characterId: 'hero' },
    ]);
    expect(result).toContain('@ch_hide hero');
  });

  it('text ブロック → テキスト + @l', () => {
    const result = blocksToKs([{ id: 'b1', type: 'text', body: 'Hello', speaker: '' }]);
    expect(result).toContain('Hello');
    expect(result).toContain('@l');
  });

  it('effect shake → @shake', () => {
    const result = blocksToKs([{ id: 'b1', type: 'effect', effect: 'shake', intensity: 5, duration: 300 }]);
    expect(result).toContain('@shake');
  });

  it('effect vignette → @filter → @wait → @filter_clear (duration を活かして自動解除)', () => {
    const result = blocksToKs([{ id: 'b1', type: 'effect', effect: 'vignette', intensity: 3, duration: 800 }]);
    // 3 op に展開される（KsPrinter は key=value 形式で出すので `sec=0.8`）
    expect(result).toContain('@filter vignette=');
    expect(result).toContain('@wait sec=0.8');
    expect(result).toContain('@filter_clear');
    // 順序確認: filter → wait → clear
    const filterIdx = result.indexOf('@filter ');
    const waitIdx = result.indexOf('@wait');
    const clearIdx = result.indexOf('@filter_clear');
    expect(filterIdx).toBeLessThan(waitIdx);
    expect(waitIdx).toBeLessThan(clearIdx);
  });

  it('effect blur → @filter blur → @wait → @filter_clear (GaussianBlur strength = intensity * 2)', () => {
    const result = blocksToKs([{ id: 'b1', type: 'effect', effect: 'blur', intensity: 5, duration: 1000 }]);
    // intensity 5 → blur strength 10
    expect(result).toContain('@filter blur=10');
    expect(result).toContain('@wait sec=1');
    expect(result).toContain('@filter_clear');
  });

  it('effect vignette: 出力 KS が compile() を通って正しい Op 列になる（end-to-end）', () => {
    const ks = '*start\n' + blocksToKs([
      { id: 'b1', type: 'effect', effect: 'vignette', intensity: 3, duration: 800 },
    ]);
    const result = compile(ks);
    // compile() は CompilationException を throw する設計なので、ここまで来た時点でパース成功。
    const opTypes = result.ops.map((o: any) => o.op);
    const filterIdx = opTypes.indexOf('SCREEN_FILTER');
    const waitIdx = opTypes.indexOf('WAIT_MS');
    const clearIdx = opTypes.indexOf('SCREEN_FILTER_CLEAR');
    expect(filterIdx).toBeGreaterThanOrEqual(0);
    expect(waitIdx).toBeGreaterThan(filterIdx);
    expect(clearIdx).toBeGreaterThan(waitIdx);
    // duration が ms 単位で正しく反映されている
    const waitOp: any = result.ops[waitIdx];
    expect(waitOp.ms).toBe(800);
    // filter / intensity も正しい
    const filterOp: any = result.ops[filterIdx];
    expect(filterOp.filter).toBe('vignette');
    expect(filterOp.intensity).toBeCloseTo(0.6, 5); // 3/5 = 0.6
  });

  it('screen_filter → @filter', () => {
    const result = blocksToKs([{ id: 'b1', type: 'screen_filter', filterType: 'sepia', intensity: 0.8 }]);
    expect(result).toContain('@filter');
    expect(result).toContain('sepia');
  });

  it('overlay → @overlay', () => {
    const result = blocksToKs([{ id: 'b1', type: 'overlay', assetId: 'rain', visible: true }]);
    expect(result).toContain('@overlay rain');
  });

  // 新規追加ブロック型
  it('camera → @camera', () => {
    const result = blocksToKs([{ id: 'b1', type: 'camera', x: 100, zoom: 1.5, time: 500 }]);
    expect(result).toContain('@camera');
  });

  it('camera reset → @camera reset', () => {
    const result = blocksToKs([{ id: 'b1', type: 'camera', reset: true }]);
    expect(result).toContain('@camera');
    expect(result).toContain('reset');
  });

  it('particle → @particle', () => {
    const result = blocksToKs([{ id: 'b1', type: 'particle', preset: 'snow', x: 640, y: 0 }]);
    expect(result).toContain('@particle');
    expect(result).toContain('snow');
  });

  it('color_adjust → @color_adjust', () => {
    const result = blocksToKs([{ id: 'b1', type: 'color_adjust', brightness: 0.1, contrast: 0, saturation: 0, temperature: 0 }]);
    expect(result).toContain('@color_adjust');
  });

  it('color_adjust 全ゼロ → 空', () => {
    const result = blocksToKs([{ id: 'b1', type: 'color_adjust', brightness: 0, contrast: 0, saturation: 0, temperature: 0 }]);
    expect(result).not.toContain('@color_adjust');
  });

  it('scroll_text → @scroll_text', () => {
    const result = blocksToKs([{ id: 'b1', type: 'scroll_text', text: 'Staff Credits', speed: 2 }]);
    expect(result).toContain('@scroll_text');
  });

  // 回帰: scroll_text を名前付き args { text: ... } で吐くと
  // ランタイムが `text=` を本文に取り込んでしまっていた (mode=play でスクロール本文に "text=" が出る)
  it('scroll_text の本文が compile を通しても保持される (text= プレフィックスが混入しない)', () => {
    const ks = pagesToKs('T', [{ id: 'p1', blocks: [
      { id: 's1', type: 'start' },
      { id: 'b1', type: 'scroll_text', text: 'Staff Credits Roll', speed: 2 },
    ] }]);
    const scenario = compile(ks, { scenarioId: 'test', validate: false });
    const op = scenario.ops.find((o: any) => o.op === 'SCROLL_TEXT') as any;
    expect(op).toBeDefined();
    expect(op.text).toBe('Staff Credits Roll');
    expect(op.speed).toBe(2);
  });

  it('call → @call', () => {
    const result = blocksToKs([{ id: 'b1', type: 'call', templateId: 'tmpl-001' }]);
    expect(result).toContain('@call');
    expect(result).toContain('tmpl-001');
  });

  it('live2d_ch visible → @live2d', () => {
    const result = blocksToKs([{ id: 'b1', type: 'live2d_ch', modelId: 'model1', modelPath: '/m.json', motionGroup: 'idle', motionIndex: 0, x: 640, y: 360, scale: 1, visible: true }]);
    expect(result).toContain('@live2d');
    expect(result).toContain('model1');
  });

  it('live2d_hide ブロック → @live2d_hide (C-2: 明示ブロック)', () => {
    const result = blocksToKs([{ id: 'b1', type: 'live2d_hide', modelId: 'model1' }]);
    expect(result).toContain('@live2d_hide model1');
  });

  it('live2d_motion ブロック → @live2d_motion', () => {
    const result = blocksToKs([{ id: 'b1', type: 'live2d_motion', modelId: 'hiyori', motionGroup: 'TapBody', motionIndex: 0 }]);
    expect(result).toContain('@live2d_motion');
    expect(result).toContain('hiyori');
    expect(result).toContain('TapBody');
  });

  it('live2d_expression ブロック → @live2d_expression', () => {
    const result = blocksToKs([{ id: 'b1', type: 'live2d_expression', modelId: 'hiyori', expression: 'smile' }]);
    expect(result).toContain('@live2d_expression');
    expect(result).toContain('hiyori');
    expect(result).toContain('smile');
  });

  it('vrm_hide ブロック → @vrmHide', () => {
    const result = blocksToKs([{ id: 'b1', type: 'vrm_hide', modelId: 'hero', fadeMs: 500 }]);
    expect(result).toContain('@vrmHide');
  });

  it('vrm_expression ブロック → @vrmExpression', () => {
    const result = blocksToKs([{ id: 'b1', type: 'vrm_expression', modelId: 'hero', expression: 'happy' }]);
    expect(result).toContain('@vrmExpression happy');
  });

  it('vrm_pose ブロック → @vrmPose', () => {
    const result = blocksToKs([{ id: 'b1', type: 'vrm_pose', modelId: 'hero', pose: 'aPose' }]);
    expect(result).toContain('@vrmPose aPose');
  });

  // ── sprite 系の positional 出力（args の { 値: true } キー表現だと壊れるケース）──
  // 経緯: docs/09_reports/2026/07/10/01 指摘#4/#5。KsPrinter は args のキー順で
  // emit するため、キー表現では (a) spriteId === storage の同値キー潰れ、
  // (b) 純数値 slug の integer-like キー並べ替え、が起きる。positional で固定する。

  it('sprite: spriteId とアセット slug が同名でも両方 emit される（キー潰れ回帰）', () => {
    const ks = blocksToKs([{ id: 'b1', type: 'sprite', spriteId: 'logo', assetId: 'logo', x: 100 }]);
    expect(ks).toContain('@sprite logo logo x=100');
    const { ops } = compile(ks);
    const op = ops.find((o: any) => o.op === 'SPRITE_SET') as any;
    expect(op.id).toBe('logo');
    expect(op.storage).toBe('logo');
    expect(op.x).toBe(100);
  });

  it('sprite: 純数値 slug でも positional 順序が保たれる（integer-like キー並べ替え回帰）', () => {
    const ks = blocksToKs([{ id: 'b1', type: 'sprite', spriteId: 'photo', assetId: '3' }]);
    expect(ks).toContain('@sprite photo 3');
    const { ops } = compile(ks);
    const op = ops.find((o: any) => o.op === 'SPRITE_SET') as any;
    expect(op.id).toBe('photo');
    expect(op.storage).toBe('3');
  });

  it('text_sprite: positional 移行後も id/本文/named args が round-trip する', () => {
    const ks = blocksToKs([{
      id: 'b1', type: 'text_sprite', spriteId: 't1', text: 'こんにちは 世界',
      x: 100, y: 200, size: 32, color: '#ffcc00', bold: true,
    }]);
    expect(ks).toContain('@text t1 "こんにちは 世界" x=100 y=200 size=32 color=#ffcc00 bold=true');
    const { ops } = compile(ks);
    const op = ops.find((o: any) => o.op === 'TEXT_SPRITE_SET') as any;
    expect(op.id).toBe('t1');
    expect(op.text).toBe('こんにちは 世界');
    expect(op.bold).toBe(true);
    expect(op.size).toBe(32);
  });

  // ── tech-sample1 実データ検証（2026-07-10）で見つかった欠陥の回帰 ──

  it('ksc の @コマンドは引数を原文どおり再出力する（引数消失回帰）', () => {
    // args: {} で emit すると `@timeline_play tl_x` の tl_x が落ち compile が INVALID_ARGS
    const ks = blocksToKs([{ id: 'b1', type: 'ksc', script: '@timeline_play mtext_1__bounce__500' }]);
    expect(ks.trim()).toBe('@timeline_play mtext_1__bounce__500');
  });

  // ── 2026-07-11 全体レビュー実装で見つかった emit/parse 非対称の回帰 ──

  it('timeline ブロック → @timeline_play id=... が TIMELINE_PLAY に正しく解決される（end-to-end）', () => {
    // blocksToKs は `@timeline_play id=<id>` で emit する。旧パーサは args[0] を
    // そのまま timelineId に使い "id=tl-001" になっていた（Play で Timeline not found）。
    const ks = '*start\n' + blocksToKs([{ id: 'b1', type: 'timeline', id: 'tl-001' }]);
    const result = compile(ks);
    const op: any = result.ops.find((o: any) => o.op === 'TIMELINE_PLAY');
    expect(op.timelineId).toBe('tl-001');
  });

  it('@timeline_play の positional 形式も従来どおり解決される', () => {
    const result = compile('*start\n@timeline_play tl-abc');
    const op: any = result.ops.find((o: any) => o.op === 'TIMELINE_PLAY');
    expect(op.timelineId).toBe('tl-abc');
  });

  it('vrm ブロック → @vrmShow pos=/rotY= が VRM_SHOW に正しく解決される（end-to-end）', () => {
    // blocksToKs は `pos=center` の key=value で emit するが、旧パーサは
    // `pos center` のペア形式しか読まず pos/rotY が落ちていた。
    const ks = '*start\n' + blocksToKs([{ id: 'b1', type: 'vrm', modelId: 'hero', pos: 'L', rotY: 20 }]);
    const result = compile(ks);
    const op: any = result.ops.find((o: any) => o.op === 'VRM_SHOW');
    expect(op.pos).toBe('left');
    expect(op.rotY).toBe(20);
  });

  it('@vrmShow の positional ペア形式（pos center）も従来どおり解決される', () => {
    const result = compile('*start\n@vrmShow hero pos center rotY 15');
    const op: any = result.ops.find((o: any) => o.op === 'VRM_SHOW');
    expect(op.pos).toBe('center');
    expect(op.rotY).toBe(15);
  });

  it('text body 内の \\n は @r に分解して emit する（複数行分割回帰）', () => {
    // \n をそのまま content に持たせると KsPrinter が複数行に割り、再取込で別テキストに分裂する
    const ks = blocksToKs([{ id: 'b1', type: 'text', body: '一行目\n二行目' }]);
    const lines = ks.split('\n').filter((l: string) => l.trim());
    const i1 = lines.indexOf('一行目');
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(lines[i1 + 1]).toBe('@r');
    expect(lines[i1 + 2]).toBe('二行目');
    // runtime でも TEXT_NL として通る
    const { ops } = compile(ks);
    expect(ops.map((o: any) => o.op)).toContain('TEXT_NL');
  });
});

// ===== KsScanner positional =====
describe('KsScanner positional（位置引数の順序・重複保持）', () => {
  it('@sprite left left x=0 → positional [left, left]（args キー潰れの回避）', () => {
    const ast = new KsParser().parse('@sprite left left x=0 y=0');
    const b = ast.blocks[0];
    expect(b.command).toBe('sprite');
    expect(b.positional).toEqual(['left', 'left']);
    expect(b.args?.x).toBe(0);
  });

  it('named 引数は positional に含まれない', () => {
    const ast = new KsParser().parse('@bgm main_theme vol=80');
    expect(ast.blocks[0].positional).toEqual(['main_theme']);
  });

  // ── 2026-07-11 全体レビュー #7/#8（KsScanner round-trip）の回帰 ──

  it('値中の = を切り詰めない（exp=f.score>=10 が f.score> に化ける回帰）', () => {
    const blocks = new KsScanner().scan('@if exp=f.score>=10');
    expect(blocks[0].args?.exp).toBe('f.score>=10');
  });

  it('位置引数は positional のみに保存し args に { 値: true } で重複しない', () => {
    const ast = new KsParser().parse('@sprite left x=0');
    const b = ast.blocks[0];
    expect(b.positional).toEqual(['left']);
    expect(b.args?.left).toBeUndefined();
  });

  it('scan→print round-trip: @sprite left が @sprite left left に増殖しない', () => {
    const printed = new KsPrinter().print(new KsParser().parse('@sprite left x=0'));
    expect(printed.trim()).toBe('@sprite left x=0');
  });

  it('scan→print round-trip: 重複位置引数と named 引数の混在が原文どおり保たれる', () => {
    const printed = new KsPrinter().print(new KsParser().parse('@sprite left left x=0 y=0'));
    expect(printed.trim()).toBe('@sprite left left x=0 y=0');
  });
});

// ===== pagesToKs =====
describe('pagesToKs', () => {
  it('空ページ → ヘッダーのみ', () => {
    const result = pagesToKs('Test', [{ id: 'p1', blocks: [] }]);
    expect(result).toContain('*start');
    expect(result).toContain('Title: Test');
    expect(result).toContain('_page = 1');
    expect(result).toContain('_totalPages = 1');
  });

  it('複数ページ → ページラベル生成', () => {
    const result = pagesToKs('Test', [
      { id: 'p1', blocks: [] },
      { id: 'p2', blocks: [] },
      { id: 'p3', blocks: [] },
    ]);
    expect(result).toContain('*start');
    expect(result).toContain('*page2');
    expect(result).toContain('*page3');
    expect(result).toContain('_totalPages = 3');
  });

  it('jump ブロックの toPageId → ラベル解決', () => {
    const result = pagesToKs('Test', [
      { id: 'p1', blocks: [{ id: 'b1', type: 'jump', toPageId: 'p2' }] },
      { id: 'p2', blocks: [] },
    ]);
    // ランタイム Parser は args[0] をラベル名として読むため positional で emit する
    expect(result).toContain('@jump page2');
  });

  it('ブロック内容が変換される', () => {
    const result = pagesToKs('Test', [
      { id: 'p1', blocks: [
        { id: 'b1', type: 'bg', assetId: 'sky' },
        { id: 'b2', type: 'text', body: 'Hello', speaker: '' },
      ]},
    ]);
    expect(result).toContain('@bg sky');
    expect(result).toContain('Hello');
    expect(result).toContain('@l');
  });

  // Regression: bg / ch の x/y/s が出力に乗らないと、Play 画面で位置が 0,0 のまま無視される。
  it('bg の x/y/s が key=value で emit される', () => {
    const result = pagesToKs('Test', [
      { id: 'p1', blocks: [
        { id: 'b1', type: 'bg', assetId: 'sky', x: 80, y: -40, s: 1.3 },
      ]},
    ]);
    expect(result).toContain('@bg sky x=80 y=-40 s=1.3');
  });

  it('ch の x/y/s が key=value で emit される', () => {
    const result = pagesToKs('Test', [
      { id: 'p1', blocks: [
        { id: 'b1', type: 'ch', characterId: 'hero', expressionId: 'normal', pos: 'C', s: 1.4, y: 40 },
      ]},
    ], [], [
      { slug: 'hero', name: '勇者', expressions: [{ slug: 'normal', kind: 'static' }] } as any,
    ]);
    expect(result).toMatch(/@ch hero normal center .*s=1\.4/);
    expect(result).toMatch(/@ch hero normal center .*y=40/);
  });
});

// ===== blockToKsBlocks の id（決定的） =====
describe('blockToKsBlocks ids', () => {
  const choice = {
    type: 'choice',
    options: [
      { text: 'A', actions: [{ type: 'set_var', varName: 'x', operator: '=', value: 1 }, { type: 'text', speaker: 'hero', body: 'hi' }] },
      { text: 'B', actions: [{ type: 'jump', toPageId: 'p2' }] },
    ],
  };

  it('id の無いブロックは親 id＋連番で、同じ入力から同じ id を出す', () => {
    const a = blockToKsBlocks(choice, [], [], undefined, {}, 'gen-3');
    const b = blockToKsBlocks(choice, [], [], undefined, {}, 'gen-3');
    expect(a).toEqual(b);
    expect(a.map(k => k.id)).toEqual([
      'gen-3-open',
      'gen-3-opt0-open', 'gen-3-opt0-act0', 'gen-3-opt0-act1-speaker', 'gen-3-opt0-act1-body', 'gen-3-opt0-act1-l', 'gen-3-opt0-close',
      'gen-3-opt1-open', 'gen-3-opt1-act0', 'gen-3-opt1-close',
      'gen-3-close',
    ]);
    expect(new Set(a.map(k => k.id)).size).toBe(a.length);
  });

  it('if の入れ子は then / else の連番で id を付ける', () => {
    const ids = blockToKsBlocks(
      { type: 'if', conditions: [], thenBlocks: [{ type: 'jump', toPageId: 'p' }], elseBlocks: [{ type: 'set_var', varName: 'x', operator: '=', value: 1 }] },
      [], [], undefined, {}, 'gen-0',
    ).map(k => k.id);
    expect(ids).toEqual(['gen-0-open', 'gen-0-then0', 'gen-0-else', 'gen-0-else0', 'gen-0-close']);
  });
});
