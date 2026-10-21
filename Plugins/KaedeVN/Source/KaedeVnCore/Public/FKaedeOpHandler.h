// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

#include "CoreMinimal.h"          // KAEDEVNCORE_API / DLLEXPORT 定義のため
#include "IOpHandler.hpp"          // kaedevn::IOpHandler
#include "GameScreenState.hpp"     // kaedevn::GameScreenState
#include "TimelineEvaluator.hpp"   // kaedevn::EvaluateTimeline / TimelineTrackResult
#include "KaedeVnLayout.h"         // KaedeVn::KaedeDefaultTextSpeed

#include <string>
#include <vector>

// バックログ1行（話者 + 本文）。WAIT_CLICK/PAGE で本文が確定するたびに積む。
struct FKaedeHistoryLine
{
	std::string speaker;
	std::string text;
};

// 残り時間で進む補間の時計。立ち絵の移動・スプライト・一枚絵・カメラ・マスク・レイヤのフェードが共有する。
// 値は毎回「残り時間の割合」から出す（差分を足していくと丸め誤差が溜まって目標に届かない）。
// From/To は持ち主が持つ（カメラのように 1 本の時計で x・y・倍率を並走させるため）。
struct KAEDEVNCORE_API FKaedeTween
{
	float RemainMs = 0.0f;
	float DurMs = 0.0f;

	// Ms かけて進め始める。0 以下は「時間なし」で、Active() が false のまま（持ち主が目標値を即座に入れる）。
	void Start(float Ms) { DurMs = RemainMs = (Ms > 0.0f) ? Ms : 0.0f; }
	bool Active() const { return RemainMs > 0.0f && DurMs > 0.0f; }
	// DeltaMs 進め、進み具合 0..1 を返す（動いていなければ 1）。bEase なら両端を緩めた smoothstep。
	float Advance(float DeltaMs, bool bEase = false) { return Step(RemainMs, DurMs, DeltaMs, bEase); }
	// 同じことを別の構造体の 2 つの数でする（立ち絵の移動は engine の ScreenCharacterState が持つ）。
	// 尽きたら DurMs を 0 にする。
	static float Step(float& RemainMs, float& DurMs, float DeltaMs, bool bEase = false);
	// From→To の T の位置。T が 1 なら端数を残さず To を返す（目標へ吸着）。
	static float Lerp(float From, float To, float T) { return (T >= 1.0f) ? To : From + (To - From) * T; }
};

// 画面オーバーレイ1枚（OVERLAY_SET/OVERLAY_HIDE）。一枚絵CGや部分カットの重ね表示。
// 複数枚を同時に出せるので id で管理する。背景・立ち絵より上、本文枠より下に描く。
struct FKaedeOverlayItem
{
	std::string id;                // アセットid（assets.json で解決）
	float x = 0.0f;                // 論理px のオフセット（0=フィット位置のまま）
	float y = 0.0f;
	float scale = 1.0f;            // 1.0=画面高さいっぱい（背景と同じ「高さ基準フィット」）
	float alpha = 0.0f;            // 現在の不透明度
	float targetAlpha = 1.0f;      // 1=表示へ / 0=消えたら破棄
	FKaedeTween Fade;              // alpha のフェード（動いていない＝即時）
};

// スプライト1枚（SPRITE_SET/MOVE/HIDE/CLEAR）。Tyrano [image] 相当。
// FKaedeOverlayItem との違い: id で個別に move できる／座標が論理px の絶対指定／
// layer で描画順を back/front に分けられる。実作品での出現は最多（585回）。
// GameScreenState に置かないのは overlayItems_ と同じ理由 — TS 側の
// GameScreenState.ts にスプライトが無く、状態の対応関係を崩さないため。
struct FKaedeSpriteItem
{
	std::string id;                // シナリオ上の識別子（move/hide の対象指定に使う）
	std::string storage;           // アセットid（assets.json で解決）。テキストなら空
	int   order = 1;               // 描画順。0=back / 1=front（既定）

	// テキストスプライト（TEXT_SPRITE_SET。Tyrano [ptext]/[mtext]）。
	// 画像と同一キー空間に置くので SPRITE_MOVE/HIDE/CLEAR がそのまま効く。
	bool  bIsText = false;
	std::string text;
	float fontSize = 24.0f;        // 論理px
	std::string color;             // "#rrggbb" または色名。空=白
	bool  bBold = false;

	float x = 0.0f;                // 論理px（左上原点）
	float y = 0.0f;
	float scale = 1.0f;
	float alpha = 0.0f;            // 現在の不透明度
	float targetAlpha = 1.0f;      // 0 になって消えきったら破棄
	FKaedeTween Fade;

	// SPRITE_MOVE のトゥイーン（座標・スケールを同一時間で並走補間）。
	float xFrom = 0.0f, xTo = 0.0f;
	float yFrom = 0.0f, yTo = 0.0f;
	float scaleFrom = 1.0f, scaleTo = 1.0f;
	FKaedeTween Move;
};

// FKaedeOpHandler — IOpHandler の UE 実装。Op を GameScreenState の更新に翻訳する。
// native SDL2Engine のハンドラ・ロジックを SDL/history/ECS 抜きで移植した A2 版。
// 描画はしない（state を KaedeVnUI の widget が読んで Slate 描画する）。
class KAEDEVNCORE_API FKaedeOpHandler : public kaedevn::IOpHandler
{
public:
	// ===== テキスト（同期） =====
	virtual void textAppend(const std::string& who, const std::string& text) override;
	virtual void textNl() override;
	virtual void textClear(const std::string& target) override;
	virtual void textStyle(const std::string& bgColor, const std::string& nameColor) override;

	// ===== 待機（非同期: callback で完了通知） =====
	virtual void waitClick(Callback onComplete) override;
	virtual void page(Callback onComplete) override;
	virtual void waitMs(int ms, Callback onComplete) override;

	// ===== 背景 / キャラ（A2 は state へ最小反映） =====
	virtual void bgSet(const std::string& id, int fadeMs, const std::string& effect,
	                   float x, float y, float s) override;
	virtual void bgClear(int fadeMs) override;
	virtual void chSet(const std::string& name, const std::string& pose,
	                   const std::string& pos, int fadeMs, float x, float y, float s) override;
	virtual void chHide(const std::string& name, int fadeMs) override;
	virtual void chMove(const std::string& name, const std::string& pos,
	                    int durationMs, float x, float y) override;
	virtual void chExpr(const std::string& name, const std::string& expression, int fadeMs) override;
	virtual void chClear(int fadeMs) override;

	// ===== スプライト（SPRITE_SET/MOVE/HIDE/CLEAR）=====
	virtual void spriteSet(const std::string& id, const std::string& storage,
	                       const std::string& layer, float x, float y,
	                       float opacity, int fadeMs) override;
	virtual void spriteMove(const std::string& id, bool hasX, float x, bool hasY, float y,
	                        bool hasOpacity, float opacity, bool hasScale, float scale,
	                        int durationMs) override;
	virtual void spriteHide(const std::string& id, int fadeMs) override;
	virtual void spriteClear(const std::string& layer, int fadeMs) override;
	virtual void textSpriteSet(const std::string& id, const std::string& text,
	                           float x, float y, float size, const std::string& color,
	                           bool bold, const std::string& layer, int fadeMs) override;

	// ===== レイヤ制御・トランジション（LAYER_SET / TRANSITION / WAIT_TRANSITION）=====
	virtual void layerSet(const std::string& name, bool hasVisible, bool visible,
	                      bool hasOpacity, float opacity) override;
	virtual void transition(const std::string& target, const std::string& type, int durationMs) override;
	virtual void waitTransition(const std::string& target, Callback onComplete) override;

	// ===== マスク（MASK_SET / MASK_CLEAR）=====
	virtual void maskSet(const std::string& color, float opacity, int durationMs) override;
	virtual void maskClear(int durationMs) override;

	// ===== 宣言的UI画面（UI_SHOW / UI_HIDE）=====
	virtual void uiShow(const std::string& screenId, bool wait, StringCallback onAction) override;
	virtual void uiHide() override;

	// 描画側（widget）が読む「いま開くべき画面」。空＝要求なし。
	const std::string& PendingUiScreen() const { return pendingUiScreen_; }
	// 画面が閉じたことを描画側が知らせる。action は "close" / "jump:<label>" / 空。
	void NotifyUiAction(const std::string& action);

	// ===== カメラ（CAMERA_SET）=====
	virtual void cameraSet(bool hasX, float x, bool hasY, float y,
	                       bool hasZoom, float zoom, int durationMs, bool reset) override;
	// 現在値（描画側が毎フレーム読む）。パンは論理px、ズームは倍率。
	void  CameraOffset(float& OutX, float& OutY) const { OutX = camera_.X; OutY = camera_.Y; }
	float CameraZoom() const { return camera_.Zoom; }
	virtual void waitCamera(Callback onComplete) override;
	// Cancel script callbacks without destroying an ongoing visual tween.
	void CancelPendingCommands();
	nlohmann::json SaveVisualState() const;
	// 壊れた・型の違う値があれば false を返し、今の見た目を変えない（例外を投げない）。
	bool RestoreVisualState(const nlohmann::json& Value);
	float VisualWaitRemaining() const;

	// ===== タイムライン（TIMELINE_PLAY）=====
	virtual void timelinePlay(const std::string& timelineId, Callback onComplete) override;
	// タイムライン本体の外部注入。"<id>": TimelineRoot の JSON オブジェクト
	// （変換ツールが出す converted/ts/timelines.json の形）。シナリオ開始前に入れる。
	void SetTimelines(const nlohmann::json& Timelines) { timelines_ = Timelines; }
	int32 NumTimelines() const { return timelines_.is_object() ? (int32)timelines_.size() : 0; }

	// ===== 音声（A2 は no-op / 最小反映） =====
	virtual void bgmPlay(const std::string& id, float vol, int fadeMs) override;
	virtual void bgmStop(int fadeMs) override;
	virtual void sePlay(const std::string& id, float vol) override;
	virtual void voicePlay(const std::string& id) override;

	// ===== 選択肢（非同期） =====
	virtual void showChoices(const std::vector<std::string>& labels, IntCallback onComplete) override;

	// ===== スクリーンフィルター（SCREEN_FILTER）=====
	virtual void screenFilter(const std::string& filter, float intensity, const FilterParams& params) override;
	virtual void screenFilterClear() override;

	// ===== 画面エフェクト（設計 Docs/Reports/2026/07/17/01 の Phase A）=====
	// いずれも非同期。update() で進めて完了時に onComplete を呼ぶ＝OpRunner が待つ。
	// 描画は持たず、現在値を widget（SKaedeMomijiUIWidget::OnPaint）が読んで反映する。
	// オーバーレイ（同期: 状態を積むだけ。フェードは update で進む）。
	virtual void overlaySet(const std::string& id, int fadeMs, float x, float y, float s) override;
	virtual void overlayHide(const std::string& id, int fadeMs) override;

	virtual void shake(float intensity, int durationMs, Callback onComplete) override;
	virtual void flash(int durationMs, Callback onComplete) override;
	virtual void fadeBlack(int durationMs, Callback onComplete) override;
	virtual void fadeWhite(int durationMs, Callback onComplete) override;
	virtual void blackIn(int durationMs, Callback onComplete) override;
	virtual void whiteIn(int durationMs, Callback onComplete) override;

	// ===== 毎フレーム =====
	virtual void update(float deltaMs) override;
	virtual void render() override {}

	// ===== 入力 =====
	virtual void handleClick() override;
	virtual void selectChoice(int index) override;

	// OpRunner が読み飛ばした Op をログの警告に出す（台本の書き損じを黙って流さない）。
	virtual void onUnhandledOp(int pc, const std::string& opName) override;

	const kaedevn::GameScreenState& State() const { return state_; }
	const std::string& FilterName() const { return filterName_; }
	float FilterIntensity() const { return filterIntensity_; }

	// ===== エフェクトの現在値（描画側が読む）=====
	// 揺れ幅は論理px。経過時間から決まる決定的な値で、乱数の状態を持たない
	// （セーブ/ロードやコマ落ちで見た目が飛ばない）。
	void  ShakeOffset(float& OutX, float& OutY) const;
	// 全画面オーバーレイ（FLASH / FADE_* / *_IN の共通表現）。alpha は 0..1、0=描かない。
	float OverlayAlpha() const { return fade_.Alpha; }
	bool  OverlayIsWhite() const { return fade_.bWhite; }

	// 画像オーバーレイ（OVERLAY_SET で積んだ一枚絵）。描画側が順に描く。
	const std::vector<FKaedeOverlayItem>& OverlayItems() const { return overlayItems_; }

	// スプライト（SPRITE_SET で積んだ画像）。order 昇順で描く責務は描画側にある。
	const std::vector<FKaedeSpriteItem>& Sprites() const { return sprites_; }

	// マスク（MASK_SET）。alpha 0=描かない。色は "#rrggbb"（空=黒）。
	float MaskAlpha() const { return mask_.Alpha; }
	const std::string& MaskColor() const { return mask_.Color; }

	// 論理レイヤの可視性・不透明度（LAYER_SET / TRANSITION）。
	// name は "background" / "character" / "overlay"。未知名は既定値（表示・不透明）。
	bool  LayerVisible(const std::string& name) const;
	float LayerOpacity(const std::string& name) const;

	// セーブ用のレイヤ一覧（既定から変更されたものだけが入る）。
	struct FKaedeLayerSnapshot { std::string name; bool bVisible = true; float opacity = 1.0f; };
	std::vector<FKaedeLayerSnapshot> LayerSnapshots() const;

	// ロード時に「見た目のうち Op で積み上がるもの」を復元する。
	// RestoreScene（背景/立ち絵/本文）の後に呼ぶ。トゥイーンは張らず確定値で入れる。
	void RestoreExtras(const std::vector<FKaedeSpriteItem>& InSprites,
	                   const std::string& InMaskColor, float InMaskAlpha,
	                   const std::vector<FKaedeLayerSnapshot>& InLayers);

	// タイプライター速度（バイト/秒。日本語は 3 バイト/字）。設定画面の
	// メッセージ速度（msgSpeed）から結線する。既定 60 ≒ 20 字/秒。
	void SetTextSpeed(float BytesPerSec) { textSpeed_ = BytesPerSec > 1.0f ? BytesPerSec : 1.0f; }
	float TextSpeed() const { return textSpeed_; }

	// ===== バックログ（既読テキスト履歴） =====
	const std::vector<FKaedeHistoryLine>& History() const { return history_; }

	// ===== セーブ/ロード支援 =====
	// ロード直前に内部状態を白紙化する（OpRunner::resume の前に呼ぶ）。
	void PrepareForLoad();
	// 待ち Op 再装填後に、保存済みの「見た目（背景/立ち絵/本文/BGM/フィルター/履歴）」を上書き復元する。
	// 待機フラグ・選択肢・コールバックは再装填側が設定したものを保持する（ここでは触らない）。
	void RestoreScene(const kaedevn::GameScreenState& Snapshot,
	                  const std::string& Filter, float FilterIntensity,
	                  const std::vector<FKaedeHistoryLine>& InHistory);

private:
	kaedevn::GameScreenState state_;
	std::string textBuffer_;
	std::string pendingSpeaker_;
	std::vector<FKaedeHistoryLine> history_;                // 既読テキスト履歴（バックログ）
	std::unordered_map<std::string, float> charFadeDurMs_;  // 立ち絵フェードイン残量(名前→duration)
	std::string filterName_;        // 現在のスクリーンフィルター（空=無し）
	float       filterIntensity_ = 0.0f;
	float       textSpeed_ = KaedeVn::KaedeDefaultTextSpeed; // タイプライター速度（バイト/秒）。設定から可変。

	// ===== 待ちの完了コールバック =====
	// OpRunner／KSC が待っている Op の続き。ロード（PrepareForLoad）と中断（CancelPendingCommands）で
	// 構造体ごと空にする。見た目の状態とは別に持つ（中断しても見た目は残すため）。
	struct FKaedePendingCallbacks
	{
		Callback       Click, Page, Wait;   // WAIT_CLICK / PAGE / WAIT_MS
		IntCallback    Choice;              // 選択肢
		Callback       Transition;          // WAIT_TRANSITION
		Callback       Camera;              // WAIT_CAMERA
		Callback       Shake;               // SHAKE
		Callback       Overlay;             // FLASH / FADE_* / *_IN
		StringCallback Ui;                  // UI_SHOW wait=true
	};
	FKaedePendingCallbacks pending_;

	// ===== SHAKE =====
	// 残時間で線形に減衰する揺れ。位相は経過時間で進めるのでフレームレート非依存。
	struct FKaedeShakeState
	{
		float DurMs = 0.0f;
		float RemainMs = 0.0f;
		float ElapsedMs = 0.0f;
		float Intensity = 0.0f;   // 論理px
	};
	FKaedeShakeState shake_;

	// ===== 全画面オーバーレイ =====
	// FLASH / FADE_BLACK / FADE_WHITE / BLACK_IN / WHITE_IN を1つの状態で表す。
	//   In    … 0→1 で塗り、**完了後も維持**（FADE_BLACK/FADE_WHITE＝暗転したまま）
	//   Out   … 1→0 で明ける（BLACK_IN/WHITE_IN）
	//   Flash … 0→1→0（FLASH）
	enum class EOverlayMode { None, In, Out, Flash };
	struct FKaedeFadeState
	{
		EOverlayMode Mode = EOverlayMode::None;
		bool  bWhite = false;
		float Alpha = 0.0f;
		float DurMs = 0.0f;
		float ElapsedMs = 0.0f;
	};
	FKaedeFadeState fade_;

	// 上記4種の共通開始処理。
	void StartOverlay(EOverlayMode Mode, bool bWhite, int durationMs, Callback onComplete);

	// ===== 画像オーバーレイ（OVERLAY_SET / OVERLAY_HIDE）=====
	// 描いた順に重なる。消えきった（alpha 0 かつ targetAlpha 0）ものは update で捨てる。
	std::vector<FKaedeOverlayItem> overlayItems_;

	// ===== スプライト（SPRITE_*）=====
	// overlayItems_ と同じライフサイクル（消えきったら update で破棄）。
	// 挿入順を保つため vector。同一 id の再 SET は置き換え（TS の show と同じ）。
	std::vector<FKaedeSpriteItem> sprites_;

	// layer 名 → 描画順。"back"=0 / それ以外（既定 front）=1。TS の layerOrder と一致。
	static int SpriteLayerOrder(const std::string& layer) { return layer == "back" ? 0 : 1; }

	// ===== マスク（MASK_SET / MASK_CLEAR）=====
	// 全画面オーバーレイ（FLASH/FADE_*）と違い、MASK_CLEAR まで維持し続ける。
	struct FKaedeMaskState
	{
		std::string Color = "#000000";
		float Alpha = 0.0f;
		float From = 0.0f;
		float TargetAlpha = 0.0f;
		FKaedeTween Tween;
	};
	FKaedeMaskState mask_;

	// ===== 論理レイヤ（LAYER_SET / TRANSITION）=====
	struct FKaedeLayerState
	{
		bool  bVisible = true;
		float opacity = 1.0f;
		FKaedeTween Trans;   // TRANSITION の 0→1 フェード
	};
	std::unordered_map<std::string, FKaedeLayerState> layers_;
	// WAIT_TRANSITION の完了待ち（進行中のレイヤ名。空=待つものが無い）。
	std::string pendingTransitionLayer_;

	// ===== 宣言的UI画面（UI_SHOW / UI_HIDE）=====
	// ハンドラは描画しないので、「開いてほしい画面名」を置いて widget に拾わせる。
	// wait=true のときだけコールバックを保持し、閉じたときに撃つ。
	std::string    pendingUiScreen_;

	// ===== カメラ（CAMERA_SET）=====
	// 論理px のパンと倍率。time>0 なら update() が From→To を補間する。
	struct FKaedeCameraState
	{
		float X = 0.0f, Y = 0.0f, Zoom = 1.0f;
		float FromX = 0.0f, FromY = 0.0f, FromZoom = 1.0f;
		float ToX = 0.0f, ToY = 0.0f, ToZoom = 1.0f;
		FKaedeTween Tween;
	};
	FKaedeCameraState camera_;

	// ===== タイムライン（TIMELINE_PLAY）=====
	// 再生中の 1 本。TS の TimelineDelegate が ticker で回すのと同じ扱いを update() で行う。
	struct FKaedeActiveTimeline
	{
		nlohmann::json root;        // TimelineRoot（評価のたびに引き直さないよう複製で持つ）
		float elapsedMs = 0.0f;
		float durationMs = 0.0f;
		Callback onComplete;
	};
	nlohmann::json timelines_ = nlohmann::json::object();   // id → TimelineRoot
	std::vector<FKaedeActiveTimeline> activeTimelines_;

	// WAIT_CLICK / PAGE の共通: 組み立て中の本文をバックログに積み、タイプライターで出し始める。
	void ShowPendingText();

	// 評価結果をスプライトへ適用する（targetId "spr_<id>" → sprites_ の id）。
	void ApplyTimelineResults(const std::vector<kaedevn::TimelineTrackResult>& Results);

	// レイヤ名の正規化（"bg"→"background" 等）。未知名は空を返す。
	static std::string NormalizeLayerName(const std::string& name);
};
