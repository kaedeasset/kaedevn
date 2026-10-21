import { describe, expect, it } from 'vitest';
import { convertTyranoToKs, convertTyranoToScenario, parseTyrano, collectCharacterManifest, collectMacros, collectKeyframes, compile } from '../src/index';

describe('parseTyrano', () => {
  it('tokenizes inline text and tags in order', () => {
    const ast = parseTyrano('本文[l]続き[p]');

    expect(ast.map((node) => node.type)).toEqual(['text', 'tag', 'text', 'tag']);
    expect(ast[0]).toMatchObject({ type: 'text', text: '本文' });
    expect(ast[1]).toMatchObject({ type: 'tag', name: 'l' });
    expect(ast[2]).toMatchObject({ type: 'text', text: '続き' });
    expect(ast[3]).toMatchObject({ type: 'tag', name: 'p' });
  });

  it('preserves unsafe script and macro blocks for diagnostics', () => {
    const ast = parseTyrano([
      '[iscript]',
      'tf.flag = true;',
      '[endscript]',
      '[macro name="shake_text"]',
      '[endmacro]',
    ].join('\n'));

    expect(ast).toHaveLength(2);
    expect(ast[0]).toMatchObject({ type: 'block', name: 'iscript' });
    expect(ast[1]).toMatchObject({ type: 'block', name: 'macro' });
  });
});

describe('convertTyranoToKs', () => {
  it('converts minimum visual novel commands to kaedevn ks', () => {
    const result = convertTyranoToKs([
      '*start',
      '[bg storage="room.png"]',
      '#主人公',
      'ここはどこだろう。[l]',
      '[chara_show name="hero" storage="hero_normal.png"]',
      '[chara_mod name="hero" storage="smile.png"]',
      '[playbgm storage="main.ogg"]',
      '[playse storage="click.ogg"]',
      '[wait time="500"]',
      '[cm]',
      '[stopbgm]',
      '[return]',
    ].join('\n'));

    expect(result.ks).toContain('*start');
    expect(result.ks).toContain('@bg room');
    expect(result.ks).toContain('#主人公');
    expect(result.ks).toContain('ここはどこだろう。');
    expect(result.ks).toContain('@l');
    expect(result.ks).toContain('@ch hero normal center');
    expect(result.ks).toContain('@ch_expr hero smile');
    expect(result.ks).toContain('@bgm main');
    expect(result.ks).toContain('@se click');
    expect(result.ks).toContain('@wait 0.5');
    expect(result.ks).toContain('@text_clear all');
    expect(result.ks).toContain('@bgm_stop');
    expect(result.ks).toContain('@return');
    expect(result.summary.supportedCommandCounts.bg).toBe(1);
    // [cm] は @text_clear に正規変換され warning を残さない（Phase 1-A）
    expect(result.summary.warningCount).toBe(0);
  });

  it('converts glink and s to a kaedevn choice block', () => {
    const result = convertTyranoToKs([
      '*start',
      '[glink text="外へ出る" target="outside"]',
      '[glink text="寝る" target="sleep"]',
      '[s]',
      '*outside',
      '外に出た。[p]',
      '*sleep',
      '眠った。[p]',
    ].join('\n'));

    expect(result.ks).toContain('choice {');
    expect(result.ks).toContain('"外へ出る" {');
    expect(result.ks).toContain('@jump outside');
    expect(result.ks).toContain('"寝る" {');
    expect(result.ks).toContain('@jump sleep');
  });

  it('converts [cm]/[er]/[stopse] to the new @text_clear/@se_stop commands (Phase 1-A)', () => {
    const result = convertTyranoToKs([
      '本文[cm]',
      '別の本文[er]',
      '[stopse]',
    ].join('\n'));

    expect(result.ks).toContain('@text_clear all');
    expect(result.ks).toContain('@text_clear current');
    expect(result.ks).toContain('@se_stop');
    // 旧: [cm]→@p 代用 / [stopse]→no-op の warning が消えている
    expect(result.summary.warningCount).toBe(0);
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('compiles Phase 1-A output through the existing kaedevn pipeline', () => {
    const result = convertTyranoToScenario([
      '*start',
      '本文[cm]',
      '別の本文[er]',
      '[stopse]',
    ].join('\n'), { scenarioId: 'tyrano-1a', validate: false });

    const ops = result.scenario.ops.map((op) => op.op);
    expect(ops.filter((o) => o === 'TEXT_CLEAR')).toHaveLength(2);
    expect(ops).toContain('SE_STOP');
  });

  it('protects body text that looks like a KS assignment so it compiles as text', () => {
    // Tyrano の地の文 `time=%time...` は KS だと VAR_SET 誤判定で compile が落ちる。
    const result = convertTyranoToScenario('time=%timeに着目してね。[p]', { scenarioId: 't', validate: false });
    const ops = result.scenario.ops.map((o) => o.op);
    // 代入(VAR_SET/VAR_ADD)ではなくテキストとして扱われる
    expect(ops).toContain('TEXT_APPEND');
    expect(ops).not.toContain('VAR_SET');
    // 表示テキストは元のまま（無害化はゼロ幅スペースの付与のみ）
    const textOp = result.scenario.ops.find((o) => o.op === 'TEXT_APPEND');
    expect(textOp.text).toContain('time=%timeに着目してね。');
    // 通常の [eval] 代入は引き続き VAR_SET になる（無害化と衝突しない）
    const evalR = convertTyranoToScenario('[eval exp="f.love = 5"]', { scenarioId: 't2', validate: false });
    expect(evalR.scenario.ops.map((o) => o.op)).toContain('VAR_SET');
  });

  it('converts cross-file [jump]/[call]/[glink storage=] to the file-crossing @jump syntax (Phase 5-A)', () => {
    const result = convertTyranoToKs([
      '[jump storage="chapter01/020_school.ks" target="*start"]',
      '[call storage="_common.ks"]',
      '[jump target="local_label"]',
    ].join('\n'));

    // storage(ファイル) + target(ラベル) → @jump <path> <label>
    expect(result.ks).toContain('@jump chapter01/020_school.ks start');
    // storage のみ → @call <path>
    expect(result.ks).toContain('@call _common.ks');
    // target のみ（ファイル内）→ @jump <label>
    expect(result.ks).toContain('@jump local_label');
    // storage= を黙って落とさない（旧バグの回帰防止）
    expect(result.ks).not.toContain('@jump start\n');
  });

  it('converts [glink storage=] to a cross-file choice jump (Phase 5-A)', () => {
    const result = convertTyranoToKs([
      '[glink text="次へ" storage="chapter02/010_intro.ks" target="*start"]',
      '[s]',
    ].join('\n'));
    expect(result.ks).toContain('choice {');
    expect(result.ks).toContain('@jump chapter02/010_intro.ks start');
  });

  it('converts [mask]/[mask_off]/[camera]/[wait_camera] (Phase 4-D)', () => {
    const result = convertTyranoToKs([
      '[mask color="#000000" opacity="0.8" time="300"]',
      '[mask_off time="200"]',
      '[camera x="100" y="50" scale="1.5" time="500"]',
      '[reset_camera]',
      '[wait_camera]',
    ].join('\n'));

    expect(result.ks).toContain('@mask color=#000000 opacity=0.8 time=300');
    expect(result.ks).toContain('@mask_clear time=200');
    expect(result.ks).toContain('@camera x=100 y=50 zoom=1.5 time=500');
    expect(result.ks).toContain('@camera reset');
    expect(result.ks).toContain('@wait_camera');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('compiles @mask/@camera/@wait_camera through the pipeline (Phase 4-D)', () => {
    const result = convertTyranoToScenario([
      '[mask color="#000000"]',
      '[camera x="10"]',
      '[wait_camera]',
      '[mask_off]',
    ].join('\n'), { scenarioId: 'tyrano-4d', validate: true });
    const ops = result.scenario.ops.map((op) => op.op);
    expect(ops).toContain('MASK_SET');
    expect(ops).toContain('CAMERA_SET');
    expect(ops).toContain('WAIT_CAMERA');
    expect(ops).toContain('MASK_CLEAR');
  });

  it('converts [layopt]/[trans]/[wt] to @layer/@transition/@wait_transition (Phase 4-C)', () => {
    const result = convertTyranoToKs([
      '[layopt layer="fore" visible="false"]',
      '[trans layer="fore" time="500"]',
      '[wt]',
    ].join('\n'));

    expect(result.ks).toContain('@layer name=overlay visible=false');
    expect(result.ks).toContain('@transition type=fade target=overlay time=500');
    expect(result.ks).toContain('@wait_transition');
    // [wt] は @wait 0.5 ではなくなった
    expect(result.ks).not.toContain('@wait 0.5');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('compiles @layer/@transition/@wait_transition through the pipeline (Phase 4-C)', () => {
    const result = convertTyranoToScenario([
      '[trans time="300"]',
      '[wt]',
      '[layopt layer="background" opacity="0.5"]',
    ].join('\n'), { scenarioId: 'tyrano-4c', validate: true });
    const ops = result.scenario.ops.map((op) => op.op);
    expect(ops).toContain('TRANSITION');
    expect(ops).toContain('WAIT_TRANSITION');
    expect(ops).toContain('LAYER_SET');
  });

  it('converts [image]/[freeimage]/[free] to @sprite commands (Phase 4-B)', () => {
    const result = convertTyranoToKs([
      '[image name="photo" storage="photo.png" layer="fore" left="100" top="200"]',
      '[image storage="sky.png" layer="background"]',   // 背景相当 → @bg
      '[free name="photo"]',
      '[freeimage time="300"]',
    ].join('\n'));

    expect(result.ks).toContain('@sprite photo photo layer=front x=100 y=200');
    expect(result.ks).toContain('@bg sky');
    expect(result.ks).toContain('@sprite_hide photo');
    expect(result.ks).toContain('@sprite_clear fade=300');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('compiles @sprite output through the kaedevn pipeline (Phase 4-B)', () => {
    const result = convertTyranoToScenario([
      '[image name="photo" storage="photo.png" left="50" top="60"]',
      '[free name="photo"]',
    ].join('\n'), { scenarioId: 'tyrano-sprite', validate: true });
    const ops = result.scenario.ops.map((op) => op.op);
    expect(ops).toContain('SPRITE_SET');
    expect(ops).toContain('SPRITE_HIDE');
  });

  it('converts [filter]/[free_filter] where names overlap (Phase 4-A)', () => {
    const result = convertTyranoToKs([
      '[filter sepia="0.5"]',
      '[filter blur="3"]',
      '[free_filter]',
      '[filter brightness="1.2"]', // kaedevn に無い → 診断
    ].join('\n'));

    expect(result.ks).toContain('@filter sepia');
    expect(result.ks).toContain('@filter blur');
    expect(result.ks).toContain('@filter_clear');
    // brightness は対象外
    const unsupported = result.issues.filter((i) => i.severity === 'unsupported').map((i) => i.command);
    expect(unsupported).toContain('filter');
  });

  it('converts [if]/[elsif]/[else] and safe [eval] to KS (Phase 3)', () => {
    const result = convertTyranoToKs([
      '[eval exp="f.love = 0"]',
      '[eval exp="f.love += 5"]',
      '[if exp="f.love >= 10"]',
      '大好き！[l]',
      '[elsif exp="f.love >= 3"]',
      'ふつう。[l]',
      '[else]',
      'きらい。[l]',
      '[endif]',
    ].join('\n'));

    expect(result.ks).toContain('love = 0');
    expect(result.ks).toContain('love += 5');
    // if/elsif/else はネスト展開・各ブレース独立行
    expect(result.ks).toContain('if (love >= 10) {');
    expect(result.ks).toContain('} else {');
    expect(result.ks).toContain('if (love >= 3) {');
    expect(result.summary.unsupportedCount).toBe(0);
    expect(result.summary.warningCount).toBe(0);
  });

  it('compiles converted if/elsif/else through the kaedevn pipeline (Phase 3)', () => {
    const result = convertTyranoToScenario([
      '[eval exp="f.flag = 1"]',
      '[if exp="f.flag == 1"]',
      'A[p]',
      '[elsif exp="f.flag == 2"]',
      'B[p]',
      '[else]',
      'C[p]',
      '[endif]',
    ].join('\n'), { scenarioId: 'tyrano-if', validate: true });

    const ops = result.scenario.ops.map((op) => op.op);
    expect(ops).toContain('VAR_SET');
    expect(ops).toContain('JUMP_IF');
  });

  it('leaves out-of-subset [if]/[eval] as diagnostics (Phase 3)', () => {
    const result = convertTyranoToKs([
      '[eval exp="f.name = \'aoi\'"]',       // 文字列代入 → 対象外
      '[eval exp="f.a *= 2"]',               // 乗算代入 → 対象外
      '[if exp="f.a == 1 && f.b == 2"]',     // && → 対象外（ブロック全体を診断）
      'X[p]',
      '[endif]',
    ].join('\n'));

    const unsupported = result.issues.filter((i) => i.severity === 'unsupported').map((i) => i.command);
    expect(unsupported).toContain('eval');
    expect(unsupported).toContain('if');
    // 対象外の [if] 本文は出力されない（診断のみ）
    expect(result.ks).not.toContain('if (');
  });

  it('warns and converts tf. scope variables (Phase 3)', () => {
    const result = convertTyranoToKs([
      '[eval exp="tf.count += 1"]',
      '[if exp="tf.count >= 2"]',
      'done[p]',
      '[endif]',
    ].join('\n'));

    expect(result.ks).toContain('count += 1');
    expect(result.ks).toContain('if (count >= 2) {');
    expect(result.summary.warningCount).toBeGreaterThan(0);
  });

  it('collects a character manifest from [chara_new]/[chara_face] and resolves expressions (Phase 2)', () => {
    const result = convertTyranoToKs([
      '[chara_new name="akane" storage="akane_normal.png" jname="赤音"]',
      '[chara_face name="akane" face="smile" storage="akane_smile.png"]',
      '[chara_face name="akane" face="angry" storage="akane_angry.png"]',
      '*start',
      '[chara_show name="akane"]',
      '[chara_mod name="akane" face="smile"]',
      '[chara_mod name="akane" storage="akane_angry.png"]',
    ].join('\n'));

    // manifest
    expect(result.manifest).toHaveLength(1);
    const akane = result.manifest[0];
    expect(akane.slug).toBe('akane');
    expect(akane.name).toBe('赤音');
    expect(akane.defaultExpressionId).toBe('normal');
    expect(akane.expressions.map((e) => e.slug)).toEqual(['normal', 'smile', 'angry']);

    // declaration tags emit nothing to the KS body
    expect(result.ks).not.toContain('chara_new');
    expect(result.ks).not.toContain('chara_face');
    // resolution
    expect(result.ks).toContain('@ch akane normal center'); // chara_show → default expr
    expect(result.ks).toContain('@ch_expr akane smile');     // face 指定
    expect(result.ks).toContain('@ch_expr akane angry');     // storage → face slug 解決
    expect(result.summary.warningCount).toBe(0);
  });

  it('collects a manifest across multiple files (definitions separate from body)', () => {
    const manifest = collectCharacterManifest([
      '[chara_new name="hero" storage="hero.png" jname="主人公"]\n[chara_face name="hero" face="cry" storage="hero_cry.png"]',
    ]);
    // body file has no [chara_new] — resolution must use the external manifest
    const result = convertTyranoToKs('[chara_mod name="hero" storage="hero_cry.png"]', { manifest });
    expect(result.ks).toContain('@ch_expr hero cry');
    expect(result.summary.warningCount).toBe(0);
  });

  it('warns when referencing an undefined character or expression', () => {
    const result = convertTyranoToKs([
      '[chara_show name="ghost"]',
      '[chara_new name="akane" storage="akane.png"]',
      '[chara_mod name="akane" face="unknown"]',
    ].join('\n'));

    const warns = result.issues.filter((i) => i.severity === 'warning').map((i) => i.command);
    expect(warns).toContain('chara_show'); // ghost 未定義
    expect(warns).toContain('chara_mod');  // unknown 表情未定義
  });

  it('converts BGM/SE fade and volume tags (Phase 1-A part 2)', () => {
    const result = convertTyranoToKs([
      '[fadeinbgm storage="main.ogg" time="2000" volume="80"]',
      '[fadeoutbgm time="1500"]',
      '[bgmopt volume="50"]',
      '[playbgm storage="calm.ogg"]',
      '[seopt volume="60"]',
      '[playse storage="click.ogg"]',
      '[playse storage="door.ogg" volume="90"]',
    ].join('\n'));

    expect(result.ks).toContain('@bgm main fade=2000 vol=80');
    expect(result.ks).toContain('@bgm_stop fade=1500');
    // [bgmopt volume=50] は後続の [playbgm] に vol を引き継ぐ
    expect(result.ks).toContain('@bgm calm vol=50');
    // [seopt volume=60] は後続の [playse] に引き継ぎ、タグ自身の volume が優先される
    expect(result.ks).toContain('@se click vol=60');
    expect(result.ks).toContain('@se door vol=90');
    expect(result.summary.unsupportedCount).toBe(0);
    expect(result.summary.warningCount).toBe(0);
  });

  it('converts Phase 1-B character and effect tags to existing kaedevn commands', () => {
    const result = convertTyranoToKs([
      '[chara_hide_all time="300"]',
      '[chara_move name="hero" left="1100" time="500"]',
      '[quake time="800" hmax="20"]',
      '[quake2 time="600" hmax="15"]',
      '[wt]',
    ].join('\n'));

    expect(result.ks).toContain('@ch_clear fade=300');
    expect(result.ks).toContain('@ch_move hero right time=500');
    expect(result.ks).toContain('@shake intensity=20 duration=800');
    // [wt] は Phase 4-C で @wait_transition に正式化された
    expect(result.ks).toContain('@wait_transition');

    // approximate conversions leave a warning trail
    const warnCommands = result.issues.filter((i) => i.severity === 'warning').map((i) => i.command);
    expect(warnCommands).toContain('chara_move');
    expect(warnCommands).toContain('quake2');

    // no longer reported as unsupported
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('compiles Phase 1-B output through the existing kaedevn pipeline', () => {
    const result = convertTyranoToScenario([
      '*start',
      '[chara_hide_all]',
      '[chara_move name="hero" left="200"]',
      '[quake]',
      '[wt]',
    ].join('\n'), { scenarioId: 'tyrano-1b', validate: false });

    const ops = result.scenario.ops.map((op) => op.op);
    expect(ops).toContain('CH_CLEAR');
    expect(ops).toContain('CH_MOVE');
    expect(ops).toContain('SHAKE');
    expect(ops).toContain('WAIT_TRANSITION');
  });

  it('reports unsupported commands without mixing them into text', () => {
    // f.flag=true は P6-4 で変換可能になったため、変数間代入（サブセット外）を使う
    const result = convertTyranoToKs([
      '開始',
      '[eval exp="f.flag=f.other"]',
      '[iscript]',
      'alert("x")',
      '[endscript]',
      '終了[p]',
    ].join('\n'));

    expect(result.ks).toContain('開始');
    expect(result.ks).toContain('終了');
    expect(result.ks).not.toContain('eval');
    expect(result.ks).not.toContain('alert');
    expect(result.summary.unsupportedCount).toBe(2);
    expect(result.summary.rank).toBe('C');
    expect(result.issues.map((issue) => issue.command)).toEqual(['eval', 'iscript']);
  });
});

describe('macro expansion (P6-1)', () => {
  it('expands a no-argument macro into its convertible body', () => {
    const result = convertTyranoToKs([
      '[macro name="clearall"]',
      '[cm]',
      '[stopbgm]',
      '[endmacro]',
      '[clearall]',
    ].join('\n'));

    expect(result.ks).toContain('@text_clear all');
    expect(result.ks).toContain('@bgm_stop');
    expect(result.summary.unsupportedCount).toBe(0);
    // マクロ定義（block）と呼び出し（tag）の両方が supported として数えられる
    expect(result.summary.supportedCommandCounts.macro).toBe(1);
    expect(result.summary.supportedCommandCounts.clearall).toBe(1);
  });

  it('substitutes %param and %param|default from the call-site arguments', () => {
    const result = convertTyranoToKs([
      '[macro name="showbg"]',
      '[bg storage="%img"]',
      '[wait time="%delay|500"]',
      '[endmacro]',
      '[showbg img="room.png" delay="1000"]',
      '[showbg img="beach.png"]',
    ].join('\n'));

    expect(result.ks).toContain('@bg room');
    expect(result.ks).toContain('@wait 1');
    expect(result.ks).toContain('@bg beach');
    // delay 省略時はデフォルト 500ms → 0.5s
    expect(result.ks).toContain('@wait 0.5');
  });

  it('re-parses the raw body so a nested [if] block converts correctly', () => {
    const result = convertTyranoToKs([
      '[macro name="branchy"]',
      '[if exp="f.score >= 10"]',
      '勝ち[p]',
      '[else]',
      '負け[p]',
      '[endif]',
      '[endmacro]',
      '[branchy]',
    ].join('\n'));

    expect(result.ks).toContain('if (score >= 10) {');
    expect(result.ks).toContain('} else {');
    expect(result.ks).toContain('勝ち');
    expect(result.ks).toContain('負け');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('reports cyclic macro expansion as unsupported instead of recursing forever', () => {
    const result = convertTyranoToKs([
      '[macro name="a"]',
      '[b]',
      '[endmacro]',
      '[macro name="b"]',
      '[a]',
      '[endmacro]',
      '[a]',
    ].join('\n'));

    const cyclic = result.issues.find((i) => i.message.includes('cyclic'));
    expect(cyclic).toBeDefined();
    expect(cyclic?.severity).toBe('unsupported');
  });

  it('reports a macro call whose argument contains a double quote as unsupported', () => {
    const result = convertTyranoToKs([
      '[macro name="say"]',
      '[bg storage="%img"]',
      '[endmacro]',
      "[say img='a\"b.png']",
    ].join('\n'));

    const issue = result.issues.find((i) => i.command === 'say');
    expect(issue?.severity).toBe('unsupported');
    expect(issue?.message).toContain('double quote');
  });

  it('converts [chara_ptext] to a speaker line using the manifest display name', () => {
    const result = convertTyranoToKs([
      '[chara_new name="akane" jname="あかね" storage="akane.png"]',
      '[chara_ptext name="akane"]',
      '[chara_ptext name="mob"]',
    ].join('\n'));

    expect(result.ks).toContain('#あかね');
    expect(result.ks).toContain('#mob');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('expands macros defined in another file via the macros option', () => {
    const macros = collectMacros(['[macro name="cutin"]\n[playse storage="cutin.ogg"]\n[endmacro]']);
    const result = convertTyranoToKs('[cutin]', { macros });

    expect(result.ks).toContain('@se cutin');
    expect(result.summary.unsupportedCount).toBe(0);
  });
});

describe('[ptext] → @text conversion (P6-2)', () => {
  it('converts a static [ptext] to @text with mapped attributes', () => {
    const result = convertTyranoToKs(
      '[ptext name="title" text="はじまりの朝" x="100" y="50" size="32" color="0xffcc00" bold="true" layer="1"]',
    );

    expect(result.ks).toContain('@text title "はじまりの朝" x=100 y=50 size=32 color=#ffcc00 bold=true');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('auto-numbers the id when [ptext] has no name attribute', () => {
    const result = convertTyranoToKs([
      '[ptext text="一つ目"]',
      '[ptext text="二つ目"]',
    ].join('\n'));

    expect(result.ks).toContain('@text ptext_1 "一つ目"');
    expect(result.ks).toContain('@text ptext_2 "二つ目"');
  });

  it('reports [ptext] with a JS expression attribute as unsupported', () => {
    const result = convertTyranoToKs('[ptext name="dyn" text="&f.msg" x="10"]');

    const issue = result.issues.find((i) => i.command === 'ptext');
    expect(issue?.severity).toBe('unsupported');
    expect(result.ks).not.toContain('@text dyn');
  });

  it('compiles converted @text through the pipeline into TEXT_SPRITE_SET', () => {
    const result = convertTyranoToScenario(
      '[ptext name="title" text="はじまり の朝" x="100" time="300"]',
      { scenarioId: 'ptext-test', validate: false },
    );

    const op = result.scenario.ops.find((o) => o.op === 'TEXT_SPRITE_SET');
    expect(op).toMatchObject({ op: 'TEXT_SPRITE_SET', id: 'title', text: 'はじまり の朝', x: 100, fadeMs: 300 });
  });
});

describe('string/bool variable subset (P6-4)', () => {
  it('converts [eval] string assignment to a KS string VAR_SET', () => {
    const result = convertTyranoToKs('[eval exp="f.select_item=\'empty\'"]');

    expect(result.ks).toContain('select_item = "empty"');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('converts [eval] boolean assignment', () => {
    const result = convertTyranoToKs('[eval exp="f.cleared=true"]');

    expect(result.ks).toContain('cleared = true');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('converts [if] with a string comparison', () => {
    const result = convertTyranoToKs([
      "[if exp=\"tf.flag_back=='none'\"]",
      'なし[p]',
      '[endif]',
    ].join('\n'));

    expect(result.ks).toContain('if (flag_back == "none") {');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('keeps += with a string RHS outside the subset', () => {
    const result = convertTyranoToKs('[eval exp="f.name+=\'suffix\'"]');

    const issue = result.issues.find((i) => i.command === 'eval');
    expect(issue?.severity).toBe('unsupported');
  });

  it('keeps order comparison with a string literal outside the subset', () => {
    const result = convertTyranoToKs([
      '[if exp="f.route > \'aoi\'"]',
      'x[p]',
      '[endif]',
    ].join('\n'));

    const issue = result.issues.find((i) => i.command === 'if');
    expect(issue?.severity).toBe('unsupported');
  });

  it('compiles a converted string branch end-to-end', () => {
    const result = convertTyranoToScenario([
      '[eval exp="f.route=\'aoi\'"]',
      "[if exp=\"f.route=='aoi'\"]",
      'あおいルート[p]',
      '[endif]',
    ].join('\n'), { scenarioId: 'strvar-test', validate: false });

    const varSet = result.scenario.ops.find((o) => o.op === 'VAR_SET');
    expect(varSet).toMatchObject({ op: 'VAR_SET', name: 'route', value: 'aoi' });
    const jumpIf = result.scenario.ops.find((o) => o.op === 'JUMP_IF');
    expect(jumpIf).toMatchObject({ condition: 'route == "aoi"' });
  });
});

describe('[anim] → @sprite_move / @ch_move (P6-3)', () => {
  it('converts [anim] on a sprite to @sprite_move with normalized opacity', () => {
    const result = convertTyranoToKs([
      '[image name="photo" storage="photo.png" left="100" top="50"]',
      '[anim name="photo" left="400" top="200" opacity="128" time="600"]',
      '[wa]',
    ].join('\n'));

    expect(result.ks).toContain('@sprite_move photo x=400 y=200 opacity=0.5 time=600');
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('approximates [anim] on a character to a @ch_move slot with a warning', () => {
    const result = convertTyranoToKs([
      '[chara_new name="hero" storage="hero.png"]',
      '[chara_show name="hero"]',
      '[anim name="hero" left="1100" time="500"]',
    ].join('\n'));

    expect(result.ks).toContain('@ch_move hero right time=500');
    const warn = result.issues.find((i) => i.command === 'anim' && i.severity === 'warning');
    expect(warn?.message).toContain('approximated to @ch_move');
  });

  it('drops unsupported [anim] properties with a warning', () => {
    const result = convertTyranoToKs('[anim name="obj" left="10" rotate="45deg"]');

    const warn = result.issues.find((i) => i.command === 'anim' && i.message.includes('dropped'));
    expect(warn?.message).toContain('rotate');
    expect(result.ks).toContain('@sprite_move obj x=10');
  });

  it('warns once about serialized timing for consecutive [anim] tags', () => {
    const result = convertTyranoToKs([
      '[anim name="a" left="10"]',
      '[anim name="b" left="20"]',
      '[anim name="c" left="30"]',
    ].join('\n'));

    const warns = result.issues.filter((i) => i.message.includes('serialized'));
    expect(warns).toHaveLength(1);
  });

  it('compiles converted @sprite_move with opacity through the pipeline', () => {
    const result = convertTyranoToScenario([
      '[anim name="photo" left="400" opacity="255" time="300"]',
    ].join('\n'), { scenarioId: 'anim-test', validate: false });

    const op = result.scenario.ops.find((o) => o.op === 'SPRITE_MOVE');
    expect(op).toMatchObject({ op: 'SPRITE_MOVE', id: 'photo', x: 400, opacity: 1, durationMs: 300 });
  });
});

describe('[keyframe]/[kanim] → timeline (P6-5)', () => {
  const KEYFRAME_SRC = [
    '[keyframe name="slideInA"]',
    '[frame p="  0%" rotate="-40deg" x="-800"]',
    '[frame p=" 25%" rotate="-40deg" x="0"]',
    '[frame p="100%" rotate="-40deg" x="0"]',
    '[endkeyframe]',
  ].join('\n');

  it('parses [keyframe] as a block and converts [kanim] to @timeline_play + TimelineRoot', () => {
    const result = convertTyranoToKs([
      KEYFRAME_SRC,
      '[image name="a" storage="a.png" left="200" top="100"]',
      '[kanim keyframe="slideInA" name="a" time="1500"]',
      '[wa]',
    ].join('\n'));

    expect(result.ks).toContain('@timeline_play slideInA__a__1500');
    const tl = result.timelines['slideInA__a__1500'];
    expect(tl).toBeDefined();
    expect(tl.schemaVersion).toBe(1);
    expect(tl.durationMs).toBe(1500);
    expect(tl.tracks).toHaveLength(1);
    expect(tl.tracks[0]).toMatchObject({ kind: 'entity', targetId: 'spr_a' });

    const clip = tl.tracks[0].clips[0];
    expect(clip).toMatchObject({ startMs: 0, endMs: 1500 });
    const xChannel = clip.channels.find((c) => c.property === 'x');
    expect(xChannel).toBeDefined();
    // base(left=200) 相対へ差分化: -800 → -1000, 0 → -200
    expect(xChannel!.keyframes.map((k) => ({ t: k.clipOffsetMs, v: k.value }))).toEqual([
      { t: 0, v: -1000 },
      { t: 375, v: -200 },
      { t: 1500, v: -200 },
    ]);
    expect(result.summary.unsupportedCount).toBe(0);
  });

  it('drops rotate with a warning (TimelineDelegate does not apply rotation)', () => {
    const result = convertTyranoToKs([
      KEYFRAME_SRC,
      '[image name="a" storage="a.png" left="0"]',
      '[kanim keyframe="slideInA" name="a" time="1000"]',
    ].join('\n'));

    const warn = result.issues.find((i) => i.command === 'kanim' && i.message.includes('rotate'));
    expect(warn?.severity).toBe('warning');
    const clip = result.timelines['slideInA__a__1000'].tracks[0].clips[0];
    expect(clip.channels.find((c) => c.property === 'rotate')).toBeUndefined();
  });

  it('emits absolute values as relative with a warning when the target has no tracked placement', () => {
    const result = convertTyranoToKs([
      KEYFRAME_SRC,
      '[kanim keyframe="slideInA" name="unknown_layer" time="1000"]',
    ].join('\n'));

    const warn = result.issues.find((i) => i.command === 'kanim' && i.message.includes('no tracked placement'));
    expect(warn?.severity).toBe('warning');
    const x = result.timelines['slideInA__unknown_layer__1000'].tracks[0].clips[0].channels.find((c) => c.property === 'x');
    expect(x!.keyframes[0].value).toBe(-800); // 絶対値をそのまま相対値として出力
  });

  it('reports [kanim] referencing an undefined keyframe as unsupported', () => {
    const result = convertTyranoToKs('[kanim keyframe="nope" name="a" time="500"]');

    const issue = result.issues.find((i) => i.command === 'kanim');
    expect(issue?.severity).toBe('unsupported');
  });

  it('uses keyframes collected from another file via the keyframes option', () => {
    const keyframes = collectKeyframes([KEYFRAME_SRC]);
    const result = convertTyranoToKs('[kanim keyframe="slideInA" name="obj" time="800"]', { keyframes });

    expect(result.ks).toContain('@timeline_play slideInA__obj__800');
    expect(result.timelines['slideInA__obj__800']).toBeDefined();
  });

  it('compiles @timeline_play output through the pipeline', () => {
    const result = convertTyranoToScenario([
      KEYFRAME_SRC,
      '[kanim keyframe="slideInA" name="a" time="1500"]',
    ].join('\n'), { scenarioId: 'kanim-test', validate: false });

    const op = result.scenario.ops.find((o) => o.op === 'TIMELINE_PLAY');
    expect(op).toMatchObject({ op: 'TIMELINE_PLAY', timelineId: 'slideInA__a__1500' });
  });
});

describe('[mtext] → @text + timeline (P6-7)', () => {
  it('converts [mtext] without effects to a plain @text', () => {
    const result = convertTyranoToKs(
      '[mtext layer="1" x=" 20" y=" 30" size="36" text="演出文字オブジェクト～。" wait="false" bold="bold"]',
    );

    expect(result.ks).toContain('@text mtext_1 "演出文字オブジェクト～。" x=20 y=30 size=36 bold=true');
    expect(result.ks).not.toContain('@timeline_play');
    expect(result.summary.unsupportedCount).toBe(0);
    // 文字単位アニメの全体一括丸めは常に warning
    const warn = result.issues.find((i) => i.command === 'mtext');
    expect(warn?.message).toContain('per-letter');
  });

  it('converts in_effect="fadeInDown" to a generated timeline with opacity + y offset', () => {
    const result = convertTyranoToKs(
      '[mtext x="20" y="30" text="タイトル" in_effect="fadeInDown" in_time="800"]',
    );

    expect(result.ks).toContain('@timeline_play mtext_mtext_1__fadeInDown__800');
    const tl = result.timelines['mtext_mtext_1__fadeInDown__800'];
    expect(tl.durationMs).toBe(800);
    expect(tl.tracks[0]).toMatchObject({ targetId: 'spr_mtext_1' });
    const channels = tl.tracks[0].clips[0].channels;
    expect(channels.find((c) => c.property === 'opacity')).toBeDefined();
    const yCh = channels.find((c) => c.property === 'y');
    expect(yCh!.keyframes[0].value).toBe(-100); // 上から降りてくる
    expect(yCh!.keyframes[1].value).toBe(0);
  });

  it('approximates unknown effects to a fade-in with a warning and drops out_effect', () => {
    const result = convertTyranoToKs(
      '[mtext x="20" y="30" text="ボヨン" in_effect="bounce" out_effect="bounce"]',
    );

    expect(result.ks).toContain('@timeline_play');
    const warn = result.issues.find((i) => i.command === 'mtext');
    expect(warn?.message).toContain('approximated to a fade-in');
    expect(warn?.message).toContain('out_effect');
  });

  it('compiles [mtext] output end-to-end (TEXT_SPRITE_SET + TIMELINE_PLAY)', () => {
    const result = convertTyranoToScenario(
      '[mtext x="20" y="30" text="タイトル" in_effect="fadeIn"]',
      { scenarioId: 'mtext-test', validate: false },
    );

    const ops = result.scenario.ops.map((o) => o.op);
    expect(ops).toContain('TEXT_SPRITE_SET');
    expect(ops).toContain('TIMELINE_PLAY');
  });
});

describe('convertTyranoToScenario', () => {
  it('returns a compiled scenario that uses existing kaedevn ops', () => {
    const result = convertTyranoToScenario([
      '*start',
      '[bg storage="room.png"]',
      '#主人公',
      'こんにちは[l]',
      '[jump target="end"]',
      '*end',
      '終わり[p]',
    ].join('\n'), { scenarioId: 'tyrano-test', validate: false });

    expect(result.scenario.id).toBe('tyrano-test');
    expect(result.scenario.ops.map((op) => op.op)).toContain('BG_SET');
    expect(result.scenario.ops.map((op) => op.op)).toContain('TEXT_APPEND');
    expect(result.scenario.ops.map((op) => op.op)).toContain('WAIT_CLICK');
    expect(result.scenario.ops.map((op) => op.op)).toContain('JUMP');
  });
});

// ======================================================================
// 動的ジャンプの静的展開（設計 docs/09_reports/2026/07/10/05）
// ======================================================================

describe('dynamic jump static expansion (design 07/10/05)', () => {
  // Rule B: エンジン API 定数畳み込み
  it('Rule B: f.x = TYRANO.kag.stat.current_scenario はファイル名リテラルへ畳み込む', () => {
    const r = convertTyranoToKs('[eval exp="f.current_scenario = TYRANO.kag.stat.current_scenario"]', {
      fileName: 'escape/chest.ks',
    });
    expect(r.ks).toContain('current_scenario = "chest.ks"');
    expect(r.issues.filter((i) => i.severity === 'unsupported')).toHaveLength(0);
  });

  it('Rule B: fileName が無い場合は unsupported 診断（無言にしない）', () => {
    const r = convertTyranoToKs('[eval exp="f.current_scenario = TYRANO.kag.stat.current_scenario"]');
    expect(r.issues.some((i) => i.severity === 'unsupported' && /fileName/.test(i.message))).toBe(true);
  });

  // Rule A: 自己ファイル storage の畳み込み
  it('Rule A: storage=&f.x（x は TYRANO 代入済み）はファイル内ラベル呼び出しへ畳み込む', () => {
    const src = [
      '[eval exp="f.current_scenario = TYRANO.kag.stat.current_scenario"]',
      '[call storage=&f.current_scenario target=*Sub_Set_Variable]',
      '*Sub_Set_Variable',
      '[return]',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'escape/chest.ks' });
    expect(r.ks).toContain('@call Sub_Set_Variable');
    expect(r.ks).not.toContain('&f.');
    expect(r.issues.filter((i) => i.severity === 'unsupported')).toHaveLength(0);
  });

  it('Rule A: 代入より前の使用は畳み込まず unsupported 診断', () => {
    const src = [
      '[call storage=&f.current_scenario target=*Sub]',
      '[eval exp="f.current_scenario = TYRANO.kag.stat.current_scenario"]',
      '*Sub',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'a.ks' });
    expect(r.issues.some((i) => i.severity === 'unsupported' && /storage/.test(i.message))).toBe(true);
  });

  it('Rule A: TYRANO 形以外の代入が混ざる変数は畳み込まない（健全性）', () => {
    const src = [
      '[eval exp="f.x = TYRANO.kag.stat.current_scenario"]',
      '[eval exp="f.x = \'other.ks\'"]',
      '[call storage=&f.x target=*Sub]',
      '*Sub',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'a.ks' });
    expect(r.issues.some((i) => i.severity === 'unsupported' && /storage/.test(i.message))).toBe(true);
  });

  // Rule C: 有限ディスパッチ展開
  it('Rule C: 連結代入（lit + 数値変数）の target は if/else ディスパッチへ展開される', () => {
    const src = [
      '[eval exp="f.current_page_label = \'*Sub_Page\' + f.current_page_index"]',
      '[call target="&f.current_page_label"]',
      '*Sub_Page1',
      '[return]',
      '*Sub_Page2',
      '[return]',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'select.ks' });
    expect(r.ks).toContain('if (current_page_index == 1) {');
    expect(r.ks).toContain('@call Sub_Page1');
    expect(r.ks).toContain('if (current_page_index == 2) {');
    expect(r.ks).toContain('@call Sub_Page2');
    expect(r.ks).not.toContain('&f.');
    // 生成 KS がそのまま compile を通り、条件分岐 Op になる
    const compiled = compile(r.ks, { scenarioId: 't', validate: false });
    expect(compiled.ops.map((o) => o.op)).toContain('JUMP_IF');
    expect(compiled.ops.filter((o) => o.op === 'CALL')).toHaveLength(2);
  });

  it('Rule C: 文字列リテラル集合の target は文字列比較ディスパッチへ展開される', () => {
    const src = [
      '[eval exp="f.dest = \'*good_end\'"]',
      '[eval exp="f.dest = \'*bad_end\'"]',
      '[jump target="&f.dest"]',
      '*good_end',
      '*bad_end',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'a.ks' });
    expect(r.ks).toContain('if (dest == "*good_end") {');
    expect(r.ks).toContain('@jump good_end');
    expect(r.ks).toContain('@jump bad_end');
    expect(r.ks).not.toContain('&f.');
  });

  it('Rule C: 候補ラベルが存在しなければ unsupported 診断', () => {
    const src = [
      '[eval exp="f.p = \'*Sub_Page\' + f.i"]',
      '[call target="&f.p"]',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'a.ks' });
    expect(r.issues.some((i) => i.severity === 'unsupported' && /no matching labels/.test(i.message))).toBe(true);
  });

  it('解析不能な動的 target は unsupported 診断（無言にしない）', () => {
    const r = convertTyranoToKs('[jump target="&f.somewhere"]', { fileName: 'a.ks' });
    expect(r.issues.some((i) => i.severity === 'unsupported' && /resolved statically/.test(i.message))).toBe(true);
  });
});

// ======================================================================
// 2026-07-11 全体コードレビュー回帰（docs/09_reports/2026/07/11/01 #1〜#6）
// ======================================================================

describe('parseTyrano [if] ブロック収集（review 07/11 #1/#2）', () => {
  it('同一行 [if ...]text[endif] は 1 行で閉じ、後続行を飲み込まない', () => {
    const ast = parseTyrano([
      '[if exp="f.a==1"]表示テキスト[endif]',
      '次の行テキスト',
    ].join('\n'));

    expect(ast).toHaveLength(2);
    expect(ast[0]).toMatchObject({ type: 'block', name: 'if' });
    expect((ast[0] as { children: unknown[] }).children).toHaveLength(1);
    expect((ast[0] as { children: unknown[] }).children[0]).toMatchObject({ type: 'text', text: '表示テキスト' });
    expect(ast[1]).toMatchObject({ type: 'text', text: '次の行テキスト' });
  });

  it('inline [endif] より後の同一行ノードはブロックの外の兄弟になる', () => {
    const ast = parseTyrano('[if exp="f.a==1"]中身[endif]外側');

    expect(ast).toHaveLength(2);
    expect(ast[0]).toMatchObject({ type: 'block', name: 'if' });
    expect(ast[1]).toMatchObject({ type: 'text', text: '外側' });
  });

  it('ネストした [if] は最初の [endif] で外側を閉じない（深度カウント）', () => {
    const ast = parseTyrano([
      '[if exp="f.a==1"]',
      'A1',
      '[if exp="f.b==2"]',
      'B',
      '[endif]',
      'A2',
      '[endif]',
      '外側',
    ].join('\n'));

    expect(ast).toHaveLength(2);
    const outer = ast[0] as { type: string; name: string; children: Array<{ type: string; name?: string; text?: string; children?: Array<{ text?: string }> }> };
    expect(outer).toMatchObject({ type: 'block', name: 'if' });
    expect(outer.children.map((n) => n.type)).toEqual(['text', 'block', 'text']);
    expect(outer.children[1]).toMatchObject({ type: 'block', name: 'if' });
    expect(outer.children[1].children![0]).toMatchObject({ type: 'text', text: 'B' });
    expect(outer.children[2]).toMatchObject({ type: 'text', text: 'A2' });
    expect(ast[1]).toMatchObject({ type: 'text', text: '外側' });
  });

  it('ネストした [if] の変換で外側ガードが維持される（誤結合回帰）', () => {
    const r = convertTyranoToKs([
      '[if exp="f.a==1"]',
      'A1',
      '[if exp="f.b==2"]',
      'B',
      '[endif]',
      'A2',
      '[endif]',
      '外側',
    ].join('\n'));

    const lines = r.ks.split('\n').filter((l) => l.trim());
    expect(lines).toEqual([
      'if (a == 1) {',
      'A1',
      'if (b == 2) {',
      'B',
      '}',
      'A2',
      '}',
      '外側',
    ]);
  });
});

describe('parseTyrano 引用符内の ]（review 07/11 #3）', () => {
  it('属性値中の ] でタグを途切れさせない', () => {
    const ast = parseTyrano('[glink text="選択肢[A]" target=*next]');

    expect(ast).toHaveLength(1);
    expect(ast[0]).toMatchObject({
      type: 'tag',
      name: 'glink',
      args: { text: '選択肢[A]', target: '*next' },
    });
  });

  it('閉じ引用符が欠けた壊れたタグは従来どおり最初の ] で閉じる（タグ丸ごとテキスト化しない）', () => {
    // tech-sample1 実データにある原文タイプミス（y="440] ← 閉じ引用符欠落）の互換
    const ast = parseTyrano('[ptext name="p1" y="440]');

    expect(ast).toHaveLength(1);
    expect(ast[0]).toMatchObject({ type: 'tag', name: 'ptext' });
  });

  it('] 入りラベルの [glink] が選択肢として変換され、残骸がテキストへ漏れない', () => {
    const r = convertTyranoToKs([
      '[glink text="選択肢[A]" target=*next]',
      '[s]',
      '*next',
    ].join('\n'));

    expect(r.ks).toContain('"選択肢[A]" {');
    expect(r.ks).toContain('@jump next');
    expect(r.ks).not.toContain('target=*next]');
  });
});

describe('*label|見出し の正規化（review 07/11 #4）', () => {
  it('ラベル定義の | 以降（save-title 見出し）はラベル名に含めない', () => {
    const ast = parseTyrano('*scene1|セーブ見出し');

    expect(ast[0]).toMatchObject({ type: 'label', name: 'scene1' });
  });

  it('定義側と target 側が対称に正規化され jump が解決する', () => {
    const r = convertTyranoToKs([
      '*scene1|セーブ見出し',
      '[jump target="*scene1|セーブ見出し"]',
    ].join('\n'));

    expect(r.ks).toContain('*scene1');
    expect(r.ks).toContain('@jump scene1');
    expect(r.ks).not.toContain('セーブ見出し');
  });
});

describe('exp 無し [if]（review 07/11 #5）', () => {
  it('exp の無い [if] は TypeError にせず unsupported 診断で変換を続行する', () => {
    const r = convertTyranoToKs([
      '[if]',
      '本文',
      '[endif]',
      '[bg storage="room.png"]',
    ].join('\n'));

    expect(r.issues.some((i) => i.severity === 'unsupported' && i.command === 'if' && /missing exp/.test(i.message))).toBe(true);
    expect(r.ks).toContain('@bg room');
  });

  it('exp の無い [elsif] も else 扱いにせず unsupported 診断へ落とす', () => {
    const r = convertTyranoToKs([
      '[if exp="f.a==1"]',
      'A',
      '[elsif]',
      'B',
      '[endif]',
    ].join('\n'));

    expect(r.issues.some((i) => i.severity === 'unsupported' && i.command === 'if' && /missing exp/.test(i.message))).toBe(true);
    expect(r.ks).not.toContain('if (a == 1) {');
  });
});

describe('concat 代入と reads スキャン（review 07/11 #6）', () => {
  it('[if] で読まれる concat 変数の代入はコメント化しない（unsupported 診断へ落とす）', () => {
    const src = [
      '[eval exp="f.route = \'label_\' + f.num"]',
      '[if exp="f.route == \'label_1\'"]',
      'A',
      '[endif]',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'a.ks' });

    expect(r.ks).not.toContain('dispatch-expanded');
    expect(r.issues.some((i) => i.severity === 'unsupported' && i.command === 'eval')).toBe(true);
  });

  it('動的 jump/call でのみ消費される concat 代入は従来どおりコメント化される', () => {
    const src = [
      '[eval exp="f.p = \'*Sub_Page\' + f.i"]',
      '[call target="&f.p"]',
      '*Sub_Page1',
      '[return]',
    ].join('\n');
    const r = convertTyranoToKs(src, { fileName: 'a.ks' });

    expect(r.ks).toContain("; dispatch-expanded (design 05): f.p = '*Sub_Page' + f.i");
  });
});
