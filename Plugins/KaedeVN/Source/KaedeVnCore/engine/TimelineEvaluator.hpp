// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <algorithm>
#include <cmath>
#include <nlohmann/json.hpp>

namespace kaedevn {

/**
 * TimelineEvaluator — Tools/kaedevn-compiler/packages/core/src/timeline/{types,easing,evaluator}.ts の C++ 版。
 *
 * Timeline JSON v1.1 を評価し、指定時刻での各 Track のプロパティ値を返す。
 * TS 版と同じく **状態を持たない純関数**。再生位置の管理は呼び出し側（FKaedeOpHandler）の責務。
 *
 * 対応範囲（実作品 tyrano-tech-sample1 の 57 本を実測して決めた）:
 *   - track.kind = "entity"（targetId は "spr_<スプライトid>"）
 *   - property   = opacity / x / y / scale
 *   - easing 11 種・fillMode 3 種・v1 の tMs と v1.1 の clipOffsetMs の両方
 * camera / audio / event トラックは評価結果に含めるが、適用先は呼び出し側が決める
 * （実作品には出現しないので、UE 側は現状 entity のみ適用する）。
 *
 * NOTE(実装): engine/ の他ヘッダと同じく header-only inline。KaedeCore/KaedeKsc の
 *   両モジュールから DLL 境界を跨がず使えるようにするため。
 */

// ===== easing（easing.ts と一対一）=====
inline float ApplyEasing(float t, const std::string& easing) {
    // 範囲外は潰しておく（keyframe の時刻が逆順でも壊れないように）。
    t = std::min(1.0f, std::max(0.0f, t));

    if (easing == "linear" || easing.empty())            return t;
    if (easing == "easeIn"  || easing == "easeInQuad")   return t * t;
    if (easing == "easeOut" || easing == "easeOutQuad")  return 1.0f - (1.0f - t) * (1.0f - t);
    if (easing == "easeInOut" || easing == "easeInOutQuad")
        return (t < 0.5f) ? (2.0f * t * t)
                          : (1.0f - std::pow(-2.0f * t + 2.0f, 2.0f) / 2.0f);
    if (easing == "easeInCubic")   return t * t * t;
    if (easing == "easeOutCubic")  return 1.0f - std::pow(1.0f - t, 3.0f);
    if (easing == "easeInOutCubic")
        return (t < 0.5f) ? (4.0f * t * t * t)
                          : (1.0f - std::pow(-2.0f * t + 2.0f, 3.0f) / 2.0f);
    // step: 次の keyframe に達するまで現在値を保持（手描きアニメのコマ打ち）。
    if (easing == "step")          return (t >= 1.0f) ? 1.0f : 0.0f;
    return t;   // 未知の easing は linear 扱い（TS も同じ）
}

/** 1 Track の評価結果。properties は「プロパティ名 → 値」。 */
struct TimelineTrackResult {
    std::string trackId;
    std::string targetId;   // event トラックは空
    std::unordered_map<std::string, float> properties;
};

namespace detail {

// keyframe の時刻。v1.1 の clipOffsetMs を優先し、無ければ v1 の tMs。
inline float KeyframeTime(const nlohmann::json& kf) {
    if (kf.contains("clipOffsetMs") && kf["clipOffsetMs"].is_number())
        return kf["clipOffsetMs"].get<float>();
    if (kf.contains("tMs") && kf["tMs"].is_number())
        return kf["tMs"].get<float>();
    return 0.0f;
}

inline std::string EffectiveFillMode(const nlohmann::json& clip) {
    return clip.value("fillMode", std::string("hold"));
}

// keyframes を時刻昇順に並べたインデックス列（元配列は書き換えない）。
inline std::vector<int> SortedKeyframeIndices(const nlohmann::json& kfs) {
    std::vector<int> Idx;
    Idx.reserve(kfs.size());
    for (int i = 0; i < static_cast<int>(kfs.size()); ++i) Idx.push_back(i);
    std::stable_sort(Idx.begin(), Idx.end(),
        [&kfs](int a, int b) { return KeyframeTime(kfs[a]) < KeyframeTime(kfs[b]); });
    return Idx;
}

/** 1 channel を評価して値を返す（evaluator.ts の evaluateChannel）。 */
inline float EvaluateChannel(const nlohmann::json& channel, const nlohmann::json& clip,
                             float currentTimeMs) {
    const float DefaultValue = channel.value("defaultValue", 0.0f);
    if (!channel.contains("keyframes") || !channel["keyframes"].is_array()) return DefaultValue;
    const nlohmann::json& Kfs = channel["keyframes"];
    if (Kfs.empty()) return DefaultValue;

    const float ClipLocal = currentTimeMs - clip.value("startMs", 0.0f);
    const std::vector<int> Sorted = SortedKeyframeIndices(Kfs);

    // 最初の keyframe 以前 / 最後の keyframe 以降は端の値で止める。
    if (ClipLocal <= KeyframeTime(Kfs[Sorted.front()]))
        return Kfs[Sorted.front()].value("value", DefaultValue);
    const nlohmann::json& LastKf = Kfs[Sorted.back()];
    if (ClipLocal >= KeyframeTime(LastKf))
        return LastKf.value("value", DefaultValue);

    for (size_t i = 0; i + 1 < Sorted.size(); ++i) {
        const nlohmann::json& K0 = Kfs[Sorted[i]];
        const nlohmann::json& K1 = Kfs[Sorted[i + 1]];
        const float T0 = KeyframeTime(K0);
        const float T1 = KeyframeTime(K1);
        if (ClipLocal < T0 || ClipLocal > T1) continue;
        if (T1 <= T0) return K1.value("value", DefaultValue);   // 同時刻は後勝ち

        const float Progress = (ClipLocal - T0) / (T1 - T0);
        const float Eased = ApplyEasing(Progress, K0.value("easing", std::string("linear")));
        const float V0 = K0.value("value", DefaultValue);
        const float V1 = K1.value("value", DefaultValue);
        return V0 + (V1 - V0) * Eased;
    }
    return LastKf.value("value", DefaultValue);
}

/** 現在時刻に有効な clip を返す（[startMs, endMs) 半開区間）。無ければ nullptr。 */
inline const nlohmann::json* FindActiveClip(const nlohmann::json& clips, float currentTimeMs) {
    for (const auto& Clip : clips) {
        const float S = Clip.value("startMs", 0.0f);
        const float E = Clip.value("endMs", 0.0f);
        if (currentTimeMs >= S && currentTimeMs < E) return &Clip;
    }
    return nullptr;
}

} // namespace detail

/**
 * Timeline を評価し、その時刻での全 Track のプロパティ値を返す。
 * evaluator.ts の evaluateTimeline と同じ挙動。
 */
inline std::vector<TimelineTrackResult> EvaluateTimeline(const nlohmann::json& timeline,
                                                         float currentTimeMs) {
    std::vector<TimelineTrackResult> Results;
    if (!timeline.contains("tracks") || !timeline["tracks"].is_array()) return Results;

    for (const auto& Track : timeline["tracks"]) {
        if (!Track.value("enabled", true)) continue;
        if (!Track.contains("clips") || !Track["clips"].is_array()) continue;

        const std::string Kind = Track.value("kind", std::string());
        TimelineTrackResult R;
        R.trackId  = Track.value("id", std::string());
        R.targetId = (Kind == "event") ? std::string() : Track.value("targetId", std::string());

        if (const nlohmann::json* Active = detail::FindActiveClip(Track["clips"], currentTimeMs)) {
            if (Active->contains("channels") && (*Active)["channels"].is_array())
            {
                for (const auto& Ch : (*Active)["channels"])
                {
                    R.properties[Ch.value("property", std::string())] =
                        detail::EvaluateChannel(Ch, *Active, currentTimeMs);
                }
            }
            Results.push_back(std::move(R));
            continue;
        }

        // 有効な clip が無い ＝ fillMode の出番。最後に終了した clip を探す。
        const nlohmann::json* LastEnded = nullptr;
        float LastEnd = -1.0f;
        for (const auto& Clip : Track["clips"]) {
            const float E = Clip.value("endMs", 0.0f);
            if (E <= currentTimeMs && E > LastEnd) { LastEnd = E; LastEnded = &Clip; }
        }
        if (!LastEnded) continue;   // まだどの clip も始まっていない → 何もしない

        const std::string Fill = detail::EffectiveFillMode(*LastEnded);
        if (Fill == "none") continue;   // clip 外では値を変更しない
        if (!LastEnded->contains("channels") || !(*LastEnded)["channels"].is_array()) continue;

        for (const auto& Ch : (*LastEnded)["channels"]) {
            const std::string Prop = Ch.value("property", std::string());
            if (Fill == "reset") {
                R.properties[Prop] = Ch.value("defaultValue", 0.0f);   // 既定値へ戻す
            } else {
                // "hold": 最終 keyframe の値を保持
                float V = Ch.value("defaultValue", 0.0f);
                if (Ch.contains("keyframes") && Ch["keyframes"].is_array() && !Ch["keyframes"].empty()) {
                    const std::vector<int> Sorted = detail::SortedKeyframeIndices(Ch["keyframes"]);
                    V = Ch["keyframes"][Sorted.back()].value("value", V);
                }
                R.properties[Prop] = V;
            }
        }
        Results.push_back(std::move(R));
    }
    return Results;
}

} // namespace kaedevn
