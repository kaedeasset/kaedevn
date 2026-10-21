// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <functional>

namespace kaedevn {

/**
 * IOpHandler — monorepo の packages/core/src/engine/IOpHandler.ts の C++ 版
 *
 * ブロッキング操作はコールバック方式。
 * OpRunner は onComplete が呼ばれるまで PC を進めない。
 */
class IOpHandler {
public:
    using Callback = std::function<void()>;
    using IntCallback = std::function<void(int)>;
    // UI 画面の終了アクション（"close" / "jump:<label>" / 空）を返すコールバック。
    using StringCallback = std::function<void(const std::string&)>;

    virtual ~IOpHandler() = default;

    // ===== テキスト（同期） =====
    virtual void textAppend(const std::string& who, const std::string& text) = 0;
    virtual void textNl() = 0;
    // 本文のクリア（Tyrano [cm]/[er]）。PAGE と違いクリック待ちしない。
    // target: "all"（全メッセージレイヤ相当・既定）/ "current"（現在レイヤ相当）。
    // NOTE: 既定 no-op は「未対応バックエンドが黙って無視する」ためのもの。
    //   UE（FKaedeOpHandler）は必ず override すること。既定のまま放置すると
    //   ログにも出ず「落ちないが動かない」になる（SHAKE/FLASH で実際に起きた）。
    virtual void textClear(const std::string& target) {}
    // 窓の色・名前の色（"#rrggbb" か "#rrggbbaa"。"default" か空で既定に戻す）
    virtual void textStyle(const std::string& bgColor, const std::string& nameColor) {}

    // ===== 待機（非同期: コールバックで完了通知） =====
    virtual void waitClick(Callback onComplete) = 0;
    virtual void page(Callback onComplete) = 0;
    virtual void waitMs(int ms, Callback onComplete) = 0;

    // ===== 背景（同期: 状態変更のみ、アニメーションは update() で進行） =====
    virtual void bgSet(const std::string& id, int fadeMs,
                       const std::string& effect,
                       float x, float y, float s) = 0;
    virtual void bgClear(int fadeMs) = 0;

    // ===== キャラクター（同期） =====
    virtual void chSet(const std::string& name, const std::string& pose,
                       const std::string& pos, int fadeMs,
                       float x, float y, float s) = 0;
    virtual void chHide(const std::string& name, int fadeMs) = 0;
    // 立ち絵の水平移動（CH_MOVE）。durationMs かけて pos へ滑らかに動かす。
    // 同期扱い＝呼んだら即座に次の Op へ進み、移動は update() が裏で進める
    // （移動中も本文を送れる。VN の一般的な挙動）。
    // 既定 no-op なので、未対応ホストは従来どおり黙って無視する。
    virtual void chMove(const std::string& name, const std::string& pos,
                        int durationMs, float x, float y) {}
    // 表情差し替え（CH_EXPR）。表示中でないキャラは無視する。
    // 同じ表情への差し替えは no-op（無用な再フェードを起こさない）。
    virtual void chExpr(const std::string& name, const std::string& expression, int fadeMs) {}
    virtual void chClear(int fadeMs) = 0;

    // ===== スプライト（Tyrano [image] 相当。同期: 状態を積むだけ）=====
    // 名前付きレイヤ上の addressable 画像。id で move/hide を指定する。
    // layer は "back" / "front"（既定 front）。座標は論理px。
    // 移動・フェードの進行は update() が担当する＝呼んだ直後に次の Op へ進む。
    virtual void spriteSet(const std::string& id, const std::string& storage,
                           const std::string& layer, float x, float y,
                           float opacity, int fadeMs) {}
    // 省略された引数は「現在値を維持」。呼び出し側が has* で指示する。
    virtual void spriteMove(const std::string& id, bool hasX, float x, bool hasY, float y,
                            bool hasOpacity, float opacity, bool hasScale, float scale,
                            int durationMs) {}
    virtual void spriteHide(const std::string& id, int fadeMs) {}
    // layer 省略（空文字）は全レイヤ対象。
    virtual void spriteClear(const std::string& layer, int fadeMs) {}
    // テキストスプライト（Tyrano [ptext]/[mtext]）。スプライトと同一キー空間に載るので
    // spriteMove/Hide/Clear がそのまま効く。color は "#rrggbb" または色名（空=白）。
    virtual void textSpriteSet(const std::string& id, const std::string& text,
                               float x, float y, float size, const std::string& color,
                               bool bold, const std::string& layer, int fadeMs) {}

    // ===== レイヤ制御・トランジション（Tyrano [layopt]/[trans]/[wt]）=====
    // name は論理レイヤ（background / character / overlay）。
    virtual void layerSet(const std::string& name, bool hasVisible, bool visible,
                          bool hasOpacity, float opacity) {}
    // 非ブロッキング。alpha 0→1 のフェードを開始し、waitTransition で待つ。
    virtual void transition(const std::string& target, const std::string& type, int durationMs) {}
    // 進行中のトランジション完了を待つ（非同期）。無ければ即完了。
    virtual void waitTransition(const std::string& target, Callback onComplete) {
        if (onComplete) onComplete();
    }

    // ===== マスク（全画面カラー。MASK_CLEAR まで維持する）=====
    virtual void maskSet(const std::string& color, float opacity, int durationMs) {}
    virtual void maskClear(int durationMs) {}

    // ===== 宣言的UI画面（UI_SHOW / UI_HIDE）=====
    // screenId は Game/ui/<screenId>.json（MomijiUI の screen JSON）。
    // wait=true のときだけ onAction が「画面を閉じたときのアクション」で呼ばれる
    // （"close" / "jump:<label>" / 空）。wait=false は開いた直後に空で呼ぶ。
    // 既定は即時完了。未対応バックエンドがシナリオを止めないため。
    virtual void uiShow(const std::string& screenId, bool wait, StringCallback onAction) {
        if (onAction) onAction(std::string());
    }
    virtual void uiHide() {}

    // ===== カメラ（CAMERA_SET。2D シーンのパン/ズーム）=====
    // x/y は論理px のパン量、zoom は倍率（1=等倍）。time>0 で補間、reset=true で初期化。
    // 掛かるのは「シーン」（背景・立ち絵・スプライト・一枚絵）だけで、
    // 本文枠やオーバーレイUIには掛からない。
    virtual void cameraSet(bool hasX, float x, bool hasY, float y,
                           bool hasZoom, float zoom, int durationMs, bool reset) {}

    // ===== タイムライン（TIMELINE_PLAY。Tyrano [kanim]）=====
    // **非同期＝durationMs 経過まで次の Op へ進まない**（TS の TimelineDelegate が
    // Promise を返して待つのと同じ）。タイムライン本体は外部注入（SetTimelines）。
    // 既定は即時完了。未対応バックエンドがシナリオを止めないため。
    virtual void timelinePlay(const std::string& timelineId, Callback onComplete) {
        if (onComplete) onComplete();
    }

    // ===== 音声（同期） =====
    virtual void bgmPlay(const std::string& id, float vol, int fadeMs) = 0;
    virtual void bgmStop(int fadeMs) = 0;
    virtual void sePlay(const std::string& id, float vol) = 0;
    virtual void seStop() {}
    virtual void waitCamera(Callback onComplete) { if (onComplete) onComplete(); }
    virtual void voicePlay(const std::string& id) = 0;

    // ===== 選択肢（非同期） =====
    virtual void showChoices(const std::vector<std::string>& labels,
                             IntCallback onComplete) = 0;

    // ===== エフェクト（デフォルト実装: 即時完了 or no-op） =====
    virtual void shake(float intensity, int durationMs, Callback onComplete) {
        if (onComplete) onComplete();
    }
    virtual void flash(int durationMs, Callback onComplete) {
        if (onComplete) onComplete();
    }
    virtual void fadeBlack(int durationMs, Callback onComplete) {
        if (onComplete) onComplete();
    }
    virtual void fadeWhite(int durationMs, Callback onComplete) {
        if (onComplete) onComplete();
    }
    virtual void blackIn(int durationMs, Callback onComplete) {
        if (onComplete) onComplete();
    }
    virtual void whiteIn(int durationMs, Callback onComplete) {
        if (onComplete) onComplete();
    }

    // params には Web ScreenFilter.apply の options dict 相当を入れる。
    // 例: filter="morning" の場合 params={"haze":0.3, "warmth":0.5, "softness":0.4}。
    // IRenderer 側で uniform 名は "u" + capitalized first letter にマップされる。
    using FilterParams = std::unordered_map<std::string, float>;
    virtual void screenFilter(const std::string& filter, float intensity,
                              const FilterParams& params = {}) {}
    virtual void screenFilterClear() {}
    virtual void overlaySet(const std::string& id, int fadeMs, float x, float y, float s) {}
    virtual void overlayHide(const std::string& id, int fadeMs) {}

    // ===== シーンモード（"2d" / "vrm"）=====
    // Web 側はコンパイル時 mode 衝突チェックに使う。Native は no-op で OK だが
    // バックエンド側で render path を切り替えるフックとして virtual 化しておく。
    virtual void sceneMode(const std::string& mode) {}

    // ===== VRM (Phase 1: 単一キャラ、Web と同じ API シェイプ) =====
    // VRM 非対応プラットフォーム (Switch、stub backend) では VrmRendererStub が
    // 静かに no-op するので、ハンドラ呼び出し自体は安全に空振りできる。
    virtual void vrmShow(const std::string& id, const std::string& pos, int fadeMs,
                         float x, float y, float s, float rotY) {}
    virtual void vrmHide(int fadeMs) {}
    virtual void vrmExpression(const std::string& name, float weight, int durationMs) {}
    virtual void vrmPose(const std::string& preset) {}

    // ===== update/render (毎フレーム main loop から呼ばれる) =====
    virtual void update(float deltaMs) = 0;
    virtual void render() = 0;

    // ===== ユーザー入力ハンドリング =====
    virtual void handleClick() = 0;

    // ===== デバッグ・トレース =====
    // OpRunner が次の op を実行する直前に呼ばれる。デフォルト no-op。
    // SDL2Engine 側でオンスクリーンデバッグログに流す。
    virtual void onOpEnter(int pc, const std::string& opName) {}
    // OpRunner も DispatchDisplayOp も処理しない Op を読み飛ばすときに呼ばれる。デフォルト no-op。
    // UE の FKaedeOpHandler はログの警告に出す（黙って何も起きない、を残さない）。
    virtual void onUnhandledOp(int pc, const std::string& opName) {}

    virtual void handleBack() {}
    virtual void toggleSkip() {}
    virtual void toggleHistory() {}
    virtual void selectChoice(int index) {}
};

} // namespace kaedevn
