// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once
#include "GameScreenState.hpp"
#include <algorithm>

namespace kaedevn {

/**
 * GameScreenUpdater — 毎フレームの状態更新ロジック
 * monorepo の packages/core/src/engine/GameScreenUpdater.ts と同等
 */
inline void updateGameScreen(GameScreenState& state, float deltaMs) {
    // BG 遷移の進行
    if (state.bgTransition.has_value()) {
        auto& t = state.bgTransition.value();
        t.elapsedMs += deltaMs;
        t.progress = std::min(t.elapsedMs / t.durationMs, 1.0f);
        if (t.progress >= 1.0f) {
            state.bgId = t.toId;
            state.bgTransition.reset();
        }
    }

    // テキスト文字送り
    if (state.text.has_value()) {
        auto& txt = state.text.value();
        if (txt.displayedChars < static_cast<float>(txt.content.size())) {
            float charsToAdd = txt.speed * (deltaMs / 1000.0f);
            txt.displayedChars = std::min(
                txt.displayedChars + charsToAdd,
                static_cast<float>(txt.content.size())
            );
        }
    }

    // タイマー待ち（進行のみ。完了判定は Handler 側）
    if (state.waitingForTimer) {
        state.waitTimerMs += deltaMs;
    }
}

} // namespace kaedevn
