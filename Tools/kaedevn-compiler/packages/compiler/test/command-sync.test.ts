import { describe, it, expect } from 'vitest';
import { compile, CompilationException } from '../src/index.js';
import { parseCommand } from '../src/parser/parseCommand.js';
import { COMMAND_PARSERS, STANDALONE_PARSERS, KNOWN_COMMAND_NAMES, STANDALONE_COMMAND_NAMES } from '../src/registry/commandRegistry.js';
import type { CommandToken } from '../src/types/Token.js';

/**
 * コマンド同期テスト
 *
 * KNOWN_COMMANDS に未登録のコマンドは TEXT_APPEND になるため、
 * このテストが即座に失敗する。
 * レジストリ導入により lineClassifier と parseCommand は
 * 同一の COMMAND_PARSERS から導出されるが、このテストは
 * compile() の E2E として、コマンドが正しく Op に変換されることを検証する。
 */
describe('Command Sync: compile() produces expected Ops for all registered commands', () => {
  // コマンド名 → { input: コンパイル用の行, expectedOp: 期待する Op.op }
  const commandTestCases: Array<{ command: string; input: string; expectedOp: string }> = [
    // Background
    { command: 'bg', input: '@bg room_day', expectedOp: 'BG_SET' },
    { command: 'bg (no args)', input: '@bg', expectedOp: 'BG_CLEAR' },
    // Character
    { command: 'ch', input: '@ch hero smile center', expectedOp: 'CH_SET' },
    { command: 'ch_anim', input: '@ch_anim hero smile center', expectedOp: 'CH_ANIM' },
    { command: 'ch_hide', input: '@ch_hide hero', expectedOp: 'CH_HIDE' },
    { command: 'ch_clear', input: '@ch_clear', expectedOp: 'CH_CLEAR' },
    // Audio
    { command: 'bgm', input: '@bgm main_theme', expectedOp: 'BGM_PLAY' },
    { command: 'bgm_stop', input: '@bgm_stop', expectedOp: 'BGM_STOP' },
    { command: 'se', input: '@se click', expectedOp: 'SE_PLAY' },
    { command: 'se_stop', input: '@se_stop', expectedOp: 'SE_STOP' },
    { command: 'voice', input: '@voice v001', expectedOp: 'VOICE_PLAY' },
    // Wait
    { command: 'wait', input: '@wait 1.5', expectedOp: 'WAIT_MS' },
    // Battle / Timeline
    { command: 'battle', input: '@battle troop1', expectedOp: 'BATTLE_START' },
    { command: 'timeline_play', input: '@timeline_play tl1', expectedOp: 'TIMELINE_PLAY' },
    // Filter
    { command: 'filter', input: '@filter sepia', expectedOp: 'SCREEN_FILTER' },
    { command: 'screenFilter', input: '@screenFilter sepia', expectedOp: 'SCREEN_FILTER' },
    { command: 'filter_clear', input: '@filter_clear', expectedOp: 'SCREEN_FILTER_CLEAR' },
    { command: 'screenFilterClear', input: '@screenFilterClear', expectedOp: 'SCREEN_FILTER_CLEAR' },
    { command: 'filter_mix', input: '@filter_mix night 0.5 rain 0.4', expectedOp: 'FILTER_MIX' },
    // Visual effects
    { command: 'shake', input: '@shake', expectedOp: 'SHAKE' },
    { command: 'flash', input: '@flash', expectedOp: 'FLASH' },
    { command: 'fade_black', input: '@fade_black', expectedOp: 'FADE_BLACK' },
    { command: 'fade_white', input: '@fade_white', expectedOp: 'FADE_WHITE' },
    { command: 'black_in', input: '@black_in', expectedOp: 'BLACK_IN' },
    { command: 'white_in', input: '@white_in', expectedOp: 'WHITE_IN' },
    // Character (move)
    { command: 'ch_move', input: '@ch_move hero center 500', expectedOp: 'CH_MOVE' },
    // Audio (wait)
    { command: 'wait_voice_end', input: '@wait_voice_end', expectedOp: 'WAIT_VOICE_END' },
    // Overlay
    { command: 'overlay', input: '@overlay rain', expectedOp: 'OVERLAY_SET' },
    { command: 'overlay_hide', input: '@overlay_hide', expectedOp: 'OVERLAY_HIDE' },
    // Sprite (Tyrano [image] 相当)
    { command: 'sprite', input: '@sprite photo photo.png layer=front x=100 y=200', expectedOp: 'SPRITE_SET' },
    { command: 'sprite_move', input: '@sprite_move photo x=300 time=500', expectedOp: 'SPRITE_MOVE' },
    { command: 'sprite_hide', input: '@sprite_hide photo', expectedOp: 'SPRITE_HIDE' },
    { command: 'sprite_clear', input: '@sprite_clear', expectedOp: 'SPRITE_CLEAR' },
    // Text sprite (Tyrano [ptext] 相当)
    { command: 'text', input: '@text title "こんにちは" x=100 y=200 size=32 color=#ffcc00 bold=true', expectedOp: 'TEXT_SPRITE_SET' },
    // MomijiUI 宣言的 UI 画面
    { command: 'ui_show', input: '@ui_show item_select wait=true', expectedOp: 'UI_SHOW' },
    { command: 'ui_hide', input: '@ui_hide', expectedOp: 'UI_HIDE' },
    // Layer / Transition (Tyrano [layopt]/[trans]/[wt] 相当)
    { command: 'layer', input: '@layer name=overlay visible=false', expectedOp: 'LAYER_SET' },
    { command: 'transition', input: '@transition target=overlay type=fade time=500', expectedOp: 'TRANSITION' },
    { command: 'wait_transition', input: '@wait_transition', expectedOp: 'WAIT_TRANSITION' },
    // Mask / Camera wait (Tyrano [mask]/[mask_off]/[wait_camera] 相当)
    { command: 'mask', input: '@mask color=#000000 opacity=1 time=300', expectedOp: 'MASK_SET' },
    { command: 'mask_clear', input: '@mask_clear time=300', expectedOp: 'MASK_CLEAR' },
    { command: 'wait_camera', input: '@wait_camera', expectedOp: 'WAIT_CAMERA' },
    // Text style (ティラノ風 名前枠 / メッセージ枠の色指定)
    { command: 'text_style', input: '@text_style bgColor #112233', expectedOp: 'TEXT_STYLE' },
    // Text clear (ティラノ [cm]/[er] 相当)
    { command: 'text_clear', input: '@text_clear', expectedOp: 'TEXT_CLEAR' },
    // Slash trail (三日月スプライト + 残像)
    { command: 'slash', input: '@slash x=640 y=360 angle=-30 length=400', expectedOp: 'SLASH_EMIT' },
    { command: 'slash (no args)', input: '@slash', expectedOp: 'SLASH_EMIT' },
    // JSON宣言型エフェクト
    { command: 'effect (positional)', input: '@effect fire_full_01', expectedOp: 'EFFECT_PLAY' },
    { command: 'effect (id=)', input: '@effect id=fire_full_01 wait=true', expectedOp: 'EFFECT_PLAY' },
    { command: 'effect (overrides)', input: '@effect fire_full_01 scale=1.5 intensity=2 x=100 y=-50', expectedOp: 'EFFECT_PLAY' },
    // Standalone
    { command: 'l', input: '@l', expectedOp: 'WAIT_CLICK' },
    { command: 'p', input: '@p', expectedOp: 'PAGE' },
    { command: 'r', input: '@r', expectedOp: 'TEXT_NL' },
  ];

  for (const { command, input, expectedOp } of commandTestCases) {
    it(`@${command} → ${expectedOp}`, () => {
      const result = compile(input, { validate: false });
      const firstOp = result.ops[0];
      expect(firstOp.op).toBe(expectedOp);
    });
  }

  it('unknown command → CompilationException (UNKNOWN_COMMAND)', () => {
    expect(() => compile('@unknown_cmd zoom')).toThrow(CompilationException);
  });
});

describe('Command Registry consistency', () => {
  it('KNOWN_COMMAND_NAMES matches COMMAND_PARSERS keys', () => {
    expect(new Set(KNOWN_COMMAND_NAMES)).toEqual(new Set(Object.keys(COMMAND_PARSERS)));
  });

  it('STANDALONE_COMMAND_NAMES matches STANDALONE_PARSERS keys', () => {
    expect(new Set(STANDALONE_COMMAND_NAMES)).toEqual(new Set(Object.keys(STANDALONE_PARSERS)));
  });

  it('no overlap between COMMAND_PARSERS and STANDALONE_PARSERS', () => {
    const overlap = KNOWN_COMMAND_NAMES.filter(name => name in STANDALONE_PARSERS);
    expect(overlap).toEqual([]);
  });

  it('every COMMAND_PARSERS entry is a function', () => {
    for (const [name, parser] of Object.entries(COMMAND_PARSERS)) {
      expect(typeof parser).toBe('function');
    }
  });

  it('every STANDALONE_PARSERS entry is a function', () => {
    for (const [name, parser] of Object.entries(STANDALONE_PARSERS)) {
      expect(typeof parser).toBe('function');
    }
  });
});

/**
 * parseCommand 直接テスト
 */
describe('parseCommand direct', () => {
  function makeToken(command: string, args: string[] = []): CommandToken {
    return { type: 'COMMAND', command, args, line: 1, raw: `@${command} ${args.join(' ')}`.trim() };
  }

  it('unknown command throws CompilationException with UNKNOWN_COMMAND code', () => {
    const token = makeToken('nonexistent', ['arg']);
    try {
      parseCommand(token);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CompilationException);
      expect((e as CompilationException).errors[0].code).toBe('UNKNOWN_COMMAND');
      expect((e as CompilationException).errors[0].message).toContain('@nonexistent');
    }
  });

  it('known command returns Op (not throws)', () => {
    const token = makeToken('bg', ['room']);
    const op = parseCommand(token);
    expect(op.op).toBe('BG_SET');
  });

  it('standalone command returns Op', () => {
    const token = makeToken('l');
    const op = parseCommand(token);
    expect(op.op).toBe('WAIT_CLICK');
  });
});

/**
 * パーサー出力値の詳細検証
 */
describe('Parser output values', () => {
  // helper: compile single line and return first Op
  function firstOp(input: string) {
    return compile(input, { validate: false }).ops[0];
  }

  describe('@bg', () => {
    it('with id → BG_SET with id', () => {
      const op = firstOp('@bg room_day');
      expect(op).toEqual({ op: 'BG_SET', id: 'room_day' });
    });

    it('with fade → BG_SET with fadeMs and effect', () => {
      const op = firstOp('@bg room_night fade 500');
      expect(op).toEqual({ op: 'BG_SET', id: 'room_night', fadeMs: 500, effect: 'fade' });
    });

    it('with slide_left → BG_SET with slide effect', () => {
      const op = firstOp('@bg scene2 slide_left 300');
      expect(op).toEqual({ op: 'BG_SET', id: 'scene2', fadeMs: 300, effect: 'slide_left' });
    });

    it('no args → BG_CLEAR', () => {
      const op = firstOp('@bg');
      expect(op).toEqual({ op: 'BG_CLEAR' });
    });

    // Regression: pagesToKs → KsPrinter は x/y/s を key=value 形式 (`x=80 y=-40 s=1.3`)
    // で emit する。parser が positional しか受けないと Play 画面で位置が無視される。
    it('positional x/y/s → BG_SET with transform', () => {
      const op = firstOp('@bg room_day x 80 y -40 s 1.3');
      expect(op).toEqual({ op: 'BG_SET', id: 'room_day', x: 80, y: -40, s: 1.3 });
    });

    it('key=value x/y/s → BG_SET with transform', () => {
      const op = firstOp('@bg room_day x=80 y=-40 s=1.3');
      expect(op).toEqual({ op: 'BG_SET', id: 'room_day', x: 80, y: -40, s: 1.3 });
    });
  });

  describe('@ch', () => {
    it('basic → CH_SET with name/pose/pos', () => {
      const op = firstOp('@ch hero smile center');
      expect(op).toEqual({ op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center' });
    });

    it('short position L/C/R', () => {
      expect(firstOp('@ch hero smile L')).toMatchObject({ pos: 'left' });
      expect(firstOp('@ch hero smile C')).toMatchObject({ pos: 'center' });
      expect(firstOp('@ch hero smile R')).toMatchObject({ pos: 'right' });
    });

    it('with fade → CH_SET with fadeMs', () => {
      const op = firstOp('@ch heroine sad left fade 300');
      expect(op).toEqual({ op: 'CH_SET', name: 'heroine', pose: 'sad', pos: 'left', fadeMs: 300 });
    });

    // Regression: KsPrinter 経由は `s=1.4 x=40 y=-20` の key=value 形式で emit される。
    it('key=value x/y/s → CH_SET with transform', () => {
      const op = firstOp('@ch hero smile center s=1.4 x=40 y=-20');
      expect(op).toMatchObject({ op: 'CH_SET', name: 'hero', pose: 'smile', pos: 'center', s: 1.4, x: 40, y: -20 });
    });
  });

  describe('@ch_anim', () => {
    it('produces CH_ANIM with animation defaults', () => {
      const op = firstOp('@ch_anim hero run center');
      expect(op).toEqual({
        op: 'CH_ANIM', name: 'hero', src: 'run',
        frames: 0, fps: 0, pos: 'center', loop: true,
      });
    });
  });

  describe('@ch_hide', () => {
    it('basic → CH_HIDE with name', () => {
      const op = firstOp('@ch_hide hero');
      expect(op).toMatchObject({ op: 'CH_HIDE', name: 'hero' });
    });

    it('with fade → CH_HIDE with fadeMs', () => {
      const op = firstOp('@ch_hide hero fade 200');
      expect(op).toEqual({ op: 'CH_HIDE', name: 'hero', fadeMs: 200 });
    });
  });

  describe('@ch_clear', () => {
    it('basic → CH_CLEAR', () => {
      const op = firstOp('@ch_clear');
      expect(op).toEqual({ op: 'CH_CLEAR' });
    });
  });

  describe('@bgm', () => {
    it('basic → BGM_PLAY with id', () => {
      const op = firstOp('@bgm main_theme');
      expect(op).toMatchObject({ op: 'BGM_PLAY', id: 'main_theme' });
    });

    it('with vol → BGM_PLAY with vol', () => {
      const op = firstOp('@bgm main_theme vol 80');
      expect(op).toEqual({ op: 'BGM_PLAY', id: 'main_theme', vol: 80 });
    });
  });

  describe('@bgm_stop', () => {
    it('basic → BGM_STOP', () => {
      const op = firstOp('@bgm_stop');
      expect(op).toEqual({ op: 'BGM_STOP' });
    });

    it('with fade → BGM_STOP with fadeMs', () => {
      const op = firstOp('@bgm_stop fade 1000');
      expect(op).toEqual({ op: 'BGM_STOP', fadeMs: 1000 });
    });
  });

  describe('@se', () => {
    it('basic → SE_PLAY with id', () => {
      const op = firstOp('@se click');
      expect(op).toMatchObject({ op: 'SE_PLAY', id: 'click' });
    });
  });

  describe('@voice', () => {
    it('basic → VOICE_PLAY with id', () => {
      const op = firstOp('@voice v001');
      expect(op).toEqual({ op: 'VOICE_PLAY', id: 'v001' });
    });
  });

  describe('@wait', () => {
    it('converts seconds to ms', () => {
      const op = firstOp('@wait 1.5');
      expect(op).toEqual({ op: 'WAIT_MS', ms: 1500 });
    });

    it('integer seconds', () => {
      const op = firstOp('@wait 2');
      expect(op).toEqual({ op: 'WAIT_MS', ms: 2000 });
    });
  });

  describe('@battle', () => {
    it('basic → BATTLE_START with troopId', () => {
      const op = firstOp('@battle troop1');
      expect(op).toEqual({ op: 'BATTLE_START', troopId: 'troop1', onWin: '', onLose: '' });
    });

    it('with onWin/onLose', () => {
      const op = firstOp('@battle boss1 onWin=victory onLose=defeat');
      expect(op).toEqual({ op: 'BATTLE_START', troopId: 'boss1', onWin: 'victory', onLose: 'defeat' });
    });
  });

  describe('@timeline_play', () => {
    it('basic → TIMELINE_PLAY with timelineId', () => {
      const op = firstOp('@timeline_play intro_tl');
      expect(op).toEqual({ op: 'TIMELINE_PLAY', timelineId: 'intro_tl' });
    });
  });

  describe('@filter / @screenFilter', () => {
    it('@filter with type → SCREEN_FILTER', () => {
      const op = firstOp('@filter sepia');
      expect(op).toEqual({ op: 'SCREEN_FILTER', filter: 'sepia' });
    });

    it('@filter with intensity → SCREEN_FILTER with intensity', () => {
      const op = firstOp('@filter blur 0.5');
      expect(op).toEqual({ op: 'SCREEN_FILTER', filter: 'blur', intensity: 0.5 });
    });

    it('@screenFilter → same as @filter', () => {
      const op = firstOp('@screenFilter sepia');
      expect(op).toEqual({ op: 'SCREEN_FILTER', filter: 'sepia' });
    });
  });

  describe('@filter_mix', () => {
    it('2 layers → FILTER_MIX', () => {
      const op = firstOp('@filter_mix night 0.5 rain 0.4');
      expect(op).toEqual({
        op: 'FILTER_MIX',
        layers: [
          { filter: 'night', intensity: 0.5 },
          { filter: 'rain', intensity: 0.4 },
        ],
      });
    });

    it('3 layers', () => {
      const op = firstOp('@filter_mix night 0.7 cool 0.5 dark 0.3');
      expect(op).toEqual({
        op: 'FILTER_MIX',
        layers: [
          { filter: 'night', intensity: 0.7 },
          { filter: 'cool', intensity: 0.5 },
          { filter: 'dark', intensity: 0.3 },
        ],
      });
    });

    it('4 layers (max)', () => {
      const op = firstOp('@filter_mix morning 0.5 warm 0.3 vivid 0.8 vignette 0.4');
      expect((op as any).layers).toHaveLength(4);
    });

    it('odd args → last layer has no intensity', () => {
      const op = firstOp('@filter_mix sepia 0.5 warm');
      expect((op as any).layers).toEqual([
        { filter: 'sepia', intensity: 0.5 },
        { filter: 'warm' },
      ]);
    });

    it('target=bg を kv として拾い、layer 解釈に影響しない', () => {
      const op = firstOp('@filter_mix night 0.5 rain 0.4 target=bg');
      expect(op).toEqual({
        op: 'FILTER_MIX',
        layers: [
          { filter: 'night', intensity: 0.5 },
          { filter: 'rain', intensity: 0.4 },
        ],
        target: 'bg',
      });
    });

    it('target=ch も受け付ける', () => {
      const op = firstOp('@filter_mix sepia 0.5 sakura 0.3 target=ch');
      expect((op as any).target).toBe('ch');
    });

    // pagesToKs → KsPrinter 経由は `@filter_mix sepia=0.5 rain=0.5` の key=value 形式で
    // emit される（Play モード）。Play 画面で重ねがけが効かないバグの再現防止。
    it('key=value 形式 (pagesToKs 経由) → FILTER_MIX', () => {
      const op = firstOp('@filter_mix sepia=0.5 rain=0.5');
      expect(op).toEqual({
        op: 'FILTER_MIX',
        layers: [
          { filter: 'sepia', intensity: 0.5 },
          { filter: 'rain', intensity: 0.5 },
        ],
      });
    });

    it('key=value 形式 + target=bg', () => {
      const op = firstOp('@filter_mix warm=0.4 sakura=0.6 target=bg');
      expect(op).toEqual({
        op: 'FILTER_MIX',
        layers: [
          { filter: 'warm', intensity: 0.4 },
          { filter: 'sakura', intensity: 0.6 },
        ],
        target: 'bg',
      });
    });
  });

  describe('@particle', () => {
    it('preset のみ → PARTICLE_EMIT', () => {
      const op = firstOp('@particle fire_sparks');
      expect(op).toEqual({ op: 'PARTICLE_EMIT', preset: 'fire_sparks' });
    });

    // editor の getBlockScript と pagesToKs → KsPrinter は両方とも key=value 形式で emit する。
    // 旧 parseOptionalArgs は positional 前提で duration / intensity / blend を取りこぼし、
    // Play モードでパーティクルが見えなくなるバグになっていた。再発防止。
    it('key=value 形式で x/y/s/duration/intensity/blend を抽出', () => {
      const op = firstOp('@particle fire_sparks x=640 y=360 duration=2500 intensity=1 blend=add');
      expect(op).toEqual({
        op: 'PARTICLE_EMIT',
        preset: 'fire_sparks',
        x: 640,
        y: 360,
        duration: 2500,
        intensity: 1,
        blendMode: 'add',
      });
    });

    it('s=スケール も抽出する', () => {
      const op = firstOp('@particle gacha_burst s=1.5 intensity=0.8');
      expect(op).toEqual({
        op: 'PARTICLE_EMIT',
        preset: 'gacha_burst',
        s: 1.5,
        intensity: 0.8,
      });
    });

    it('range も抽出する（出る範囲倍率）', () => {
      const op = firstOp('@particle gacha_burst range=2.5 s=1.2');
      expect(op).toEqual({
        op: 'PARTICLE_EMIT',
        preset: 'gacha_burst',
        range: 2.5,
        s: 1.2,
      });
    });

    it('preset 未指定はエラー', () => {
      expect(() => compile('@particle', { validate: false })).toThrow(CompilationException);
    });
  });

  describe('@effect', () => {
    it('位置引数の id のみ → EFFECT_PLAY', () => {
      const op = firstOp('@effect fire_full_01');
      expect(op).toEqual({ op: 'EFFECT_PLAY', id: 'fire_full_01' });
    });

    it('id= とクオート、wait=true を抽出', () => {
      const op = firstOp('@effect id="fire_full_01" wait=true');
      expect(op).toEqual({ op: 'EFFECT_PLAY', id: 'fire_full_01', wait: true });
    });

    it('override スライダー scale/intensity/x/y を抽出', () => {
      const op = firstOp('@effect fire_full_01 scale=1.5 intensity=2 x=100 y=-50');
      expect(op).toEqual({
        op: 'EFFECT_PLAY',
        id: 'fire_full_01',
        scale: 1.5,
        intensity: 2,
        x: 100,
        y: -50,
      });
    });

    it('id 未指定はエラー', () => {
      expect(() => compile('@effect', { validate: false })).toThrow(CompilationException);
    });
  });

  describe('@slash', () => {
    it('引数なし → SLASH_EMIT (デフォルト)', () => {
      const op = firstOp('@slash');
      expect(op).toEqual({ op: 'SLASH_EMIT' });
    });

    it('全パラメータ kv 形式', () => {
      const op = firstOp('@slash x=640 y=360 angle=-30 length=400 duration=250 color=0xFFFFFF blend=add width=1.2');
      expect(op).toEqual({
        op: 'SLASH_EMIT',
        x: 640,
        y: 360,
        angle: -30,
        length: 400,
        duration: 250,
        color: 0xFFFFFF,
        blendMode: 'add',
        width: 1.2,
      });
    });

    it('color は #RRGGBB でも 0xRRGGBB でも受ける', () => {
      const opHex = firstOp('@slash color=#ff8800');
      expect((opHex as any).color).toBe(0xff8800);
      const opOx = firstOp('@slash color=0xff8800');
      expect((opOx as any).color).toBe(0xff8800);
    });
  });

  describe('@filter_clear / @screenFilterClear', () => {
    it('@filter_clear → SCREEN_FILTER_CLEAR', () => {
      expect(firstOp('@filter_clear')).toEqual({ op: 'SCREEN_FILTER_CLEAR' });
    });

    it('@screenFilterClear → SCREEN_FILTER_CLEAR', () => {
      expect(firstOp('@screenFilterClear')).toEqual({ op: 'SCREEN_FILTER_CLEAR' });
    });
  });

  describe('@shake', () => {
    it('no args → SHAKE (defaults)', () => {
      expect(firstOp('@shake')).toEqual({ op: 'SHAKE' });
    });

    it('with intensity → SHAKE with intensity', () => {
      expect(firstOp('@shake 5')).toEqual({ op: 'SHAKE', intensity: 5 });
    });

    it('with intensity and durationMs', () => {
      expect(firstOp('@shake 5 300')).toEqual({ op: 'SHAKE', intensity: 5, durationMs: 300 });
    });
  });

  describe('@flash', () => {
    it('no args → FLASH', () => {
      expect(firstOp('@flash')).toEqual({ op: 'FLASH' });
    });

    it('with durationMs', () => {
      expect(firstOp('@flash 200')).toEqual({ op: 'FLASH', durationMs: 200 });
    });
  });

  describe('@fade_black / @fade_white', () => {
    it('@fade_black → FADE_BLACK', () => {
      expect(firstOp('@fade_black')).toEqual({ op: 'FADE_BLACK' });
    });

    it('@fade_black with duration', () => {
      expect(firstOp('@fade_black 500')).toEqual({ op: 'FADE_BLACK', durationMs: 500 });
    });

    it('@fade_white → FADE_WHITE', () => {
      expect(firstOp('@fade_white')).toEqual({ op: 'FADE_WHITE' });
    });
  });

  describe('@black_in / @white_in', () => {
    it('@black_in → BLACK_IN', () => {
      expect(firstOp('@black_in')).toEqual({ op: 'BLACK_IN' });
    });

    it('@white_in with duration', () => {
      expect(firstOp('@white_in 400')).toEqual({ op: 'WHITE_IN', durationMs: 400 });
    });
  });

  describe('@ch_move', () => {
    it('basic → CH_MOVE with name/pos/durationMs', () => {
      const op = firstOp('@ch_move hero center 500');
      expect(op).toEqual({ op: 'CH_MOVE', name: 'hero', pos: 'center', durationMs: 500 });
    });

    it('short position L/C/R', () => {
      expect(firstOp('@ch_move hero L 300')).toMatchObject({ pos: 'left' });
      expect(firstOp('@ch_move hero C 300')).toMatchObject({ pos: 'center' });
      expect(firstOp('@ch_move hero R 300')).toMatchObject({ pos: 'right' });
    });

    it('default durationMs → 500', () => {
      const op = firstOp('@ch_move hero right');
      expect(op).toEqual({ op: 'CH_MOVE', name: 'hero', pos: 'right', durationMs: 500 });
    });
  });

  describe('@wait_voice_end', () => {
    it('→ WAIT_VOICE_END', () => {
      const op = firstOp('@wait_voice_end');
      expect(op).toEqual({ op: 'WAIT_VOICE_END' });
    });
  });

  describe('@overlay', () => {
    it('basic → OVERLAY_SET with id', () => {
      expect(firstOp('@overlay rain')).toMatchObject({ op: 'OVERLAY_SET', id: 'rain' });
    });

    it('with fade → OVERLAY_SET with fadeMs', () => {
      expect(firstOp('@overlay rain fade 500')).toEqual({ op: 'OVERLAY_SET', id: 'rain', fadeMs: 500 });
    });
  });

  describe('@overlay_hide', () => {
    it('no args → OVERLAY_HIDE (all)', () => {
      expect(firstOp('@overlay_hide')).toEqual({ op: 'OVERLAY_HIDE' });
    });

    it('with id → OVERLAY_HIDE specific', () => {
      expect(firstOp('@overlay_hide rain')).toMatchObject({ op: 'OVERLAY_HIDE', id: 'rain' });
    });
  });
});

/**
 * エラーケース: 必須引数不足
 */
describe('Parser error cases (missing required args)', () => {
  const errorCases: Array<{ input: string; expectedMessage: RegExp }> = [
    { input: '@ch hero smile', expectedMessage: /@ch requires/ },
    { input: '@ch hero smile top', expectedMessage: /Invalid position/ },
    { input: '@ch_anim hero smile', expectedMessage: /@ch_anim requires/ },
    { input: '@ch_anim hero smile top', expectedMessage: /Invalid position/ },
    { input: '@ch_hide', expectedMessage: /@ch_hide requires/ },
    { input: '@ch_move hero', expectedMessage: /@ch_move requires/ },
    { input: '@ch_move hero top', expectedMessage: /Invalid position/ },
    { input: '@bgm', expectedMessage: /@bgm requires/ },
    { input: '@se', expectedMessage: /@se requires/ },
    { input: '@voice', expectedMessage: /@voice requires/ },
    { input: '@wait', expectedMessage: /@wait requires/ },
    { input: '@battle', expectedMessage: /@battle requires/ },
    { input: '@timeline_play', expectedMessage: /@timeline_play requires/ },
    { input: '@filter', expectedMessage: /@filter requires/ },
    { input: '@filter_mix', expectedMessage: /@filter_mix requires/ },
    { input: '@filter_mix sepia', expectedMessage: /@filter_mix requires/ },
    { input: '@overlay', expectedMessage: /@overlay requires/ },
  ];

  for (const { input, expectedMessage } of errorCases) {
    it(`${input} throws CompilationException`, () => {
      expect(() => compile(input, { validate: false })).toThrow(CompilationException);
      expect(() => compile(input, { validate: false })).toThrow(expectedMessage);
    });
  }
});
