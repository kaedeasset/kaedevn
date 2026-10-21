/**
 * Timeline JSON v1.1 Type Definitions
 *
 * 後方互換性: v1のJSONはすべて有効
 * 新規追加: fillMode, easing enum, clipOffsetMs
 */

// ============================================================================
// Core Types
// ============================================================================

export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "step"; // ホールド（補間なし）。次keyframeに達するまで現在値を保持。
            // 手描きアニメの「コマ打ち」= 連番frameの段階切替に使う。

export type FillMode =
  | "hold"   // clip終了後も最終値を保持（デフォルト）
  | "none"   // clip外では値を変更しない
  | "reset"; // clip終了後はdefaultValueに戻す

export type TrackKind =
  | "camera"
  | "entity"
  | "audio"
  | "event";

// ============================================================================
// Timeline Root
// ============================================================================

export interface TimelineRoot {
  schemaVersion: 1;
  durationMs: number;
  tracks: Track[];
}

// ============================================================================
// Track (discriminated union by kind)
// ============================================================================

export type Track = CameraTrack | EntityTrack | AudioTrack | EventTrack;

interface BaseTrack {
  id: string;
  kind: TrackKind;
  order: number;
  enabled: boolean;
  clips: Clip[];
}

export interface CameraTrack extends BaseTrack {
  kind: "camera";
  targetId: "camera"; // 固定
}

export interface EntityTrack extends BaseTrack {
  kind: "entity";
  targetId: string; // entity ID
}

export interface AudioTrack extends BaseTrack {
  kind: "audio";
  targetId: string; // audio source ID
}

export interface EventTrack extends BaseTrack {
  kind: "event";
  targetId?: never; // イベントはtargetなし
}

// ============================================================================
// Clip
// ============================================================================

export interface Clip {
  id: string;
  startMs: number;
  endMs: number;

  /**
   * v1.1新規追加（省略可能）
   * デフォルト: "hold"
   */
  fillMode?: FillMode;

  channels: Channel[];
}

// ============================================================================
// Channel
// ============================================================================

export interface Channel {
  property: string;

  /**
   * clip評価開始時のベース値
   * keyframe補間には使用されない
   */
  defaultValue: number;

  keyframes: Keyframe[];
}

// ============================================================================
// Keyframe
// ============================================================================

export interface Keyframe {
  /**
   * v1互換フィールド（非推奨・v1.1ではclipOffsetMs推奨）
   * clipのstartMsを0とした相対時間（ミリ秒）
   */
  tMs?: number;

  /**
   * v1.1推奨フィールド
   * clipのstartMsを0とした相対時間（ミリ秒）
   * tMsとclipOffsetMsの両方が存在する場合はclipOffsetMsを優先
   */
  clipOffsetMs?: number;

  value: number;

  /**
   * 次のkeyframeへの補間方法
   * 省略時: "linear"
   * 最終keyframeでは無視される
   */
  easing?: Easing;
}

// ============================================================================
// Evaluation Result (実行時の評価結果)
// ============================================================================

export interface EvaluationResult {
  trackId: string;
  targetId: string | null;
  properties: Record<string, number>;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Keyframeの時間値を取得（v1/v1.1両対応）
 */
export function getKeyframeTime(kf: Keyframe): number {
  return kf.clipOffsetMs ?? kf.tMs ?? 0;
}

/**
 * Clipの持続時間を取得
 */
export function getClipDuration(clip: Clip): number {
  return clip.endMs - clip.startMs;
}

/**
 * FillModeのデフォルト値を取得
 */
export function getEffectiveFillMode(clip: Clip): FillMode {
  return clip.fillMode ?? "hold";
}

/**
 * Easingのデフォルト値を取得
 */
export function getEffectiveEasing(kf: Keyframe): Easing {
  return kf.easing ?? "linear";
}
