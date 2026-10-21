/**
 * Runtime IR (Instruction Set)
 *
 * コンパイラが出力し、ランタイムが実行する唯一の形式。
 * DSLは直接実行せず、必ずOp命令列に変換される。
 */

export type Direction = "down" | "left" | "right" | "up";

export type Op =
  // テキスト
  | { op: "TEXT_APPEND"; who?: string; text: string }
  | { op: "TEXT_NL" }
  // メッセージ枠 / 名前枠の色指定（ティラノスクリプト @text_style 風）
  // bgColor / nameColor は "#rrggbb" or "rgba(...)"。省略で各既定にリセット。
  | { op: "TEXT_STYLE"; bgColor?: string; nameColor?: string }
  // メッセージテキストのクリア（待機なし・改ページ [PAGE] と違いクリック待ちしない）。
  // target: "all"（全メッセージレイヤ相当）/ "current"（現在レイヤ相当）。既定 "all"。
  | { op: "TEXT_CLEAR"; target?: "current" | "all" }

  // 待機
  | { op: "WAIT_CLICK" }
  | { op: "PAGE" }
  | { op: "WAIT_MS"; ms: number }

  // 背景
  | { op: "BG_SET"; id: string; fadeMs?: number; effect?: "fade" | "slide_left" | "slide_right"; x?: number; y?: number; s?: number }
  | { op: "BG_CLEAR"; fadeMs?: number }

  // キャラ
  | {
      op: "CH_SET";
      name: string;
      pose: string;
      pos: "left" | "center" | "right";
      fadeMs?: number;
      x?: number; y?: number; s?: number;
    }
  | { op: "CH_HIDE"; name: string; fadeMs?: number }
  | { op: "CH_CLEAR"; fadeMs?: number }
  | { op: "CH_MOVE"; name: string; pos: "left" | "center" | "right"; durationMs: number }

  // アニメーション立ち絵
  | {
      op: "CH_ANIM";
      name: string;
      src: string;
      frames: number;
      fps: number;
      pos: "left" | "center" | "right";
      loop?: boolean;
    }

  // Live2D キャラ
  | {
      op: "LIVE2D_SET";
      modelId: string;
      modelPath: string;
      motionGroup: string;
      motionIndex: number;
      x: number; y: number;
      scale: number;
      fadeMs?: number;
    }
  | { op: "LIVE2D_HIDE"; modelId: string; fadeMs?: number }
  | { op: "LIVE2D_MOTION"; modelId: string; motionGroup: string; motionIndex: number }
  | { op: "LIVE2D_EXPRESSION"; modelId: string; expression: string }

  // キャラ表情・リップシンク・モーション（3系統共通）
  | { op: "CH_EXPR"; name: string; expression: string; fadeMs?: number }
  | { op: "CH_LIP"; name: string; mode: "auto" | "off" | "voice"; audioUrl?: string }
  | { op: "CH_MOTION"; name: string; motion: string; index?: number }
  | { op: "CH_PARAM"; name: string; param: string; value: number; durationMs?: number }
  | { op: "CH_STATE"; name: string; layer: string; state: string }

  // パーティクル
  | { op: "PARTICLE_EMIT"; preset: string; x?: number; y?: number; s?: number; range?: number; duration?: number; intensity?: number; blendMode?: string }
  | { op: "PARTICLE_STOP"; preset?: string }

  // JSON宣言型エフェクト（effects/<id>.effect.json を EffectPlayer で再生）
  // wait=true で再生完了まで待つ。既定は非待機（オーバーレイ再生しつつ進行）。
  // scale/intensity/x/y はプリセットへの override（ブロックエディタのスライダー相当）。
  | { op: "EFFECT_PLAY"; id: string; wait?: boolean; scale?: number; intensity?: number; x?: number; y?: number }

  // 斬撃の軌跡（三日月スプライト + 残像トレイル）
  // x,y を中心とした円弧上を leader sprite が duration ms で振り抜き、
  // 毎フレーム残像（trail samples）をクローン生成して α 減衰させる。
  // パーティクルとは別ライフサイクルのため Op も分けてある。
  | { op: "SLASH_EMIT"; x?: number; y?: number; angle?: number; length?: number; duration?: number; color?: number; blendMode?: string; width?: number }

  // 色調補正
  | { op: "COLOR_ADJUST"; brightness: number; contrast: number; saturation: number; temperature: number; target?: string }

  // 音声
  | { op: "BGM_PLAY"; id: string; vol?: number; fadeMs?: number }
  | { op: "BGM_STOP"; fadeMs?: number }
  | { op: "SE_PLAY"; id: string; vol?: number }
  | { op: "SE_STOP" }
  | { op: "VOICE_PLAY"; id: string }
  | { op: "WAIT_VOICE_END" }

  // 変数（VAR_SET はルート名・フラグ等の文字列/bool を許容。VAR_ADD/SUB は数値のみ）
  | { op: "VAR_SET"; name: string; value: number | string | boolean }
  | { op: "VAR_ADD"; name: string; value: number }
  | { op: "VAR_SUB"; name: string; value: number }

  // 選択肢
  | { op: "CHOICE"; options: Array<{ label: string; jump: number }> }

  // ジャンプ・分岐
  | { op: "JUMP"; pc: number }
  | { op: "JUMP_IF"; condition: string; pc: number }

  // バトル
  | { op: "BATTLE_START"; troopId: string; onWin: string; onLose: string; seed?: number }

  // マップ・移動 (RPG/ADV ハイブリッド)
  | { op: "MAP_LOAD"; id: string; x?: number; y?: number; direction?: Direction; fadeMs?: number }
  | { op: "MAP_EXIT" }
  | { op: "PLAYER_MOVE"; direction: Direction; steps: number }
  | { op: "EVENT_MOVE"; eventId: string; x: number; y: number; durationMs?: number }

  // アイテム・インベントリ
  | { op: "ITEM_ADD"; id: string; amount: number }
  | { op: "ITEM_REMOVE"; id: string; amount: number }

  // UI レイアウト
  | { op: "LAYOUT_SET"; name: string }

  // テンプレート呼び出し（コモンイベント）
  | { op: "CALL_TEMPLATE"; templateId: string }

  // ページ呼び出し（サブルーチン）— pc は Parser がラベルから解決する。
  // 実行時は (現 pc + 1) を call stack に積んで pc にジャンプし、
  // RETURN で stack から復帰する。
  | { op: "CALL"; pc: number }

  // サブルーチンから復帰。stack が空なら script を終了する。
  | { op: "RETURN" }

  // スクロールテキスト（スタッフロール等）
  | { op: "SCROLL_TEXT"; text: string; speed?: number }

  // タイムライン
  | { op: "TIMELINE_PLAY"; timelineId: string }

  // スクリーンフィルター
  | { op: "SCREEN_FILTER"; filter: string; intensity?: number; options?: Record<string, unknown> }
  | { op: "SCREEN_FILTER_CLEAR" }

  // 重ね掛けフィルター
  | { op: "FILTER_MIX"; layers: Array<{ filter: string; intensity?: number }>; target?: "scene" | "bg" | "ch" }

  // シェイク
  | { op: "SHAKE"; intensity?: number; durationMs?: number }

  // オーバーレイ
  | { op: "OVERLAY_SET"; id: string; fadeMs?: number; x?: number; y?: number; s?: number }
  | { op: "OVERLAY_HIDE"; id?: string; fadeMs?: number }

  // スプライト（名前付きレイヤ上の addressable 画像。Tyrano [image] 相当）
  // layer は overlayLayer 内の論理面（描画順）。id で move/hide を指定する。
  | { op: "SPRITE_SET"; id: string; storage: string; layer?: string; x?: number; y?: number; opacity?: number; fadeMs?: number }
  | { op: "SPRITE_MOVE"; id: string; x?: number; y?: number; opacity?: number; scale?: number; durationMs?: number }
  | { op: "SPRITE_HIDE"; id: string; fadeMs?: number }
  | { op: "SPRITE_CLEAR"; layer?: string; fadeMs?: number }

  // テキストスプライト（メッセージ枠外の固定座標テキスト。Tyrano [ptext] 相当）
  // sprites と同一キー空間（spr_<id>）に登録され、SPRITE_MOVE/HIDE/CLEAR・timeline がそのまま効く。
  | { op: "TEXT_SPRITE_SET"; id: string; text: string; x?: number; y?: number; size?: number; color?: string; bold?: boolean; layer?: string; fadeMs?: number }

  // 宣言的 UI 画面（MomijiUI screen JSON）。screens は timelines と同様に外部注入。
  // wait=true は action（close / jump:<label>）まで待ち、jump は OpRunner がラベル解決する。
  | { op: "UI_SHOW"; screenId: string; wait?: boolean }
  | { op: "UI_HIDE" }

  // レイヤ制御・トランジション（Tyrano [layopt]/[trans]/[wt] 相当）
  // name は論理レイヤ（background/character/overlay）。
  | { op: "LAYER_SET"; name: string; visible?: boolean; opacity?: number }
  | { op: "TRANSITION"; target?: string; type?: string; durationMs?: number }
  | { op: "WAIT_TRANSITION"; target?: string }

  // カメラ
  | { op: "CAMERA_SET"; x?: number; y?: number; zoom?: number; pivotX?: number; pivotY?: number; time?: number; easing?: string; shake?: number; reset?: boolean }
  // カメラ完了待ち（Tyrano [wait_camera]）。kaedevn の CAMERA_SET は同期完了のため実質 no-op。
  | { op: "WAIT_CAMERA" }

  // マスク（全画面カラーオーバーレイ。@fade_black と違い @mask_clear まで維持する。Tyrano [mask]）
  | { op: "MASK_SET"; color?: string; opacity?: number; durationMs?: number }
  | { op: "MASK_CLEAR"; durationMs?: number }

  // 画面エフェクト（アニメーション）
  | { op: "FLASH"; durationMs?: number }
  | { op: "FADE_BLACK"; durationMs?: number }
  | { op: "FADE_WHITE"; durationMs?: number }
  | { op: "BLACK_IN"; durationMs?: number }
  | { op: "WHITE_IN"; durationMs?: number }

  // シーンモード（2D 立ち絵 / VRM 3D の切替宣言）
  // シナリオの先頭で 1 回だけ宣言する想定。
  // mode='vrm' のときは @ch* 系コマンドが compile error、
  // mode='2d' のときは @vrm* 系コマンドが compile error になる。
  | { op: "SCENE_MODE"; mode: "2d" | "vrm" }

  // VRM (Phase 1 — Web only)
  | { op: "VRM_SHOW"; id: string; pos?: "left" | "center" | "right"; fadeMs?: number; x?: number; y?: number; s?: number; rotY?: number }
  | { op: "VRM_HIDE"; fadeMs?: number }
  | { op: "VRM_EXPRESSION"; name: string; weight?: number; durationMs?: number }
  | { op: "VRM_POSE"; preset: "aPose" | "idle" };

/**
 * CH_ANIM パラメータ（ハンドラー用）
 */
export interface ChAnimParams {
  name: string;
  src: string;
  frames: number;
  fps: number;
  pos: "left" | "center" | "right";
  loop: boolean;
}

/**
 * コンパイル済みシナリオ
 */
export interface CompiledScenario {
  id: string;
  ops: Op[];
  /** ラベル名 → PC のマップ（BATTLE_START の onWin/onLose 解決用） */
  labels?: Record<string, number>;
}
