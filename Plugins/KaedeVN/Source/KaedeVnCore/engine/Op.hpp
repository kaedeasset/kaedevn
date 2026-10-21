// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <nlohmann/json.hpp>

namespace kaedevn {

/**
 * OpType — Tools/kaedevn-compiler/packages/core/src/types/Op.ts と一致させる
 */
enum class OpType {
    // テキスト
    TEXT_APPEND, TEXT_NL,
    // メッセージのクリア（改ページと違いクリック待ちしない。Tyrano [cm]/[er]）
    TEXT_CLEAR,
    TEXT_STYLE,   // 窓の色・名前の色（2026-10-11。"default" で既定に戻す）
    // 待機
    WAIT_CLICK, PAGE, WAIT_MS,
    // 背景
    BG_SET, BG_CLEAR,
    // キャラ
    CH_SET, CH_HIDE, CH_CLEAR, CH_MOVE, CH_ANIM,
    // 表情差し替え
    CH_EXPR,
    // スプライト（名前付きレイヤ上の addressable 画像。Tyrano [image]）
    SPRITE_SET, SPRITE_MOVE, SPRITE_HIDE, SPRITE_CLEAR,
    // テキストスプライト（メッセージ枠外の固定座標テキスト。Tyrano [ptext]/[mtext]）
    // スプライトと同一キー空間なので SPRITE_MOVE/HIDE/CLEAR がそのまま効く。
    TEXT_SPRITE_SET,
    // レイヤ制御・トランジション（Tyrano [layopt]/[trans]/[wt]）
    LAYER_SET, TRANSITION, WAIT_TRANSITION,
    // マスク（全画面カラー。FADE_BLACK と違い MASK_CLEAR まで維持。Tyrano [mask]）
    MASK_SET, MASK_CLEAR,
    // 宣言的UI画面（MomijiUI の screen JSON）。wait=true は action まで待つ
    UI_SHOW, UI_HIDE,
    // Live2D
    LIVE2D_SET, LIVE2D_HIDE, LIVE2D_MOTION, LIVE2D_EXPRESSION,
    // VRM (3D ヒト型、Phase 1 仕様で単一キャラ)
    SCENE_MODE,
    VRM_SHOW, VRM_HIDE, VRM_EXPRESSION, VRM_POSE,
    // パーティクル
    PARTICLE_EMIT, PARTICLE_STOP,
    // 色調補正
    COLOR_ADJUST,
    // 音声
    BGM_PLAY, BGM_STOP, SE_PLAY, SE_STOP, VOICE_PLAY, WAIT_VOICE_END,
    // 変数
    VAR_SET, VAR_ADD, VAR_SUB,
    // 選択肢
    CHOICE,
    // ジャンプ・分岐
    JUMP, JUMP_IF,
    // サブルーチン (Web OpRunner と同等)
    CALL, RETURN,
    // バトル
    BATTLE_START,
    // マップ・移動
    MAP_LOAD, MAP_EXIT, PLAYER_MOVE, EVENT_MOVE,
    // アイテム
    ITEM_ADD, ITEM_REMOVE,
    // UI レイアウト
    LAYOUT_SET,
    // テンプレート
    CALL_TEMPLATE,
    // スクロールテキスト
    SCROLL_TEXT,
    // タイムライン
    TIMELINE_PLAY,
    // フィルター
    SCREEN_FILTER, SCREEN_FILTER_CLEAR, FILTER_MIX,
    // シェイク
    SHAKE,
    // オーバーレイ
    OVERLAY_SET, OVERLAY_HIDE,
    // カメラ
    CAMERA_SET, WAIT_CAMERA,
    // 画面エフェクト
    FLASH, FADE_BLACK, FADE_WHITE, BLACK_IN, WHITE_IN,
    // 未知
    UNKNOWN
};

/**
 * 文字列 → OpType 変換
 */
inline OpType opTypeFromString(const std::string& s) {
    static const std::unordered_map<std::string, OpType> table = {
        {"TEXT_APPEND", OpType::TEXT_APPEND}, {"TEXT_NL", OpType::TEXT_NL},
        {"TEXT_CLEAR", OpType::TEXT_CLEAR},
        {"TEXT_STYLE", OpType::TEXT_STYLE},
        {"WAIT_CLICK", OpType::WAIT_CLICK}, {"PAGE", OpType::PAGE}, {"WAIT_MS", OpType::WAIT_MS},
        {"BG_SET", OpType::BG_SET}, {"BG_CLEAR", OpType::BG_CLEAR},
        {"CH_SET", OpType::CH_SET}, {"CH_HIDE", OpType::CH_HIDE}, {"CH_CLEAR", OpType::CH_CLEAR},
        {"CH_MOVE", OpType::CH_MOVE}, {"CH_ANIM", OpType::CH_ANIM}, {"CH_EXPR", OpType::CH_EXPR},
        {"SPRITE_SET", OpType::SPRITE_SET}, {"SPRITE_MOVE", OpType::SPRITE_MOVE},
        {"SPRITE_HIDE", OpType::SPRITE_HIDE}, {"SPRITE_CLEAR", OpType::SPRITE_CLEAR},
        {"TEXT_SPRITE_SET", OpType::TEXT_SPRITE_SET},
        {"LAYER_SET", OpType::LAYER_SET}, {"TRANSITION", OpType::TRANSITION},
        {"WAIT_TRANSITION", OpType::WAIT_TRANSITION},
        {"MASK_SET", OpType::MASK_SET}, {"MASK_CLEAR", OpType::MASK_CLEAR},
        {"UI_SHOW", OpType::UI_SHOW}, {"UI_HIDE", OpType::UI_HIDE},
        {"LIVE2D_SET", OpType::LIVE2D_SET}, {"LIVE2D_HIDE", OpType::LIVE2D_HIDE},
        {"LIVE2D_MOTION", OpType::LIVE2D_MOTION}, {"LIVE2D_EXPRESSION", OpType::LIVE2D_EXPRESSION},
        {"SCENE_MODE", OpType::SCENE_MODE},
        {"VRM_SHOW", OpType::VRM_SHOW}, {"VRM_HIDE", OpType::VRM_HIDE},
        {"VRM_EXPRESSION", OpType::VRM_EXPRESSION}, {"VRM_POSE", OpType::VRM_POSE},
        {"PARTICLE_EMIT", OpType::PARTICLE_EMIT}, {"PARTICLE_STOP", OpType::PARTICLE_STOP},
        {"COLOR_ADJUST", OpType::COLOR_ADJUST},
        {"BGM_PLAY", OpType::BGM_PLAY}, {"BGM_STOP", OpType::BGM_STOP},
        {"SE_PLAY", OpType::SE_PLAY}, {"VOICE_PLAY", OpType::VOICE_PLAY},
        {"SE_STOP", OpType::SE_STOP}, {"WAIT_CAMERA", OpType::WAIT_CAMERA},
        {"WAIT_VOICE_END", OpType::WAIT_VOICE_END},
        {"VAR_SET", OpType::VAR_SET}, {"VAR_ADD", OpType::VAR_ADD}, {"VAR_SUB", OpType::VAR_SUB},
        {"CHOICE", OpType::CHOICE},
        {"JUMP", OpType::JUMP}, {"JUMP_IF", OpType::JUMP_IF},
        {"CALL", OpType::CALL}, {"RETURN", OpType::RETURN},
        {"BATTLE_START", OpType::BATTLE_START},
        {"MAP_LOAD", OpType::MAP_LOAD}, {"MAP_EXIT", OpType::MAP_EXIT},
        {"PLAYER_MOVE", OpType::PLAYER_MOVE}, {"EVENT_MOVE", OpType::EVENT_MOVE},
        {"ITEM_ADD", OpType::ITEM_ADD}, {"ITEM_REMOVE", OpType::ITEM_REMOVE},
        {"LAYOUT_SET", OpType::LAYOUT_SET},
        {"CALL_TEMPLATE", OpType::CALL_TEMPLATE},
        {"SCROLL_TEXT", OpType::SCROLL_TEXT},
        {"TIMELINE_PLAY", OpType::TIMELINE_PLAY},
        {"SCREEN_FILTER", OpType::SCREEN_FILTER}, {"SCREEN_FILTER_CLEAR", OpType::SCREEN_FILTER_CLEAR},
        {"FILTER_MIX", OpType::FILTER_MIX},
        {"SHAKE", OpType::SHAKE},
        {"OVERLAY_SET", OpType::OVERLAY_SET}, {"OVERLAY_HIDE", OpType::OVERLAY_HIDE},
        {"CAMERA_SET", OpType::CAMERA_SET},
        {"FLASH", OpType::FLASH}, {"FADE_BLACK", OpType::FADE_BLACK},
        {"FADE_WHITE", OpType::FADE_WHITE}, {"BLACK_IN", OpType::BLACK_IN},
        {"WHITE_IN", OpType::WHITE_IN},
    };
    auto it = table.find(s);
    return (it != table.end()) ? it->second : OpType::UNKNOWN;
}

/**
 * Op — 1 命令。type + JSON パラメータ
 */
struct Op {
    OpType type;
    nlohmann::json data;
};

/**
 * CompiledScenario — コンパイル済みシナリオ (Op.ts の CompiledScenario と対応)
 */
struct CompiledScenario {
    std::string id;
    std::string title;  // Web 側 preview API の title と同じ（プロジェクト名）
    std::vector<Op> ops;
    std::unordered_map<std::string, int> labels;
};

/**
 * JSON からシナリオを読み込む
 */
inline CompiledScenario loadScenario(const nlohmann::json& j) {
    CompiledScenario scenario;
    scenario.id = j.value("id", "");
    scenario.title = j.value("title", "");

    if (j.contains("ops") && j["ops"].is_array()) {
        for (const auto& opJson : j["ops"]) {
            Op op;
            std::string opStr = opJson.value("op", "");
            op.type = opTypeFromString(opStr);
            op.data = opJson;
            scenario.ops.push_back(std::move(op));
        }
    }

    if (j.contains("labels") && j["labels"].is_object()) {
        for (auto& [key, val] : j["labels"].items()) {
            scenario.labels[key] = val.get<int>();
        }
    }

    return scenario;
}

} // namespace kaedevn
