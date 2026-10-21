import type { Op } from '@kaedevn/core';
import type { CommandToken } from '../types/Token.js';
import { CompilationException } from '../types/CompilerError.js';
import { parseOptionalArgs, parseBgOptionalArgs, normalizePairs } from '../parser/parseOptionalArgs.js';
import { normalizePosition, type StagePosition } from '../parser/position.js';

/**
 * コマンドパーサー関数の型
 * args, line, raw を受け取り Op を返す
 */
export type CommandParser = (args: string[], line: number, raw: string) => Op;

// --- 引数の誤りの補助 ---
// INVALID_ARGS はここでだけ組み立てる。数の引数は intArg / toInt / toFloat で読み、NaN を Op へ入れない。

function argsError(message: string, line: number, raw: string): never {
  throw new CompilationException([{ code: 'INVALID_ARGS', message, line, source: raw }]);
}

function requireArgs(args: string[], count: number, usage: string, line: number, raw: string): void {
  if (args.length < count) argsError(usage, line, raw);
}

function checkedNumber(value: number, text: string, name: string, line: number, raw: string): number {
  if (!Number.isFinite(value)) argsError(`Invalid number for ${name}: ${text}`, line, raw);
  return value;
}

/** 文字列を整数で読む。数でなければ INVALID_ARGS。 */
function toInt(text: string, name: string, line: number, raw: string): number {
  return checkedNumber(parseInt(text, 10), text, name, line, raw);
}

/** 文字列を実数で読む。数でなければ INVALID_ARGS。 */
function toFloat(text: string, name: string, line: number, raw: string): number {
  return checkedNumber(parseFloat(text), text, name, line, raw);
}

/** args[i] を整数で読む。数でなければ INVALID_ARGS。 */
function intArg(args: string[], i: number, name: string, line: number, raw: string): number {
  return toInt(args[i], name, line, raw);
}

// --- 個別パーサー関数 ---

function parseBgCommand(args: string[], line: number, raw: string): Op {
  if (args.length < 1) {
    return { op: 'BG_CLEAR' };
  }
  const id = args[0];
  const opts = parseBgOptionalArgs(args, 1);
  return { op: 'BG_SET', id, ...opts };
}

function parseChCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 3, '@ch requires (name pose pos)', line, raw);
  const name = args[0];
  const pose = args[1];
  const rawPos = args[2];
  const pos = normalizePosition(rawPos);
  if (!pos) {
    argsError(`Invalid position: ${rawPos} (must be left/center/right or L/C/R)`, line, raw);
  }
  const opts = parseOptionalArgs(args, 3);
  return { op: 'CH_SET', name, pose, pos, ...opts };
}

function parseChAnimCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 3, '@ch_anim requires (name pose pos)', line, raw);
  const name = args[0];
  const pose = args[1];
  const rawPos = args[2];
  const pos = normalizePosition(rawPos);
  if (!pos) {
    argsError(`Invalid position: ${rawPos} (must be left/center/right or L/C/R)`, line, raw);
  }
  return {
    op: 'CH_ANIM', name,
    src: pose, frames: 0, fps: 0, pos, loop: true,
  };
}

function parseChHideCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@ch_hide requires (name)', line, raw);
  const name = args[0];
  const opts = parseOptionalArgs(args, 1);
  return { op: 'CH_HIDE', name, ...opts };
}

function parseChClearCommand(args: string[], line: number, raw: string): Op {
  const opts = parseOptionalArgs(args, 0);
  return { op: 'CH_CLEAR', ...opts };
}

// ── テキスト枠スタイル（@text_style bgColor #112233 nameColor #ff0000）──
// key=value 形式 (KsPrinter 経由) と key value 形式 (raw 直書き) の両方を受け付ける。

function parseTextStyleCommand(args: string[], _line: number, _raw: string): Op {
  const result: { op: "TEXT_STYLE"; bgColor?: string; nameColor?: string } = { op: 'TEXT_STYLE' };
  const apply = (key: string, value: string) => {
    if (key === 'bgColor' || key === 'color') result.bgColor = value;
    else if (key === 'nameColor') result.nameColor = value;
  };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.includes('=')) {
      const eq = arg.indexOf('=');
      apply(arg.slice(0, eq), arg.slice(eq + 1));
      i++;
    } else if (i + 1 < args.length) {
      apply(arg, args[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }
  return result;
}

// ── Scene mode (Phase 1: VRM 統合用に追加) ──

function parseSceneModeCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@sceneMode requires (mode) — "2d" or "vrm"', line, raw);
  const mode = args[0];
  if (mode !== '2d' && mode !== 'vrm') {
    argsError(`Invalid sceneMode: ${mode} (must be "2d" or "vrm")`, line, raw);
  }
  return { op: 'SCENE_MODE', mode };
}

// ── VRM commands (Phase 1, Web only) ──

function parseVrmShowCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@vrmShow requires (id) [pos] [fade]', line, raw);
  const id = args[0];
  // pos を自前でパースし、残りを parseOptionalArgs に任せる
  let pos: StagePosition | undefined;
  let rotY: number | undefined;
  // pos/rotY は positional (`pos center`) と key=value (`pos=center`) の両形式を受ける
  // （pagesToKs → KsPrinter は key=value で emit する。parseOptionalArgs と同じ両対応方針）
  for (const [key, value] of normalizePairs(args, 1)) {
    if (key === 'pos') {
      const mapped = normalizePosition(value);
      if (!mapped) {
        argsError(`Invalid pos: ${value}`, line, raw);
      }
      pos = mapped;
    } else if (key === 'rotY') {
      const v = parseFloat(value);
      if (!isNaN(v)) rotY = v;
    }
  }
  const opts = parseOptionalArgs(args, 1);
  const x = opts.x != null ? Number(opts.x) : undefined;
  const y = opts.y != null ? Number(opts.y) : undefined;
  const s = opts.s != null ? Number(opts.s) : undefined;
  return { op: 'VRM_SHOW', id, ...(pos ? { pos } : {}), ...(opts.fadeMs != null ? { fadeMs: opts.fadeMs } : {}), ...(x != null ? { x } : {}), ...(y != null ? { y } : {}), ...(s != null ? { s } : {}), ...(rotY != null ? { rotY } : {}) };
}

function parseVrmHideCommand(args: string[], _line: number, _raw: string): Op {
  const opts = parseOptionalArgs(args, 0);
  return { op: 'VRM_HIDE', ...(opts.fadeMs != null ? { fadeMs: opts.fadeMs } : {}) };
}

function parseVrmExpressionCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@vrmExpression requires (name) [weight] [dur]', line, raw);
  const name = args[0];
  const opts = parseOptionalArgs(args, 1) as { weight?: number; dur?: number };
  return {
    op: 'VRM_EXPRESSION',
    name,
    ...(opts.weight != null ? { weight: opts.weight } : {}),
    ...(opts.dur != null ? { durationMs: opts.dur } : {}),
  };
}

function parseVrmPoseCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@vrmPose requires (preset) — "aPose" or "idle"', line, raw);
  const preset = args[0];
  if (preset !== 'aPose' && preset !== 'idle') {
    argsError(`Invalid vrm pose preset: ${preset}`, line, raw);
  }
  return { op: 'VRM_POSE', preset };
}

// Live2D
function parseLive2dCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@live2d requires (modelId [modelPath motionGroup motionIndex x y scale])', line, raw);
  // named (key=value) と positional を分離
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const a of args) {
    const m = a.match(/^([a-zA-Z_]+)=(.*)$/);
    if (m) named[m[1]] = m[2];
    else positional.push(a);
  }
  const modelId = positional[0];
  const modelPath = named.path ?? positional[1] ?? '';
  const motionGroup = named.motion ?? positional[2] ?? 'Idle';
  const motionIndexStr = named.index ?? positional[3];
  const motionIndex = motionIndexStr !== undefined ? toInt(motionIndexStr, 'motionIndex', line, raw) : 0;
  const xStr = named.x ?? positional[4];
  const x = xStr !== undefined ? toInt(xStr, 'x', line, raw) : 640;
  const yStr = named.y ?? positional[5];
  const y = yStr !== undefined ? toInt(yStr, 'y', line, raw) : 360;
  const scaleStr = named.scale ?? positional[6];
  const scale = scaleStr !== undefined ? toFloat(scaleStr, 'scale', line, raw) : 0.13;
  const opts = parseOptionalArgs(positional, 7);
  return { op: 'LIVE2D_SET', modelId, modelPath, motionGroup, motionIndex, x, y, scale, ...opts };
}

function parseLive2dHideCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@live2d_hide requires (modelId)', line, raw);
  const modelId = args[0];
  const opts = parseOptionalArgs(args, 1);
  return { op: 'LIVE2D_HIDE', modelId, ...opts };
}

function parseLive2dMotionCommand(args: string[], line: number, raw: string): Op {
  // named (key=value) と positional を分離
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const a of args) {
    const m = a.match(/^([a-zA-Z_]+)=(.*)$/);
    if (m) named[m[1]] = m[2];
    else positional.push(a);
  }
  if (positional.length < 2) {
    argsError('@live2d_motion requires (modelId motionGroup [motionIndex|index=N])', line, raw);
  }
  const modelId = positional[0];
  const motionGroup = positional[1];
  const indexStr = named.index ?? positional[2];
  const motionIndex = indexStr !== undefined ? toInt(indexStr, 'motionIndex', line, raw) : 0;
  return { op: 'LIVE2D_MOTION', modelId, motionGroup, motionIndex };
}

function parseLive2dExpressionCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 2, '@live2d_expression requires (modelId expression)', line, raw);
  return { op: 'LIVE2D_EXPRESSION', modelId: args[0], expression: args[1] };
}

// Particle
function parseParticleCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@particle requires (preset [x=N y=N s=N duration=N intensity=N blend=add])', line, raw);
  const preset = args[0];
  // editor の getBlockScript と pagesToKs → KsPrinter は両方とも key=value 形式で emit する
  // (`@particle fire_sparks x=640 y=360 duration=2500 intensity=1 blend=add`)。
  // 旧実装の parseOptionalArgs は positional ペア前提で kv 形式の x/y/s 以外を取りこぼし、
  // Play モードでパーティクルが初期位置・初期強度で発火する（実質的に見えない）バグになっていた。
  const opts: { x?: number; y?: number; s?: number; range?: number; duration?: number; intensity?: number; blendMode?: string } = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const eq = a.indexOf('=');
    if (eq <= 0) continue;
    const key = a.slice(0, eq);
    const val = a.slice(eq + 1);
    if (key === 'x') { const v = parseFloat(val); if (Number.isFinite(v)) opts.x = v; }
    else if (key === 'y') { const v = parseFloat(val); if (Number.isFinite(v)) opts.y = v; }
    else if (key === 's') { const v = parseFloat(val); if (Number.isFinite(v)) opts.s = v; }
    else if (key === 'range') { const v = parseFloat(val); if (Number.isFinite(v)) opts.range = v; }
    else if (key === 'duration') { const v = parseInt(val, 10); if (Number.isFinite(v)) opts.duration = v; }
    else if (key === 'intensity') { const v = parseFloat(val); if (Number.isFinite(v)) opts.intensity = v; }
    else if (key === 'blend') { opts.blendMode = val; }
  }
  return { op: 'PARTICLE_EMIT', preset, ...opts };
}

// JSON宣言型エフェクト: @effect <id> [wait=true]
// id は effect.json の id（effects/<id>.effect.json を再生）。
// 例: @effect fire_full_01 / @effect id="fire_full_01" wait=true
function parseEffectCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@effect requires (id [wait=true])', line, raw);
  const unquote = (s: string) => s.replace(/^["']|["']$/g, '');
  let id: string | undefined;
  let wait: boolean | undefined;
  // プリセットへの override（= ブロックエディタのスライダー）。@particle と同様の少数パラメータ。
  const over: { scale?: number; intensity?: number; x?: number; y?: number } = {};
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq > 0) {
      const key = a.slice(0, eq);
      const val = unquote(a.slice(eq + 1));
      if (key === 'id') id = val;
      else if (key === 'wait') wait = val === 'true' || val === '1';
      else if (key === 'scale') { const v = parseFloat(val); if (Number.isFinite(v)) over.scale = v; }
      else if (key === 'intensity') { const v = parseFloat(val); if (Number.isFinite(v)) over.intensity = v; }
      else if (key === 'x') { const v = parseFloat(val); if (Number.isFinite(v)) over.x = v; }
      else if (key === 'y') { const v = parseFloat(val); if (Number.isFinite(v)) over.y = v; }
    } else if (id === undefined) {
      id = unquote(a); // 位置引数の id
    }
  }
  if (!id) {
    argsError('@effect requires an id', line, raw);
  }
  return { op: 'EFFECT_PLAY', id, ...(wait ? { wait: true } : {}), ...over };
}

function parseParticleStopCommand(args: string[], _line: number, _raw: string): Op {
  return { op: 'PARTICLE_STOP', preset: args[0] || undefined };
}

// Slash trail (三日月スプライト + 残像)
// 形式: @slash x=640 y=360 angle=-30 length=400 duration=250 color=0xFFFFFF blend=add width=1.0
// すべて省略可。color は 0x プレフィックス / # プレフィックス / 10 進数を受け付ける。
function parseSlashCommand(args: string[], _line: number, _raw: string): Op {
  const opts: { x?: number; y?: number; angle?: number; length?: number; duration?: number; color?: number; blendMode?: string; width?: number } = {};
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq <= 0) continue;
    const key = a.slice(0, eq);
    const val = a.slice(eq + 1);
    if (key === 'x') { const v = parseFloat(val); if (Number.isFinite(v)) opts.x = v; }
    else if (key === 'y') { const v = parseFloat(val); if (Number.isFinite(v)) opts.y = v; }
    else if (key === 'angle') { const v = parseFloat(val); if (Number.isFinite(v)) opts.angle = v; }
    else if (key === 'length') { const v = parseFloat(val); if (Number.isFinite(v)) opts.length = v; }
    else if (key === 'duration') { const v = parseInt(val, 10); if (Number.isFinite(v)) opts.duration = v; }
    else if (key === 'color') {
      // 0xRRGGBB / #RRGGBB / 数値 のいずれも受ける
      let c: number = NaN;
      if (val.startsWith('0x') || val.startsWith('0X')) c = parseInt(val.slice(2), 16);
      else if (val.startsWith('#')) c = parseInt(val.slice(1), 16);
      else c = parseInt(val, 10);
      if (Number.isFinite(c)) opts.color = c;
    }
    else if (key === 'blend') { opts.blendMode = val; }
    else if (key === 'width') { const v = parseFloat(val); if (Number.isFinite(v)) opts.width = v; }
  }
  return { op: 'SLASH_EMIT', ...opts };
}

// Color Adjust
function parseColorAdjustCommand(args: string[], line: number, raw: string): Op {
  // key=value 形式をパース
  const kv: Record<string, string> = {};
  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq > 0) kv[arg.slice(0, eq)] = arg.slice(eq + 1);
  }
  return {
    op: 'COLOR_ADJUST',
    brightness: toFloat(kv.brightness ?? '0', 'brightness', line, raw),
    contrast: toFloat(kv.contrast ?? '0', 'contrast', line, raw),
    saturation: toFloat(kv.saturation ?? '0', 'saturation', line, raw),
    temperature: toFloat(kv.temperature ?? '0', 'temperature', line, raw),
    ...(kv.target ? { target: kv.target } : {}),
  };
}

// Character expression / lip sync / motion (3-system common)
function parseChExprCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 2, '@ch_expr requires (name expression [fadeMs])', line, raw);
  const name = args[0];
  const expression = args[1];
  const opts = parseOptionalArgs(args, 2);
  return { op: 'CH_EXPR', name, expression, ...opts };
}

function parseChLipCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 2, '@ch_lip requires (name mode)', line, raw);
  const name = args[0];
  const mode = args[1] as 'auto' | 'off' | 'voice';
  const audioUrl = args[2] || undefined;
  return { op: 'CH_LIP', name, mode, ...(audioUrl ? { audioUrl } : {}) };
}

function parseChMotionCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 2, '@ch_motion requires (name motion [index])', line, raw);
  const name = args[0];
  const motion = args[1];
  const index = args[2] !== undefined ? intArg(args, 2, 'index', line, raw) : undefined;
  return { op: 'CH_MOTION', name, motion, ...(index !== undefined ? { index } : {}) };
}

function parseChParamCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 3, '@ch_param requires (name param value [durationMs])', line, raw);
  const name = args[0];
  const param = args[1];
  const value = toFloat(args[2], 'value', line, raw);
  const durationMs = args[3] !== undefined ? intArg(args, 3, 'durationMs', line, raw) : undefined;
  return { op: 'CH_PARAM', name, param, value, ...(durationMs !== undefined ? { durationMs } : {}) };
}

function parseChStateCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 3, '@ch_state requires (name layer state)', line, raw);
  return { op: 'CH_STATE', name: args[0], layer: args[1], state: args[2] };
}

function parseBgmCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@bgm requires (id)', line, raw);
  const id = args[0];
  const opts = parseOptionalArgs(args, 1);
  return { op: 'BGM_PLAY', id, ...opts };
}

function parseBgmStopCommand(args: string[], line: number, raw: string): Op {
  const opts = parseOptionalArgs(args, 0);
  return { op: 'BGM_STOP', ...opts };
}

function parseSeStopCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'SE_STOP' };
}

function parseSpriteCommand(args: string[], line: number, raw: string): Op {
  // @sprite id storage [layer=] [x=] [y=] [opacity=] [fade=]
  requireArgs(args, 2, '@sprite requires (id storage)', line, raw);
  const id = args[0];
  const storage = args[1];
  const op: Extract<Op, { op: 'SPRITE_SET' }> = { op: 'SPRITE_SET', id, storage };
  for (let i = 2; i < args.length; i++) {
    const eq = args[i].indexOf('=');
    if (eq === -1) continue;
    const key = args[i].slice(0, eq);
    const val = args[i].slice(eq + 1);
    if (key === 'layer') op.layer = val;
    else if (key === 'x') { const v = parseFloat(val); if (!isNaN(v)) op.x = v; }
    else if (key === 'y') { const v = parseFloat(val); if (!isNaN(v)) op.y = v; }
    else if (key === 'opacity') { const v = parseFloat(val); if (!isNaN(v)) op.opacity = v; }
    else if (key === 'fade') { const v = parseInt(val, 10); if (!isNaN(v)) op.fadeMs = v; }
  }
  return op;
}

function parseSpriteMoveCommand(args: string[], line: number, raw: string): Op {
  // @sprite_move id [x=] [y=] [opacity=] [scale=] [time=]
  requireArgs(args, 1, '@sprite_move requires (id)', line, raw);
  const op: Extract<Op, { op: 'SPRITE_MOVE' }> = { op: 'SPRITE_MOVE', id: args[0] };
  for (let i = 1; i < args.length; i++) {
    const eq = args[i].indexOf('=');
    if (eq === -1) continue;
    const key = args[i].slice(0, eq);
    const val = args[i].slice(eq + 1);
    if (key === 'x') { const v = parseFloat(val); if (!isNaN(v)) op.x = v; }
    else if (key === 'y') { const v = parseFloat(val); if (!isNaN(v)) op.y = v; }
    else if (key === 'opacity') { const v = parseFloat(val); if (!isNaN(v)) op.opacity = v; }
    else if (key === 'scale') { const v = parseFloat(val); if (!isNaN(v)) op.scale = v; }
    else if (key === 'time') { const v = parseInt(val, 10); if (!isNaN(v)) op.durationMs = v; }
  }
  return op;
}

function parseSpriteHideCommand(args: string[], line: number, raw: string): Op {
  // @sprite_hide id [fade=]
  requireArgs(args, 1, '@sprite_hide requires (id)', line, raw);
  const op: Extract<Op, { op: 'SPRITE_HIDE' }> = { op: 'SPRITE_HIDE', id: args[0] };
  const fadeArg = args.slice(1).find((a) => a.startsWith('fade='));
  if (fadeArg) { const v = parseInt(fadeArg.slice(5), 10); if (!isNaN(v)) op.fadeMs = v; }
  return op;
}

function parseSpriteClearCommand(args: string[], _line: number, _raw: string): Op {
  // @sprite_clear [layer=] [fade=]
  const op: Extract<Op, { op: 'SPRITE_CLEAR' }> = { op: 'SPRITE_CLEAR' };
  for (const a of args) {
    if (a.startsWith('layer=')) op.layer = a.slice(6);
    else if (a.startsWith('fade=')) { const v = parseInt(a.slice(5), 10); if (!isNaN(v)) op.fadeMs = v; }
  }
  return op;
}

function parseLayerSetCommand(args: string[], line: number, raw: string): Op {
  // @layer name= [visible=true/false] [opacity=]
  const name = args.find((a) => a.startsWith('name='))?.slice(5) ?? (args[0] && !args[0].includes('=') ? args[0] : undefined);
  if (!name) {
    argsError('@layer requires (name)', line, raw);
  }
  const op: Extract<Op, { op: 'LAYER_SET' }> = { op: 'LAYER_SET', name };
  for (const a of args) {
    if (a.startsWith('visible=')) op.visible = a.slice(8) === 'true' || a.slice(8) === '1';
    else if (a.startsWith('opacity=')) { const v = parseFloat(a.slice(8)); if (!isNaN(v)) op.opacity = v; }
  }
  return op;
}

function parseTransitionCommand(args: string[], _line: number, _raw: string): Op {
  // @transition [target=] [type=] [time=]
  const op: Extract<Op, { op: 'TRANSITION' }> = { op: 'TRANSITION' };
  for (const a of args) {
    if (a.startsWith('target=')) op.target = a.slice(7);
    else if (a.startsWith('type=')) op.type = a.slice(5);
    else if (a.startsWith('time=')) { const v = parseInt(a.slice(5), 10); if (!isNaN(v)) op.durationMs = v; }
  }
  return op;
}

function parseWaitTransitionCommand(args: string[], _line: number, _raw: string): Op {
  // @wait_transition [target=]
  const op: Extract<Op, { op: 'WAIT_TRANSITION' }> = { op: 'WAIT_TRANSITION' };
  const target = args.find((a) => a.startsWith('target='))?.slice(7);
  if (target) op.target = target;
  return op;
}

function parseMaskCommand(args: string[], _line: number, _raw: string): Op {
  // @mask [color=#rrggbb] [opacity=] [time=]
  const op: Extract<Op, { op: 'MASK_SET' }> = { op: 'MASK_SET' };
  for (const a of args) {
    if (a.startsWith('color=')) op.color = a.slice(6);
    else if (a.startsWith('opacity=')) { const v = parseFloat(a.slice(8)); if (!isNaN(v)) op.opacity = v; }
    else if (a.startsWith('time=')) { const v = parseInt(a.slice(5), 10); if (!isNaN(v)) op.durationMs = v; }
  }
  return op;
}

function parseMaskClearCommand(args: string[], _line: number, _raw: string): Op {
  // @mask_clear [time=]
  const op: Extract<Op, { op: 'MASK_CLEAR' }> = { op: 'MASK_CLEAR' };
  const t = args.find((a) => a.startsWith('time='))?.slice(5);
  if (t) { const v = parseInt(t, 10); if (!isNaN(v)) op.durationMs = v; }
  return op;
}

function parseWaitCameraCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'WAIT_CAMERA' };
}

function parseTextClearCommand(args: string[], _line: number, _raw: string): Op {
  // @text_clear [current|all] または @text_clear [target=current|all]。既定は all。
  const positional = args.find((a) => a === 'current' || a === 'all');
  const named = args.map((a) => a.match(/^target=(current|all)$/)?.[1]).find((v): v is string => Boolean(v));
  const target = (positional ?? named) === 'current' ? 'current' : 'all';
  return { op: 'TEXT_CLEAR', target };
}

function parseSeCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@se requires (id)', line, raw);
  const id = args[0];
  const opts = parseOptionalArgs(args, 1);
  return { op: 'SE_PLAY', id, ...opts };
}

function parseVoiceCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@voice requires (id)', line, raw);
  return { op: 'VOICE_PLAY', id: args[0] };
}

function parseWaitCommand(args: string[], line: number, raw: string): Op {
  // KsPrinter は `@wait sec=1` 形式で emit、editor の直書きは `@wait 1` 形式。
  // pickArg で両対応（parseShakeCommand と同じ理由）。
  const secRaw = pickArg(args, 'sec', 0);
  if (secRaw === undefined) {
    argsError('@wait requires (sec)', line, raw);
  }
  const sec = toFloat(secRaw, 'sec', line, raw);
  const ms = Math.round(sec * 1000);
  return { op: 'WAIT_MS', ms };
}

function parseBattleCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@battle requires (troopId)', line, raw);
  const troopId = args[0];
  let onWin = '';
  let onLose = '';
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('onWin=')) onWin = arg.slice(6);
    else if (arg.startsWith('onLose=')) onLose = arg.slice(7);
  }
  return { op: 'BATTLE_START', troopId, onWin, onLose };
}

function parseTimelinePlayCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@timeline_play requires (timelineId)', line, raw);
  // pagesToKs → KsPrinter は `@timeline_play id=<id>` の key=value 形式で emit する。
  // 手書き KS / editor snapshot は positional (`@timeline_play tl_x`)。両形式を受ける。
  let timelineId = args[0];
  if (timelineId === 'id' && args.length >= 2) {
    timelineId = args[1];
  } else if (timelineId.startsWith('id=')) {
    timelineId = timelineId.slice(3);
  }
  return { op: 'TIMELINE_PLAY', timelineId };
}

function parseFilterCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@filter requires (type)', line, raw);
  // ksConverter は `@filter sepia=0.7` のように「フィルタ名を key、強度を value」とした
  // key=value 形式で emit する。一方 editor の getBlockScript は `@filter sepia 0.7` を出す。
  // どちらにも対応するため args[0] に `=` が含まれる場合は分解する。
  let filter: string;
  let intensity: number | undefined;
  let optionsStartIdx: number;
  if (args[0].includes('=')) {
    const eqIdx = args[0].indexOf('=');
    filter = args[0].slice(0, eqIdx);
    const val = parseFloat(args[0].slice(eqIdx + 1));
    if (!isNaN(val)) intensity = val;
    optionsStartIdx = 1;
  } else {
    filter = args[0];
    if (args[1] !== undefined && !isNaN(parseFloat(args[1]))) {
      intensity = parseFloat(args[1]);
      optionsStartIdx = 2;
    } else {
      optionsStartIdx = 1;
    }
  }
  const options: Record<string, unknown> = {};
  for (let i = optionsStartIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'tiling') {
      options.tiling = true;
    } else if (arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.slice(0, eqIdx);
      const val = arg.slice(eqIdx + 1);
      const num = parseFloat(val);
      options[key] = isNaN(num) ? val : num;
    }
  }
  return {
    op: 'SCREEN_FILTER', filter,
    ...(intensity !== undefined ? { intensity } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

function parseFilterClearCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'SCREEN_FILTER_CLEAR' };
}

function parseFilterMixCommand(args: string[], line: number, raw: string): Op {
  // editor の buildSnapshotScript は positional 形式（`@filter_mix sepia 0.5 rain 0.5`）、
  // pagesToKs → KsPrinter 経由は key=value 形式（`@filter_mix sepia=0.5 rain=0.5`）で
  // emit する。両方を受け付ける。target=xxx は別途分離する。
  let target: "scene" | "bg" | "ch" | undefined;
  const layerArgs: string[] = [];
  for (const a of args) {
    if (a.startsWith('target=')) {
      const v = a.slice('target='.length);
      if (v === 'bg' || v === 'ch' || v === 'scene') target = v;
    } else {
      layerArgs.push(a);
    }
  }
  const layers: Array<{ filter: string; intensity?: number }> = [];
  const isKvForm = layerArgs.length > 0 && layerArgs[0].includes('=');
  if (isKvForm) {
    // `sepia=0.5 rain=0.5` 形式
    for (const a of layerArgs) {
      const eqIdx = a.indexOf('=');
      if (eqIdx <= 0) continue;
      const filter = a.slice(0, eqIdx);
      const valStr = a.slice(eqIdx + 1);
      const intensity = parseFloat(valStr);
      layers.push({ filter, ...(Number.isFinite(intensity) ? { intensity } : {}) });
    }
  } else {
    // `sepia 0.5 rain 0.5` 形式（positional ペア）。
    // 旧仕様の sanity check として (filter, intensity) のペアを最低 1 組要求する。
    if (layerArgs.length < 2) {
      argsError('@filter_mix requires at least (type1 intensity1)', line, raw);
    }
    for (let i = 0; i < layerArgs.length; i += 2) {
      const filter = layerArgs[i];
      const intensityRaw = layerArgs[i + 1];
      const intensity = intensityRaw !== undefined ? parseFloat(intensityRaw) : undefined;
      layers.push({ filter, ...(intensity !== undefined && Number.isFinite(intensity) ? { intensity } : {}) });
    }
  }
  if (layers.length === 0) {
    argsError('@filter_mix requires at least one layer', line, raw);
  }
  return {
    op: 'FILTER_MIX',
    layers,
    ...(target ? { target } : {}),
  };
}

/**
 * 位置引数と key=value 引数の両方を受け付けてヘルパー的に取り出す。
 * Why: KsPrinter は generic に key=value 形式で emit するが、
 *      従来パーサーは位置引数しか読まなかったため SHAKE 等で NaN が出ていた。
 */
function pickArg(args: string[], key: string, positionalIndex: number): string | undefined {
  for (const a of args) {
    if (a.startsWith(`${key}=`)) return a.slice(key.length + 1);
  }
  // 位置引数候補（key=value 形式は除外）
  const positional = args.filter((a) => !a.includes('='));
  return positional[positionalIndex];
}

function parseShakeCommand(args: string[], _line: number, _raw: string): Op {
  // SHAKE は historically `intensity duration` の位置引数。
  // ksConverter は `duration=N intensity=M` を emit するので両対応する。
  const intensityRaw = pickArg(args, 'intensity', 0);
  const durationRaw = pickArg(args, 'duration', 1);
  const intensity = intensityRaw !== undefined ? parseInt(intensityRaw, 10) : undefined;
  const durationMs = durationRaw !== undefined ? parseInt(durationRaw, 10) : undefined;
  return {
    op: 'SHAKE',
    ...(intensity !== undefined && !isNaN(intensity) ? { intensity } : {}),
    ...(durationMs !== undefined && !isNaN(durationMs) ? { durationMs } : {}),
  };
}

function parseDurationOnly(args: string[]): number | undefined {
  const raw = pickArg(args, 'duration', 0);
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 10);
  return isNaN(n) ? undefined : n;
}

function parseFlashCommand(args: string[], _line: number, _raw: string): Op {
  const durationMs = parseDurationOnly(args);
  return { op: 'FLASH', ...(durationMs !== undefined ? { durationMs } : {}) };
}

function parseFadeBlackCommand(args: string[], _line: number, _raw: string): Op {
  const durationMs = parseDurationOnly(args);
  return { op: 'FADE_BLACK', ...(durationMs !== undefined ? { durationMs } : {}) };
}

function parseFadeWhiteCommand(args: string[], _line: number, _raw: string): Op {
  const durationMs = parseDurationOnly(args);
  return { op: 'FADE_WHITE', ...(durationMs !== undefined ? { durationMs } : {}) };
}

function parseBlackInCommand(args: string[], _line: number, _raw: string): Op {
  const durationMs = parseDurationOnly(args);
  return { op: 'BLACK_IN', ...(durationMs !== undefined ? { durationMs } : {}) };
}

function parseWhiteInCommand(args: string[], _line: number, _raw: string): Op {
  const durationMs = parseDurationOnly(args);
  return { op: 'WHITE_IN', ...(durationMs !== undefined ? { durationMs } : {}) };
}

function parseChMoveCommand(args: string[], line: number, raw: string): Op {
  // 名前付き time=N を抽出して positional から除外
  let namedDuration: number | undefined;
  const positional: string[] = [];
  for (const a of args) {
    const m = a.match(/^time=(\d+)$/);
    if (m) {
      namedDuration = parseInt(m[1], 10);
    } else {
      positional.push(a);
    }
  }
  if (positional.length < 2) {
    argsError('@ch_move requires (name pos [durationMs|time=N])', line, raw);
  }
  const name = positional[0];
  const rawPos = positional[1];
  const pos = normalizePosition(rawPos);
  if (!pos) {
    argsError(`Invalid position: ${rawPos} (must be left/center/right or L/C/R)`, line, raw);
  }
  const durationMs = namedDuration ?? (positional[2] !== undefined ? intArg(positional, 2, 'durationMs', line, raw) : 500);
  return { op: 'CH_MOVE', name, pos, durationMs };
}

function parseWaitVoiceEndCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'WAIT_VOICE_END' };
}

function parseOverlayCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@overlay requires (id)', line, raw);
  const id = args[0];
  const opts = parseOptionalArgs(args, 1);
  return { op: 'OVERLAY_SET', id, ...opts };
}

function parseCameraCommand(args: string[], line: number, raw: string): Op {
  const result: any = { op: 'CAMERA_SET' };
  for (const arg of args) {
    if (arg === 'reset') { result.reset = true; continue; }
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    const key = arg.slice(0, eq);
    const val = arg.slice(eq + 1);
    switch (key) {
      case 'x': result.x = toFloat(val, 'x', line, raw); break;
      case 'y': result.y = toFloat(val, 'y', line, raw); break;
      case 'zoom': result.zoom = toFloat(val, 'zoom', line, raw); break;
      case 'pivotX': result.pivotX = toFloat(val, 'pivotX', line, raw); break;
      case 'pivotY': result.pivotY = toFloat(val, 'pivotY', line, raw); break;
      case 'time': result.time = toInt(val, 'time', line, raw); break;
      case 'easing': result.easing = val; break;
      case 'shake': result.shake = toFloat(val, 'shake', line, raw); break;
    }
  }
  return result;
}

// --- Map / RPG Commands ---

function parseMapLoadCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@map_load requires (id [x y direction])', line, raw);
  const id = args[0];
  const x = args[1] !== undefined ? intArg(args, 1, 'x', line, raw) : undefined;
  const y = args[2] !== undefined ? intArg(args, 2, 'y', line, raw) : undefined;
  const direction = args[3] as any;
  const opts = parseOptionalArgs(args, 4);
  return { op: 'MAP_LOAD', id, x, y, direction, ...opts };
}

function parseMapExitCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'MAP_EXIT' };
}

function parsePlayerMoveCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 2, '@player_move requires (direction steps)', line, raw);
  const direction = args[0] as any;
  const steps = intArg(args, 1, 'steps', line, raw);
  return { op: 'PLAYER_MOVE', direction, steps };
}

function parseEventMoveCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 3, '@event_move requires (eventId x y [durationMs])', line, raw);
  const eventId = args[0];
  const x = intArg(args, 1, 'x', line, raw);
  const y = intArg(args, 2, 'y', line, raw);
  const durationMs = args[3] !== undefined ? intArg(args, 3, 'durationMs', line, raw) : undefined;
  return { op: 'EVENT_MOVE', eventId, x, y, durationMs };
}

// --- Item / Inventory ---

function parseItemAddCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 2, '@item_add requires (id amount)', line, raw);
  const id = args[0];
  const amount = intArg(args, 1, 'amount', line, raw);
  return { op: 'ITEM_ADD', id, amount };
}

function parseItemRemoveCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 2, '@item_remove requires (id amount)', line, raw);
  const id = args[0];
  const amount = intArg(args, 1, 'amount', line, raw);
  return { op: 'ITEM_REMOVE', id, amount };
}

function parseScrollTextCommand(args: string[], line: number, raw: string): Op {
  // @scroll_text "テキスト内容" [speed=2]
  // テキスト部分を結合（speed= 以外の引数はすべてテキスト）
  let speed: number | undefined;
  const textParts: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('speed=')) {
      speed = toFloat(arg.slice(6), 'speed', line, raw);
    } else {
      textParts.push(arg);
    }
  }
  // クォートを除去して結合
  let text = textParts.join(' ');
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).replace(/\\"/g, '"');
  }
  // \n をリアル改行に変換
  text = text.replace(/\\n/g, '\n');
  return { op: 'SCROLL_TEXT', text, ...(speed !== undefined ? { speed } : {}) };
}

function parseTextSpriteCommand(args: string[], line: number, raw: string): Op {
  // @text id "本文" [x=] [y=] [size=] [color=#rrggbb] [bold=true] [layer=front/back] [fade=]
  // 本文はクォート推奨（@scroll_text と同じ扱い）。key=value 以外の引数はすべて本文に結合する。
  requireArgs(args, 2, '@text requires (id "text")', line, raw);
  const id = args[0];
  const op: Extract<Op, { op: 'TEXT_SPRITE_SET' }> = { op: 'TEXT_SPRITE_SET', id, text: '' };
  const textParts: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf('=');
    const key = eq === -1 ? '' : arg.slice(0, eq);
    const val = eq === -1 ? '' : arg.slice(eq + 1);
    if (key === 'x') { const v = parseFloat(val); if (!isNaN(v)) op.x = v; }
    else if (key === 'y') { const v = parseFloat(val); if (!isNaN(v)) op.y = v; }
    else if (key === 'size') { const v = parseInt(val, 10); if (!isNaN(v)) op.size = v; }
    else if (key === 'color') { op.color = val; }
    else if (key === 'bold') { op.bold = val === 'true' || val === '1'; }
    else if (key === 'layer') { op.layer = val; }
    else if (key === 'fade') { const v = parseInt(val, 10); if (!isNaN(v)) op.fadeMs = v; }
    else textParts.push(arg);
  }
  let text = textParts.join(' ');
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).replace(/\\"/g, '"');
  }
  op.text = text.replace(/\\n/g, '\n');
  return op;
}

function parseUiShowCommand(args: string[], line: number, raw: string): Op {
  // @ui_show <screenId> [wait=true/false]（既定 true）— MomijiUI screen JSON を表示
  requireArgs(args, 1, '@ui_show requires (screenId)', line, raw);
  const op: Extract<Op, { op: 'UI_SHOW' }> = { op: 'UI_SHOW', screenId: args[0] };
  const waitArg = args.find((a) => a.startsWith('wait='));
  if (waitArg) op.wait = waitArg.slice(5) === 'true' || waitArg.slice(5) === '1';
  return op;
}

function parseUiHideCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'UI_HIDE' };
}

function parseCallCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@call requires (label)', line, raw);
  // pc: -1 は仮の値。Parser がラベル解決で実際の pc に置き換える (parse() 末尾の __label 走査経由)。
  return { op: 'CALL', pc: -1 };
}

function parseCallTemplateCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@call_template requires (templateId)', line, raw);
  return { op: 'CALL_TEMPLATE', templateId: args[0] };
}

function parseReturnCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'RETURN' };
}

function parseLayoutSetCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@layout_set requires (name)', line, raw);
  return { op: 'LAYOUT_SET', name: args[0] };
}

function parseJumpCommand(args: string[], line: number, raw: string): Op {
  requireArgs(args, 1, '@jump requires (label)', line, raw);
  // pc: -1 は仮の値。Parser がラベル解決で実際の pc に置き換える
  return { op: 'JUMP', pc: -1 };
}

function parseOverlayHideCommand(args: string[], _line: number, _raw: string): Op {
  const id = args[0];
  const opts = parseOptionalArgs(args, id ? 1 : 0);
  return { op: 'OVERLAY_HIDE', ...(id ? { id } : {}), ...opts };
}

// --- スタンドアロンコマンド（引数なし） ---

function parseLCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'WAIT_CLICK' };
}

function parsePCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'PAGE' };
}

function parseRCommand(_args: string[], _line: number, _raw: string): Op {
  return { op: 'TEXT_NL' };
}

// ======================================================================
// コマンドレジストリ — 単一の定義源（Single Source of Truth）
// ======================================================================

/**
 * コマンド名 → パーサー関数のマップ
 * lineClassifier と parseCommand の両方がこのマップから導出される
 */
export const COMMAND_PARSERS: Record<string, CommandParser> = {
  // Background
  'bg': parseBgCommand,
  // Character
  'ch': parseChCommand,
  'ch_anim': parseChAnimCommand,
  'ch_hide': parseChHideCommand,
  'ch_clear': parseChClearCommand,

  // Character expression / lip sync / motion (3-system common)
  'ch_expr': parseChExprCommand,
  'ch_lip': parseChLipCommand,
  'ch_motion': parseChMotionCommand,
  'ch_param': parseChParamCommand,
  'ch_state': parseChStateCommand,

  // Live2D
  'live2d': parseLive2dCommand,
  'live2d_hide': parseLive2dHideCommand,
  'live2d_motion': parseLive2dMotionCommand,
  'live2d_expression': parseLive2dExpressionCommand,

  // Particle
  'particle': parseParticleCommand,
  'particle_stop': parseParticleStopCommand,

  // JSON宣言型エフェクト（effect.json を再生）
  'effect': parseEffectCommand,

  // Slash trail (三日月スプライト + 残像) — パーティクル系とは別ライフサイクル
  'slash': parseSlashCommand,

  // Color Adjust
  'color_adjust': parseColorAdjustCommand,
  'ch_move': parseChMoveCommand,
  // Audio
  'bgm': parseBgmCommand,
  'bgm_stop': parseBgmStopCommand,
  'se': parseSeCommand,
  'se_stop': parseSeStopCommand,
  'text_clear': parseTextClearCommand,
  'sprite': parseSpriteCommand,
  'sprite_move': parseSpriteMoveCommand,
  'sprite_hide': parseSpriteHideCommand,
  'sprite_clear': parseSpriteClearCommand,
  // Text sprite（メッセージ枠外の固定座標テキスト。Tyrano [ptext] 相当。spr_ 同一キー空間）
  'text': parseTextSpriteCommand,
  // MomijiUI 宣言的 UI 画面（Tyrano UI 読解移植 設計書 08）
  'ui_show': parseUiShowCommand,
  'ui_hide': parseUiHideCommand,
  'layer': parseLayerSetCommand,
  'transition': parseTransitionCommand,
  'wait_transition': parseWaitTransitionCommand,
  'mask': parseMaskCommand,
  'mask_clear': parseMaskClearCommand,
  'wait_camera': parseWaitCameraCommand,
  'voice': parseVoiceCommand,
  'wait_voice_end': parseWaitVoiceEndCommand,
  // Wait
  'wait': parseWaitCommand,
  // Battle / Timeline
  'battle': parseBattleCommand,
  'timeline_play': parseTimelinePlayCommand,
  // Filter
  'filter': parseFilterCommand,
  'screenFilter': parseFilterCommand,
  'filter_clear': parseFilterClearCommand,
  'screenFilterClear': parseFilterClearCommand,
  'filter_mix': parseFilterMixCommand,
  // Visual effects
  'shake': parseShakeCommand,
  'flash': parseFlashCommand,
  'fade_black': parseFadeBlackCommand,
  'fade_white': parseFadeWhiteCommand,
  'black_in': parseBlackInCommand,
  'white_in': parseWhiteInCommand,
  // Overlay
  'overlay': parseOverlayCommand,
  'overlay_hide': parseOverlayHideCommand,
  // Camera
  'camera': parseCameraCommand,
  // Map / RPG
  'map_load': parseMapLoadCommand,
  'map_exit': parseMapExitCommand,
  'player_move': parsePlayerMoveCommand,
  'event_move': parseEventMoveCommand,
  // Item / Inventory
  'item_add': parseItemAddCommand,
  'item_remove': parseItemRemoveCommand,
  // Layout
  'layout_set': parseLayoutSetCommand,
  // Template (Common Event)
  'call': parseCallCommand,
  'call_template': parseCallTemplateCommand,
  'return': parseReturnCommand,
  // Scroll text (staff roll etc.)
  'scroll_text': parseScrollTextCommand,
  // Jump (label-based)
  'jump': parseJumpCommand,
  // Scene mode
  'sceneMode': parseSceneModeCommand,
  // Text style (ティラノ風: メッセージ枠 / 名前枠の色)
  'text_style': parseTextStyleCommand,
  // VRM (Phase 1, Web only)
  'vrmShow': parseVrmShowCommand,
  'vrmHide': parseVrmHideCommand,
  'vrmExpression': parseVrmExpressionCommand,
  'vrmPose': parseVrmPoseCommand,
};

/**
 * スタンドアロンコマンド（@l, @p, @r）のパーサーマップ
 * lineClassifier では STANDALONE_COMMANDS として特別扱いされる
 */
export const STANDALONE_PARSERS: Record<string, CommandParser> = {
  'l': parseLCommand,
  'p': parsePCommand,
  'r': parseRCommand,
};

/** lineClassifier が使う — 既知コマンド名の一覧（手動リスト不要） */
export const KNOWN_COMMAND_NAMES = Object.keys(COMMAND_PARSERS);

/** lineClassifier が使う — スタンドアロンコマンド名の一覧 */
export const STANDALONE_COMMAND_NAMES = Object.keys(STANDALONE_PARSERS);
