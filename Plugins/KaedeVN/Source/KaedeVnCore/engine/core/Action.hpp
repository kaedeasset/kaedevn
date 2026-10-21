// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

// Action — 統一入力アクション(SDL / 入力デバイス非依存)。
//
// 入力ソース(SDL イベント / UE5 Enhanced Input / Switch HID)を問わず、ゲーム/UI
// ロジックはこの Action 集合だけを見る(dispatch(Action))。enum 自体は SDL を一切
// 引かないので、InputManager(SDL)・UiContext::handleAction・UE5 の入力マッピングが
// 同じ定義を共有できる。
//
// monorepo の packages/core/src/types/Action.ts と一致させること(media 跨ぎ parity)。
// 設計: docs/09_reports/2026/06/26/01-ue5-novel-play-screen-design.md (Phase 0 / follow-up D)

namespace kaedevn {

enum class Action {
    OK, Back, Menu, SkipToggle, AutoToggle, Log,
    QuickSave, QuickLoad, Screenshot, HideWindow,
    // UI Navigation (overlay 内のフォーカス移動)
    // Web: ArrowUp/Down/Left/Right、Switch: D-pad + 左スティック
    NavUp, NavDown, NavLeft, NavRight,
    // 文脈依存補助 (SaveLoad のスロット削除など)。Web: y/Delete、Switch: Y ボタン
    Aux,
    MapUp, MapDown, MapLeft, MapRight, Interact
};

constexpr int ACTION_COUNT = 20;

} // namespace kaedevn
