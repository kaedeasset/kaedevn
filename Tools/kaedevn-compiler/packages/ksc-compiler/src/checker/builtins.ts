/** IEngineAPI ビルトイン関数の型シグネチャ */

import type { KscType, ParamInfo } from '../types/ksc-type.js';
import { NUMBER_TYPE, STRING_TYPE, BOOLEAN_TYPE, VOID_TYPE, NULL_TYPE } from '../types/ksc-type.js';

// ---- Helper ----

function param(name: string, type: KscType, optional?: boolean): ParamInfo {
  return { name, type, optional };
}

function syncFn(params: ParamInfo[], returnType: KscType = VOID_TYPE): KscType {
  return { kind: 'function', params, returnType };
}

function asyncFn(params: ParamInfo[], returnType: KscType = VOID_TYPE): KscType {
  return { kind: 'function', params, returnType: { kind: 'promise', inner: returnType } };
}

// ---- Billing types (Phase 1 Day 19) ----

/** PurchaseResult object returned by purchase() */
const PURCHASE_RESULT_TYPE: KscType = {
  kind: 'object',
  fields: new Map<string, KscType>([
    ['status',        STRING_TYPE],
    ['productId',     STRING_TYPE],
    ['transactionId', STRING_TYPE],
    ['errorMessage',  STRING_TYPE],
  ]),
};

/** Entitlement object returned in restore() array */
const ENTITLEMENT_TYPE: KscType = {
  kind: 'object',
  fields: new Map<string, KscType>([
    ['productId', STRING_TYPE],
    ['grantedAt', NUMBER_TYPE],
    ['expiresAt', NUMBER_TYPE],
  ]),
};

// ---- Builtin Registry ----

/** IEngineAPI の全メソッドを KscType シグネチャとして返す（表は分野ごとの関数が足す。足す順が Map の順） */
export function getBuiltinMethods(): Map<string, KscType> {
  const m = new Map<string, KscType>();
  addNovelBuiltins(m);
  addBillingBuiltins(m);
  addEntityBuiltins(m);
  addCameraTweenCollisionBuiltins(m);
  addInputBuiltins(m);
  addGameStateBuiltins(m);
  addStdlibBuiltins(m);
  return m;
}

/** セリフ・背景・キャラクター・オーディオ・タイムライン・バトル・UI・フラグ・所持品・画面効果 */
function addNovelBuiltins(m: Map<string, KscType>): void {
  // セリフ
  m.set('showDialogue', asyncFn([
    param('speaker', STRING_TYPE),
    param('lines', { kind: 'array', element: STRING_TYPE }),
  ]));

  // 背景
  m.set('setBg', asyncFn([
    param('name', STRING_TYPE),
    param('effect', STRING_TYPE, true),
  ]));

  // テキストスタイル（話者名色 / 本文背景色）。KS の @text_style に対応。
  m.set('textStyle', asyncFn([
    param('nameColor', STRING_TYPE),
    param('bgColor', STRING_TYPE),
  ]));

  // キャラクター
  m.set('showChar', asyncFn([
    param('name', STRING_TYPE),
    param('pose', STRING_TYPE),
    param('position', STRING_TYPE, true),
    param('fadeMs', NUMBER_TYPE, true),
  ]));

  m.set('showCharAnim', asyncFn([
    param('name', STRING_TYPE),
    param('pose', STRING_TYPE),
    param('position', STRING_TYPE),
  ]));

  m.set('hideChar', asyncFn([
    param('name', STRING_TYPE),
    param('fadeMs', NUMBER_TYPE, true),
  ]));

  m.set('clearChars', asyncFn([
    param('fadeMs', NUMBER_TYPE, true),
  ]));

  m.set('moveChar', asyncFn([
    param('name', STRING_TYPE),
    param('position', STRING_TYPE),
    param('time', NUMBER_TYPE),
  ]));

  // オーディオ（同期）
  m.set('playBgm', syncFn([
    param('name', STRING_TYPE),
    param('vol', NUMBER_TYPE, true),
    param('fadeMs', NUMBER_TYPE, true),
  ]));

  m.set('stopBgm', syncFn([]));

  m.set('fadeBgm', asyncFn([
    param('time', NUMBER_TYPE),
  ]));

  m.set('playSe', syncFn([
    param('name', STRING_TYPE),
    param('vol', NUMBER_TYPE, true),
  ]));

  m.set('playVoice', syncFn([
    param('name', STRING_TYPE),
  ]));

  // タイムライン
  m.set('playTimeline', asyncFn([
    param('name', STRING_TYPE),
  ]));

  // バトル
  m.set('battleStart', asyncFn(
    [param('troopId', STRING_TYPE)],
    { kind: 'union', members: [{ kind: 'literal', value: 'win' }, { kind: 'literal', value: 'lose' }] },
  ));

  // UI
  m.set('showChoice', asyncFn(
    [param('options', { kind: 'array', element: {
      kind: 'object',
      fields: new Map<string, KscType>([
        ['text', STRING_TYPE],
        ['condition', { kind: 'union', members: [{ kind: 'boolean' }, { kind: 'undefined' }] }],
      ]),
    }})],
    NUMBER_TYPE,
  ));

  m.set('waitForClick', asyncFn([]));

  m.set('wait', asyncFn([
    param('ms', NUMBER_TYPE),
  ]));

  // Flag
  m.set('setFlag', syncFn([param('key', STRING_TYPE), param('val', STRING_TYPE)]));
  m.set('getFlag', syncFn([param('key', STRING_TYPE)]));

  // Inventory
  m.set('giveItem', syncFn([param('id', STRING_TYPE), param('n', NUMBER_TYPE)]));
  m.set('takeItem', syncFn([param('id', STRING_TYPE), param('n', NUMBER_TYPE)]));
  m.set('hasItem', syncFn([param('id', STRING_TYPE)]));

  // Screen filter
  m.set('screenFilter', syncFn([
    param('type', STRING_TYPE),
    param('intensity', NUMBER_TYPE, true),
  ]));
  m.set('filter', syncFn([
    param('type', STRING_TYPE),
    param('intensity', NUMBER_TYPE, true),
  ]));

  m.set('screenFilterClear', syncFn([]));
  m.set('filter_clear', syncFn([]));

  // Shake
  m.set('shake', asyncFn([
    param('intensity', NUMBER_TYPE, true),
    param('durationMs', NUMBER_TYPE, true),
  ]));
}

function addBillingBuiltins(m: Map<string, KscType>): void {
  // --------------------------------------------------------------------------
  // Billing (Phase 1 Day 19) — bridged by BillingHostBinding on native,
  //                            by WebBillingStub on web preview.
  // --------------------------------------------------------------------------

  // platform() → "android" | "ios" | "switch" | "web" | "stub"
  m.set('platform', syncFn([], STRING_TYPE));

  // isEntitled(productId) → boolean   (sync, reads in-process cache)
  m.set('isEntitled', syncFn([param('productId', STRING_TYPE)], BOOLEAN_TYPE));

  // owned(productId) → boolean        (alias of isEntitled)
  m.set('owned', syncFn([param('productId', STRING_TYPE)], BOOLEAN_TYPE));

  // await purchase(productId) → { status, productId, transactionId?, errorMessage? }
  m.set('purchase', asyncFn(
    [param('productId', STRING_TYPE)],
    PURCHASE_RESULT_TYPE,
  ));

  // await restore() → Entitlement[]
  m.set('restore', asyncFn(
    [],
    { kind: 'array', element: ENTITLEMENT_TYPE },
  ));
}

function addEntityBuiltins(m: Map<string, KscType>): void {
  // --------------------------------------------------------------------------
  // ECS / Entity (Phase 1 #2) — bridged by EntityHostBinding on native.
  // EntityHandle is a uint32_t packed (index, generation); exposed to KSC as
  // a plain number. Stale handles return false / null automatically.
  // --------------------------------------------------------------------------

  /** Pos object returned by getPos() */
  const POS_TYPE: KscType = {
    kind: 'object',
    fields: new Map<string, KscType>([
      ['x', NUMBER_TYPE],
      ['y', NUMBER_TYPE],
    ]),
  };

  // spawn(x?, y?) → handle (number)
  m.set('spawn', syncFn([
    param('x', NUMBER_TYPE, true),
    param('y', NUMBER_TYPE, true),
  ], NUMBER_TYPE));

  // destroy(handle) → boolean
  m.set('destroy', syncFn([param('handle', NUMBER_TYPE)], BOOLEAN_TYPE));

  // isAlive(handle) → boolean
  m.set('isAlive', syncFn([param('handle', NUMBER_TYPE)], BOOLEAN_TYPE));

  // setPos(handle, x, y) → boolean
  m.set('setPos', syncFn([
    param('handle', NUMBER_TYPE),
    param('x', NUMBER_TYPE),
    param('y', NUMBER_TYPE),
  ], BOOLEAN_TYPE));

  // getPos(handle) → { x, y } | null
  m.set('getPos', syncFn([param('handle', NUMBER_TYPE)], {
    kind: 'union',
    members: [POS_TYPE, NULL_TYPE],
  }));

  // setSprite(handle, texRef: number | string) → boolean
  // - number: pre-registered texture handle (e.g. procedural texture)
  // - string: asset path/URL — host auto-loads on first use, returns
  //          immediately with a freshly allocated handle. Sprite stays
  //          blank until the load completes (no flicker, no exception).
  m.set('setSprite', syncFn([
    param('handle', NUMBER_TYPE),
    param('texRef', { kind: 'union', members: [NUMBER_TYPE, STRING_TYPE] }),
  ], BOOLEAN_TYPE));

  // setLayer(handle, z) → boolean
  m.set('setLayer', syncFn([
    param('handle', NUMBER_TYPE),
    param('z', NUMBER_TYPE),
  ], BOOLEAN_TYPE));

  // entityCount() → number
  m.set('entityCount', syncFn([], NUMBER_TYPE));
}

function addCameraTweenCollisionBuiltins(m: Map<string, KscType>): void {
  // --------------------------------------------------------------------------
  // 2D Camera (Phase 1 #3) — bridged by CameraHostBinding on native.
  // --------------------------------------------------------------------------

  /** CameraState object returned by getCamera() */
  const CAMERA_STATE_TYPE: KscType = {
    kind: 'object',
    fields: new Map<string, KscType>([
      ['x',        NUMBER_TYPE],
      ['y',        NUMBER_TYPE],
      ['zoom',     NUMBER_TYPE],
      ['rotation', NUMBER_TYPE],
    ]),
  };

  // setCamera(x, y, zoom?, rotation?) → boolean
  m.set('setCamera', syncFn([
    param('x', NUMBER_TYPE),
    param('y', NUMBER_TYPE),
    param('zoom', NUMBER_TYPE, true),
    param('rotation', NUMBER_TYPE, true),
  ], BOOLEAN_TYPE));

  // getCamera() → { x, y, zoom, rotation }
  m.set('getCamera', syncFn([], CAMERA_STATE_TYPE));

  // cameraFollow(handle | null) → boolean
  // Argument is union; type-checker accepts either a number or null literal.
  m.set('cameraFollow', syncFn([
    param('handle', { kind: 'union', members: [NUMBER_TYPE, NULL_TYPE] }),
  ], BOOLEAN_TYPE));

  // cameraTarget() → number | null
  m.set('cameraTarget', syncFn([], {
    kind: 'union',
    members: [NUMBER_TYPE, NULL_TYPE],
  }));

  // --------------------------------------------------------------------------
  // Tween (Phase 1 #4) — bridged by TweenHostBinding on native.
  // KSC author calls these in script logic; per-frame update is engine-driven.
  // --------------------------------------------------------------------------

  // tweenTo(handle, x, y, durationMs, easing?) → boolean
  // easing: "linear" | "easeIn" | "easeOut" | "easeInOut" (unknown → linear)
  m.set('tweenTo', syncFn([
    param('handle', NUMBER_TYPE),
    param('x', NUMBER_TYPE),
    param('y', NUMBER_TYPE),
    param('durationMs', NUMBER_TYPE),
    param('easing', STRING_TYPE, true),
  ], BOOLEAN_TYPE));

  // tweenStop(handle) → boolean
  m.set('tweenStop', syncFn([param('handle', NUMBER_TYPE)], BOOLEAN_TYPE));

  // tweenActive(handle) → boolean
  m.set('tweenActive', syncFn([param('handle', NUMBER_TYPE)], BOOLEAN_TYPE));

  // tweenCount() → number
  m.set('tweenCount', syncFn([], NUMBER_TYPE));

  // --------------------------------------------------------------------------
  // Collision (Phase 1 #5) — bridged by CollisionHostBinding on native.
  // --------------------------------------------------------------------------

  // setCollider(handle, w, h, tag?) → boolean
  m.set('setCollider', syncFn([
    param('handle', NUMBER_TYPE),
    param('w', NUMBER_TYPE),
    param('h', NUMBER_TYPE),
    param('tag', STRING_TYPE, true),
  ], BOOLEAN_TYPE));

  // removeCollider(handle) → boolean
  m.set('removeCollider', syncFn([param('handle', NUMBER_TYPE)], BOOLEAN_TYPE));

  // hasCollider(handle) → boolean
  m.set('hasCollider', syncFn([param('handle', NUMBER_TYPE)], BOOLEAN_TYPE));

  // overlap(a, b) → boolean
  m.set('overlap', syncFn([
    param('a', NUMBER_TYPE),
    param('b', NUMBER_TYPE),
  ], BOOLEAN_TYPE));

  // aabbQuery(x, y, w, h, tag?) → number | null
  m.set('aabbQuery', syncFn([
    param('x', NUMBER_TYPE),
    param('y', NUMBER_TYPE),
    param('w', NUMBER_TYPE),
    param('h', NUMBER_TYPE),
    param('tag', STRING_TYPE, true),
  ], { kind: 'union', members: [NUMBER_TYPE, NULL_TYPE] }));
}

function addInputBuiltins(m: Map<string, KscType>): void {
  // --------------------------------------------------------------------------
  // Input (Phase 2 #1) — bridged by InputHostBinding on native.
  // ポーリング型の入力クエリ。毎フレーム InputManager::beginFrame() が呼ばれる
  // 前提で、justPressed / justReleased は 1 フレームだけ true になる。
  //
  // Action 名 (string): "OK" | "Back" | "Menu" | "SkipToggle" | "AutoToggle"
  //   | "Log" | "QuickSave" | "QuickLoad" | "Screenshot" | "HideWindow"
  //   | "MapUp" | "MapDown" | "MapLeft" | "MapRight" | "Interact"
  // --------------------------------------------------------------------------

  // pressed(action) → boolean   (held — true while down)
  m.set('pressed', syncFn([param('action', STRING_TYPE)], BOOLEAN_TYPE));

  // justPressed(action) → boolean   (rising edge — true for 1 frame)
  m.set('justPressed', syncFn([param('action', STRING_TYPE)], BOOLEAN_TYPE));

  // justReleased(action) → boolean   (falling edge — true for 1 frame)
  m.set('justReleased', syncFn([param('action', STRING_TYPE)], BOOLEAN_TYPE));

  // axis(name) → number   ("horizontal" | "vertical", -1..+1)
  m.set('axis', syncFn([param('name', STRING_TYPE)], NUMBER_TYPE));

  /** Pointer object returned by pointer() */
  const POINTER_TYPE: KscType = {
    kind: 'object',
    fields: new Map<string, KscType>([
      ['x',    NUMBER_TYPE],
      ['y',    NUMBER_TYPE],
      ['down', BOOLEAN_TYPE],
    ]),
  };

  // pointer() → { x, y, down }
  m.set('pointer', syncFn([], POINTER_TYPE));
}

function addGameStateBuiltins(m: Map<string, KscType>): void {
  // --------------------------------------------------------------------------
  // Game state (軽量ゲーム量産 / GameHost) — bridged by GameHost on native.
  // 宣言的UI(UiKit)で書けない固有ルール(動的増分・購入・勝敗判定 等)を
  // KSC スクリプトで表現するためのホスト関数。値は数値の key-value 状態。
  // --------------------------------------------------------------------------

  // getVar(name) → number   現在の状態値(未設定は 0)
  m.set('getVar', syncFn([param('name', STRING_TYPE)], NUMBER_TYPE));

  // setVar(name, value)      状態値を設定
  m.set('setVar', syncFn([param('name', STRING_TYPE), param('value', NUMBER_TYPE)]));

  // battleUnits(side) → Unit[]   構造化入力。GameHost が保持するロスターを配列で渡す。
  // ("data = game, KSC = interpreter" の host 連携: 構造化データ getter)
  // 状態異常は数値フィールドへフラット化（poisonTurns/paralyzeTurns/stunTurns）。
  const UNIT_VIEW: KscType = {
    kind: 'object',
    fields: new Map<string, KscType>([
      ['hp', NUMBER_TYPE],
      ['hpMax', NUMBER_TYPE],
      ['mp', NUMBER_TYPE],
      ['mpMax', NUMBER_TYPE],
      ['atk', NUMBER_TYPE],
      ['def', NUMBER_TYPE],
      ['spd', NUMBER_TYPE],
      ['poisonTurns', NUMBER_TYPE],
      ['paralyzeTurns', NUMBER_TYPE],
      ['stunTurns', NUMBER_TYPE],
      ['poisonOnHit', NUMBER_TYPE],
    ]),
  };
  m.set('battleUnits', syncFn([param('side', STRING_TYPE)], { kind: 'array', element: UNIT_VIEW }));

  // unitSkills(side, idx) → number[]   ユニットの所持スキル ID 配列（行動候補）
  m.set('unitSkills', syncFn(
    [param('side', STRING_TYPE), param('idx', NUMBER_TYPE)],
    { kind: 'array', element: NUMBER_TYPE },
  ));

  // skillDef(id) → Skill   スキル定義（構造化パラメータ・全て数値・割合は整数%）。
  // kind: 1=attack, 2=heal / statusId: 0=なし, 1=poison, 2=paralyze, 3=stun
  // JS 式 formula は KSC で評価不可のため持たない（構造化パラメータが正、doc 2026/06/13/02）。
  const SKILL_VIEW: KscType = {
    kind: 'object',
    fields: new Map<string, KscType>([
      ['kind', NUMBER_TYPE],
      ['powerPct', NUMBER_TYPE],
      ['mpCost', NUMBER_TYPE],
      ['hitPct', NUMBER_TYPE],
      ['varPct', NUMBER_TYPE],
      ['statusId', NUMBER_TYPE],
      ['statusPct', NUMBER_TYPE],
      ['statusTurns', NUMBER_TYPE],
    ]),
  };
  m.set('skillDef', syncFn([param('id', NUMBER_TYPE)], SKILL_VIEW));

  // battleConfig() → { seed, turnLimit, hitPct, varPct, powerPct }   対戦設定(数値)
  const BATTLE_CONFIG: KscType = {
    kind: 'object',
    fields: new Map<string, KscType>([
      ['seed', NUMBER_TYPE],
      ['turnLimit', NUMBER_TYPE],
      ['hitPct', NUMBER_TYPE],
      ['varPct', NUMBER_TYPE],
      ['powerPct', NUMBER_TYPE],
    ]),
  };
  m.set('battleConfig', syncFn([], BATTLE_CONFIG));

  // battleLog(turn, side, idx, skillId, targetSide, targetIdx, value, kind)
  // 戦闘ログ1行を host へ通知（リプレイ演出の素）。全引数 number（scalar 出力制約の範囲内）。
  // side/targetSide: 0=party, 1=enemies
  // kind: 1=命中ダメージ, 2=ミス, 3=回復, 4=状態付与, 5=毒tick, 6=行動不能スキップ
  m.set('battleLog', syncFn([
    param('turn', NUMBER_TYPE),
    param('side', NUMBER_TYPE),
    param('idx', NUMBER_TYPE),
    param('skillId', NUMBER_TYPE),
    param('targetSide', NUMBER_TYPE),
    param('targetIdx', NUMBER_TYPE),
    param('value', NUMBER_TYPE),
    param('kind', NUMBER_TYPE),
  ]));

  // action() → string        現在ディスパッチ中の action 文字列
  m.set('action', syncFn([], STRING_TYPE));

  // now() → number           現在時刻(ms)。放置ゲームの壁時計計算に使う(host 提供)
  m.set('now', syncFn([], NUMBER_TYPE));

  // gotoScreen(name)         画面遷移
  m.set('gotoScreen', syncFn([param('name', STRING_TYPE)]));

  // quitGame()               終了
  m.set('quitGame', syncFn([]));
}

function addStdlibBuiltins(m: Map<string, KscType>): void {
  // --------------------------------------------------------------------------
  // Standard library — deterministic pure math (stdlib, 2026-06-13)
  // --------------------------------------------------------------------------
  // These are intercepted IN-VM (both the TS VM and the C++ VM) before the
  // HOST_CALL ever reaches the host, so they have NO host dependency and are
  // byte-for-byte identical across platforms. Only deterministic functions are
  // included: trig / pow(fractional) / random / time are excluded because libm
  // and entropy differ across platforms and would break TS↔C++ parity.
  // Names are reserved (cannot be shadowed by user functions), same as the
  // engine builtins above. The names are listed in STDLIB_NAMES (stdlib.ts).
  m.set('floor', syncFn([param('x', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('ceil',  syncFn([param('x', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('round', syncFn([param('x', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('trunc', syncFn([param('x', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('abs',   syncFn([param('x', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('sign',  syncFn([param('x', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('sqrt',  syncFn([param('x', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('min',   syncFn([param('a', NUMBER_TYPE), param('b', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('max',   syncFn([param('a', NUMBER_TYPE), param('b', NUMBER_TYPE)], NUMBER_TYPE));
  m.set('clamp', syncFn([param('x', NUMBER_TYPE), param('lo', NUMBER_TYPE), param('hi', NUMBER_TYPE)], NUMBER_TYPE));
}
