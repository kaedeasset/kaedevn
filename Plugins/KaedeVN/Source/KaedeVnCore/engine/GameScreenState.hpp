// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once
#include <string>
#include <vector>
#include <optional>
#include <unordered_map>

namespace kaedevn {

/**
 * GameScreenState — ゲーム画面の全状態
 * monorepo の packages/core/src/types/GameScreenState.ts と一致させる
 */

struct BgTransition {
    std::string fromId;
    std::string toId;
    std::string effect;  // "fade" / "slide_left" / "slide_right"
    float progress = 0.0f;
    float durationMs = 0.0f;
    float elapsedMs = 0.0f;
};

struct ScreenCharacterState {
    std::string name;
    std::string pose;
    std::string pos;  // "left" / "center" / "right"（離散スロット。表示位置の正は下の xNorm）
    float alpha = 1.0f;
    bool focused = false;

    // ===== 水平位置の連続値（CH_MOVE のトゥイーン用。2026-07-28 追加）=====
    // 0=left / 0.5=center / 1=right の正規化値。描画側はこれを見る。
    // chSet が pos から設定するので、CH_MOVE を使わない既存シナリオは従来と同じ位置になる
    // （0/0.5/1 は左端・中央・右端に厳密一致する）。
    float xNorm = 0.5f;       // 現在値
    float xNormFrom = 0.5f;   // トゥイーン開始値
    float xNormTo = 0.5f;     // トゥイーン目標値
    float moveRemainMs = 0.0f;
    float moveDurMs = 0.0f;
};

// pos 文字列を正規化Xへ。未知の値は center 扱い（不正な pos で画面外へ飛ばさない）。
inline float PosToXNorm(const std::string& pos) {
    if (pos == "left")  return 0.0f;
    if (pos == "right") return 1.0f;
    return 0.5f;
}

struct ScreenTextState {
    std::string content;
    std::string speaker;
    float displayedChars = 0.0f;
    float speed = 20.0f;  // 文字/秒
};

struct ScreenChoiceState {
    std::vector<std::string> labels;
    std::vector<int> jumps;
    int selected = -1;
};

struct GameScreenState {
    // 背景
    std::string bgId;
    std::optional<BgTransition> bgTransition;

    // キャラクター
    std::unordered_map<std::string, ScreenCharacterState> characters;

    // テキスト
    std::optional<ScreenTextState> text;

    // 選択肢
    std::optional<ScreenChoiceState> choices;

    // 窓の色・名前の色（TEXT_STYLE。空なら既定）
    std::string textBgColor;
    std::string nameColor;

    // オーディオ
    std::string bgmId;
    float bgmVol = 1.0f;

    // ユーザー操作モード
    bool skipMode = false;
    bool autoMode = false;

    // 待ち状態
    bool waitingForClick = false;
    bool waitingForPage = false;
    bool waitingForChoice = false;
    bool waitingForTimer = false;
    float waitTimerMs = 0.0f;
    float waitTargetMs = 0.0f;

    void reset() {
        bgId.clear();
        bgTransition.reset();
        characters.clear();
        text.reset();
        choices.reset();
        textBgColor.clear();
        nameColor.clear();
        bgmId.clear();
        bgmVol = 1.0f;
        skipMode = false;
        autoMode = false;
        waitingForClick = false;
        waitingForPage = false;
        waitingForChoice = false;
        waitingForTimer = false;
        waitTimerMs = 0.0f;
        waitTargetMs = 0.0f;
    }
};

} // namespace kaedevn
