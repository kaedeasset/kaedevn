/**
 * [keyframe]/[kanim] と [mtext] の in_effect → TimelineRoot（P6-5・P6-7）。
 */
import type { TimelineRoot, Channel, Keyframe, Easing } from '@kaedevn/core';
import type { TyranoKeyframeDef } from '../tyranoSemantics.js';

/** Tyrano [frame] の CSS 系 easing 名 → kaedevn timeline の Easing。 */
const KEYFRAME_EASING_MAP: Record<string, Easing> = {
  'linear': 'linear',
  'ease': 'easeInOut',
  'ease-in': 'easeIn',
  'ease-out': 'easeOut',
  'ease-in-out': 'easeInOut',
};

/** [frame] の属性名 → timeline channel property（対応分のみ）。 */
const KEYFRAME_PROP_MAP: Record<string, string> = {
  x: 'x',
  left: 'x',
  y: 'y',
  top: 'y',
  opacity: 'opacity',
  scale: 'scale',
};

/**
 * [keyframe] 定義を TimelineRoot へ変換する。
 * - `p="25%"` → clipOffsetMs = 0.25 × durationMs
 * - x/y は TimelineDelegate が base 位置相対で適用するため、配置座標（[image]/[ptext] 追跡）との
 *   差分に変換する。配置座標が不明な場合は絶対値をそのまま相対値として出力し warning。
 * - rotate は TimelineDelegate が rotation を適用しないため破棄 + warning。
 * - 未知の easing は linear + warning。
 */
export function buildTimelineFromKeyframes(
  def: TyranoKeyframeDef,
  durationMs: number,
  targetId: string,
  base: { x?: number; y?: number } | undefined,
): { timeline: TimelineRoot; warnings: string[] } {
  const warnings: string[] = [];
  const channels = new Map<string, Channel>();
  const droppedProps = new Set<string>();
  let baseWarned = false;

  for (const frame of def.frames) {
    // フレーム単位の easing（e= / easing=）。次 keyframe への補間に適用される。
    const easingRaw = frame.props.e ?? frame.props.easing;
    let easing: Easing | undefined;
    if (easingRaw !== undefined) {
      easing = KEYFRAME_EASING_MAP[easingRaw.trim().toLowerCase()];
      if (!easing) {
        easing = 'linear';
        warnings.push(`[kanim] unknown easing "${easingRaw}" in keyframe "${def.name}" mapped to linear.`);
      }
    }

    for (const [key, rawValue] of Object.entries(frame.props)) {
      if (key === 'e' || key === 'easing') continue;
      const property = KEYFRAME_PROP_MAP[key];
      if (!property) {
        droppedProps.add(key);
        continue;
      }
      let value = parseFloat(rawValue.replace(/px$/i, ''));
      if (isNaN(value)) continue;
      if (property === 'x' || property === 'y') {
        const baseValue = property === 'x' ? base?.x : base?.y;
        if (baseValue !== undefined) {
          value -= baseValue; // base 相対へ差分化
        } else if (!baseWarned) {
          baseWarned = true;
          warnings.push(`[kanim] target "${targetId}" has no tracked placement position; absolute x/y emitted as base-relative values.`);
        }
      }
      let channel = channels.get(property);
      if (!channel) {
        channel = { property, defaultValue: property === 'opacity' || property === 'scale' ? 1 : 0, keyframes: [] };
        channels.set(property, channel);
      }
      const kf: Keyframe = { clipOffsetMs: Math.round(frame.p * durationMs), value };
      if (easing) kf.easing = easing;
      channel.keyframes.push(kf);
    }
  }

  if (droppedProps.size > 0) {
    warnings.push(`[kanim] unsupported keyframe propert${droppedProps.size > 1 ? 'ies' : 'y'} dropped: ${[...droppedProps].join(', ')} (timeline applies x/y/opacity/scale only).`);
  }

  const timeline: TimelineRoot = {
    schemaVersion: 1,
    durationMs,
    tracks: [
      {
        id: `track_${targetId}`,
        kind: 'entity',
        order: 0,
        enabled: true,
        targetId,
        clips: [
          {
            id: 'clip_0',
            startMs: 0,
            endMs: durationMs,
            channels: [...channels.values()],
          },
        ],
      },
    ],
  };
  return { timeline, warnings };
}

/**
 * [mtext] の in_effect（animate.css 系の名前）を timeline channels へ写す。
 * fadeIn 系（方向・Big つき）と zoomIn はネイティブ変換、その他は fade-in へ丸めて approximated=true。
 */
export function buildMtextInEffect(effect: string, durationMs: number): { channels: Channel[]; approximated: boolean } {
  const opacityIn: Channel = {
    property: 'opacity',
    defaultValue: 1,
    keyframes: [
      { clipOffsetMs: 0, value: 0 },
      { clipOffsetMs: durationMs, value: 1 },
    ],
  };
  const offsetChannel = (property: 'x' | 'y', from: number): Channel => ({
    property,
    defaultValue: 0,
    keyframes: [
      { clipOffsetMs: 0, value: from },
      { clipOffsetMs: durationMs, value: 0, easing: 'easeOut' },
    ],
  });

  const m = effect.trim().match(/^fadeIn(Up|Down|Left|Right)?(Big)?$/i);
  if (m) {
    const channels = [opacityIn];
    const dist = m[2] ? 500 : 100;
    const dir = m[1]?.toLowerCase();
    if (dir === 'up') channels.push(offsetChannel('y', dist));        // 下から上へ
    else if (dir === 'down') channels.push(offsetChannel('y', -dist)); // 上から下へ
    else if (dir === 'left') channels.push(offsetChannel('x', -dist));
    else if (dir === 'right') channels.push(offsetChannel('x', dist));
    return { channels, approximated: false };
  }
  if (/^zoomIn$/i.test(effect.trim())) {
    const scale: Channel = {
      property: 'scale',
      defaultValue: 1,
      keyframes: [
        { clipOffsetMs: 0, value: 0.3 },
        { clipOffsetMs: durationMs, value: 1, easing: 'easeOut' },
      ],
    };
    return { channels: [opacityIn, scale], approximated: false };
  }
  return { channels: [opacityIn], approximated: true };
}
