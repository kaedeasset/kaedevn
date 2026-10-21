// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once
#include "Op.hpp"
#include "IOpHandler.hpp"

namespace kaedevn {

/**
 * DispatchDisplayOp — monorepo の packages/core/src/engine/dispatchDisplayOp.ts の C++ 版。
 *
 * pc 制御を持たない Op（表示・音声・演出・待機系）を IOpHandler へ dispatch する。
 * TS 版が OpRunner(KS 実行) と KscHostAdapter.execOp(KSC の @ 行) で共有するのと
 * 同じ目的で、UE でも OpRunner（JSON シナリオの再生）と KSC の execOp 経路
 * (FKaedeKscHost) の両方がこの関数を使う。表示系の Op を足すのはここだけ。
 *
 * 完了通知の扱い（TS の Promise を C++ のコールバックにマップ）:
 *   - 同期 Op（BG_SET / CH_SET / BGM_PLAY 等）は handler を呼んだ直後に
 *     onComplete() を同期呼び出しして返る。
 *   - 非同期 Op（WAIT_CLICK / PAGE / WAIT_MS / SHAKE / FLASH / FADE_* / *_IN）は
 *     onComplete を handler の完了コールバックとして渡す（後で発火しうる）。
 * どちらの経路でも「onComplete が呼ばれた＝この Op は完了」で統一されるので、
 * 呼び出し側は sync/async を区別せず pending 完了だけを待てばよい。
 *
 * 対象外（呼び出し側の責務。onComplete は呼ばれない）:
 *   - TEXT_APPEND（read フラグが pc 依存）
 *   - VAR_SET/ADD/SUB（vars は runner が所有）
 *   - CHOICE / JUMP / JUMP_IF / CALL / RETURN / BATTLE_START（pc 制御・int 返り）
 *   - UNKNOWN
 *
 * TS 版が optional handler メソッド（h.chMove? 等）で no-op する Op は、UE の
 * IOpHandler に該当メソッドが無くても「認識済み・no-op」として true を返し、
 * onComplete を呼ぶ（execOp に不要な警告を出さないため）。
 *
 * @return この Op を処理した（表示系 Op だった）場合 true。対象外は false。
 *
 * NOTE(実装): engine/ の他ヘッダ（Op.hpp の opTypeFromString/loadScenario 等）と
 *   同じく header-only inline。KaedeVnCore/KaedeKsc の両モジュールから DLL 境界を
 *   跨がず（KAEDEVNCORE_API export 不要で）使えるようにするため。
 */
inline bool DispatchDisplayOp(const Op& op, IOpHandler& h,
                              const IOpHandler::Callback& onComplete) {
    const auto& d = op.data;
    // 同期 Op 完了ヘルパ: handler 呼び出し後に onComplete を即発火する。
    auto done = [&]() { if (onComplete) onComplete(); };

    switch (op.type) {
        // ===== テキスト（同期）=====
        case OpType::TEXT_NL:
            h.textNl();
            done();
            return true;

        case OpType::TEXT_CLEAR:
            h.textClear(d.value("target", "all"));
            done();
            return true;

        case OpType::TEXT_STYLE:
            h.textStyle(d.value("bgColor", ""), d.value("nameColor", ""));
            done();
            return true;

        // ===== 待機（非同期: onComplete を完了 cb として渡す）=====
        case OpType::WAIT_CLICK:
            h.waitClick(onComplete);
            return true;

        case OpType::PAGE:
            h.page(onComplete);
            return true;

        case OpType::WAIT_MS:
            h.waitMs(d.value("ms", 0), onComplete);
            return true;

        // ===== 背景（同期）=====
        case OpType::BG_SET:
            h.bgSet(
                d.value("id", ""),
                d.value("fadeMs", 0),
                d.value("effect", "fade"),
                d.value("x", 0.0f),
                d.value("y", 0.0f),
                d.value("s", 1.0f));
            done();
            return true;

        case OpType::BG_CLEAR:
            h.bgClear(d.value("fadeMs", 0));
            done();
            return true;

        // ===== キャラクター（同期）=====
        case OpType::CH_SET:
            h.chSet(
                d.value("name", ""),
                d.value("pose", ""),
                d.value("pos", "center"),
                d.value("fadeMs", 0),
                d.value("x", 0.0f),
                d.value("y", 0.0f),
                d.value("s", 1.0f));
            done();
            return true;

        case OpType::CH_MOVE:
            // 同期: 移動の進行は update() が担当するので、ここでは即 done()。
            // ＝移動中も本文を送れる（VN の一般的な挙動）。
            h.chMove(
                d.value("name", ""),
                d.value("pos", ""),
                d.value("durationMs", 300),
                d.value("x", 0.0f),
                d.value("y", 0.0f));
            done();
            return true;

        case OpType::CH_HIDE:
            h.chHide(d.value("name", ""), d.value("fadeMs", 0));
            done();
            return true;

        case OpType::CH_EXPR:
            h.chExpr(d.value("name", ""), d.value("expression", ""), d.value("fadeMs", 0));
            done();
            return true;

        case OpType::CH_CLEAR:
            h.chClear(d.value("fadeMs", 0));
            done();
            return true;

        // ===== スプライト（同期: 進行は update() が担当）=====
        case OpType::SPRITE_SET:
            h.spriteSet(
                d.value("id", ""), d.value("storage", ""), d.value("layer", "front"),
                d.value("x", 0.0f), d.value("y", 0.0f),
                d.value("opacity", 1.0f), d.value("fadeMs", 0));
            done();
            return true;

        case OpType::SPRITE_MOVE:
            // 省略された引数は現在値を維持する（TS の `x ?? sprite.position.x` と同じ）。
            h.spriteMove(
                d.value("id", ""),
                d.contains("x"), d.value("x", 0.0f),
                d.contains("y"), d.value("y", 0.0f),
                d.contains("opacity"), d.value("opacity", 1.0f),
                d.contains("scale"), d.value("scale", 1.0f),
                d.value("durationMs", 0));
            done();
            return true;

        case OpType::SPRITE_HIDE:
            h.spriteHide(d.value("id", ""), d.value("fadeMs", 0));
            done();
            return true;

        case OpType::SPRITE_CLEAR:
            // layer 省略は全レイヤ対象（TS の `layer?: string` が undefined のとき）。
            h.spriteClear(d.value("layer", ""), d.value("fadeMs", 0));
            done();
            return true;

        case OpType::TEXT_SPRITE_SET:
            h.textSpriteSet(
                d.value("id", ""), d.value("text", ""),
                d.value("x", 0.0f), d.value("y", 0.0f),
                d.value("size", 24.0f), d.value("color", ""),
                d.value("bold", false), d.value("layer", "front"),
                d.value("fadeMs", 0));
            done();
            return true;

        // ===== レイヤ制御・トランジション =====
        case OpType::LAYER_SET:
            h.layerSet(
                d.value("name", ""),
                d.contains("visible"), d.value("visible", true),
                d.contains("opacity"), d.value("opacity", 1.0f));
            done();
            return true;

        case OpType::TRANSITION:
            // 非ブロッキング: 開始だけして次の Op へ進む（完了は WAIT_TRANSITION で待つ）。
            h.transition(d.value("target", "overlay"), d.value("type", "fade"),
                         d.value("durationMs", 0));
            done();
            return true;

        case OpType::WAIT_TRANSITION:
            // 非同期: onComplete を完了 cb として渡す。
            h.waitTransition(d.value("target", ""), onComplete);
            return true;

        // ===== マスク（同期: 状態を積むだけ。フェードは update で進む）=====
        case OpType::MASK_SET:
            h.maskSet(d.value("color", "#000000"), d.value("opacity", 1.0f),
                      d.value("durationMs", 0));
            done();
            return true;

        case OpType::MASK_CLEAR:
            h.maskClear(d.value("durationMs", 0));
            done();
            return true;

        // ===== タイムライン（非同期: durationMs 経過まで待つ）=====
        case OpType::TIMELINE_PLAY:
            h.timelinePlay(d.value("timelineId", ""), onComplete);
            return true;

        // ===== 宣言的UI画面 =====
        // KSC の execOp 経路は pc を持たないので、jump アクションは解決できない。
        // TS 版と同じく警告相当（ここでは無視）とし、close 扱いで先へ進める。
        case OpType::UI_SHOW:
        {
            const bool bWait = d.value("wait", false);
            IOpHandler::StringCallback OnAction =
                [onComplete](const std::string&) { if (onComplete) onComplete(); };
            h.uiShow(d.value("screenId", ""), bWait, std::move(OnAction));
            if (!bWait) done();
            return true;
        }

        case OpType::UI_HIDE:
            h.uiHide();
            done();
            return true;

        // ===== カメラ（同期: 補間は update が進める）=====
        case OpType::CAMERA_SET:
            h.cameraSet(
                d.contains("x"), d.value("x", 0.0f),
                d.contains("y"), d.value("y", 0.0f),
                d.contains("zoom"), d.value("zoom", 1.0f),
                d.value("time", 0), d.value("reset", false));
            done();
            return true;

        // ===== 音声（同期）=====
        case OpType::WAIT_CAMERA:
            h.waitCamera(onComplete);
            return true;

        case OpType::SE_STOP:
            h.seStop();
            done();
            return true;

        case OpType::BGM_PLAY:
            h.bgmPlay(d.value("id", ""), d.value("vol", 1.0f), d.value("fadeMs", 0));
            done();
            return true;

        case OpType::BGM_STOP:
            h.bgmStop(d.value("fadeMs", 0));
            done();
            return true;

        case OpType::SE_PLAY:
            h.sePlay(d.value("id", ""), d.value("vol", 1.0f));
            done();
            return true;

        case OpType::VOICE_PLAY:
            h.voicePlay(d.value("id", ""));
            done();
            return true;

        // ===== フィルター（同期）=====
        case OpType::SCREEN_FILTER: {
            IOpHandler::FilterParams params;
            if (d.contains("options") && d["options"].is_object()) {
                for (auto it = d["options"].begin(); it != d["options"].end(); ++it) {
                    if (it.value().is_number()) {
                        params.emplace(it.key(), it.value().get<float>());
                    }
                }
            }
            h.screenFilter(d.value("filter", ""), d.value("intensity", 1.0f), params);
            done();
            return true;
        }

        case OpType::SCREEN_FILTER_CLEAR:
            h.screenFilterClear();
            done();
            return true;

        // ===== オーバーレイ（同期）=====
        case OpType::OVERLAY_SET:
            h.overlaySet(
                d.value("id", ""), d.value("fadeMs", 0),
                d.value("x", 0.0f), d.value("y", 0.0f), d.value("s", 1.0f));
            done();
            return true;

        case OpType::OVERLAY_HIDE:
            h.overlayHide(d.value("id", ""), d.value("fadeMs", 0));
            done();
            return true;

        // ===== シーンモード（同期）=====
        case OpType::SCENE_MODE:
            h.sceneMode(d.value("mode", "2d"));
            done();
            return true;

        // ===== VRM（同期）=====
        case OpType::VRM_SHOW:
            h.vrmShow(
                d.value("id", ""),
                d.value("pos", "center"),
                d.value("fadeMs", 0),
                d.value("x", 0.0f), d.value("y", 0.0f),
                d.value("s", 1.0f),
                d.value("rotY", 0.0f));
            done();
            return true;

        case OpType::VRM_HIDE:
            h.vrmHide(d.value("fadeMs", 0));
            done();
            return true;

        case OpType::VRM_EXPRESSION:
            h.vrmExpression(d.value("name", ""), d.value("weight", 1.0f), d.value("durationMs", 0));
            done();
            return true;

        case OpType::VRM_POSE:
            h.vrmPose(d.value("preset", "idle"));
            done();
            return true;

        // ===== 画面エフェクト（非同期: onComplete を完了 cb として渡す）=====
        case OpType::SHAKE:
            h.shake(d.value("intensity", 5.0f), d.value("durationMs", 300), onComplete);
            return true;

        case OpType::FLASH:
            h.flash(d.value("durationMs", 200), onComplete);
            return true;

        case OpType::FADE_BLACK:
            h.fadeBlack(d.value("durationMs", 500), onComplete);
            return true;

        case OpType::FADE_WHITE:
            h.fadeWhite(d.value("durationMs", 500), onComplete);
            return true;

        case OpType::BLACK_IN:
            h.blackIn(d.value("durationMs", 500), onComplete);
            return true;

        case OpType::WHITE_IN:
            h.whiteIn(d.value("durationMs", 500), onComplete);
            return true;

        // ===== 認識済みだが UE IOpHandler に対応メソッドが無い Op =====
        // TS 版が optional handler で no-op する Op 群。silent no-op として
        // true を返し onComplete を発火する（execOp で不要な警告を出さない）。
        case OpType::CH_ANIM:
        case OpType::LIVE2D_SET:
        case OpType::LIVE2D_HIDE:
        case OpType::LIVE2D_MOTION:
        case OpType::LIVE2D_EXPRESSION:
        case OpType::PARTICLE_EMIT:
        case OpType::PARTICLE_STOP:
        case OpType::COLOR_ADJUST:
        case OpType::WAIT_VOICE_END:
        case OpType::SCROLL_TEXT:
        case OpType::CALL_TEMPLATE:
        case OpType::MAP_LOAD:
        case OpType::MAP_EXIT:
        case OpType::PLAYER_MOVE:
        case OpType::EVENT_MOVE:
        case OpType::ITEM_ADD:
        case OpType::ITEM_REMOVE:
        case OpType::LAYOUT_SET:
            done();
            return true;

        // ===== 対象外（呼び出し側の責務。onComplete は呼ばない）=====
        // TEXT_APPEND / VAR_* / CHOICE / JUMP / JUMP_IF / CALL / RETURN /
        // BATTLE_START / UNKNOWN
        default:
            return false;
    }
}

} // namespace kaedevn
