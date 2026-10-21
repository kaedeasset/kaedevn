// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

#include "CoreMinimal.h"
#include "FKaedeOpHandler.h"
#include "OpRunner.hpp"          // kaedevn::OpRunner
#include "Op.hpp"               // kaedevn::CompiledScenario
#include "core/UiNode.hpp"       // kaedevn::ui::UiNode

// FKaedePlaySession — OpRunner + FKaedeOpHandler を束ねた再生コントローラ。
// widget が毎フレーム Tick() し、CurrentTree() を描画、クリックを HandleClick/SelectChoice へ流す。
class KAEDEVNCORE_API FKaedePlaySession
{
public:
	// 組み込みデモシナリオを読み込んで開始し、最初の待機まで進める。
	void StartDemo();

	// Op JSON 文字列（プロジェクトの scenario.json）から開始する。失敗時は false。
	bool StartFromJson(const std::string& Json);

	// タイムライン（TIMELINE_PLAY の再生対象）を注入する。作品の timelines.json 相当。
	// **StartFromJson の前に呼ぶこと**（シナリオ冒頭で TIMELINE_PLAY が来ても引けるように）。
	// 失敗（JSON 不正）でも false を返すだけでシナリオは止めない。
	bool SetTimelinesFromJson(const std::string& Json);
	int32 NumTimelines() const { return Handler.NumTimelines(); }

	// 毎フレーム: 状態更新 + 同期 Op の消化。
	void Tick(float DeltaMs);

	// 入力: テキスト送り / 選択肢決定。内部で OpRunner を再開させる。
	void HandleClick();
	void SelectChoice(int32 Index);

	// フォーカス操作（キーボード/ゲームパッド・選択肢ナビ）。マウスと共有。
	void FocusNext();
	void FocusPrev();
	void SetFocus(int32 Index);
	int32 GetFocusedChoice() const { return FocusedChoice; }
	int32 NumChoices() const
	{
		return Handler.State().choices.has_value()
			? (int32)Handler.State().choices->labels.size() : 0;
	}
	// 決定: 選択肢待ちなら現フォーカスを決定、そうでなければテキスト送り。
	void Confirm();

	bool IsFinished() const { return Runner.isFinished(); }
	bool IsWaitingForChoice() const { return Handler.State().waitingForChoice; }

	// タイトルへ戻って最初からやり直す等で、ハンドラの見た目/本文/履歴を初期化する。
	// この後に StartFromJson/StartDemo を呼べばクリーンに再開できる。
	void ResetState() { Handler.PrepareForLoad(); bStarted = false; }

	// ===== セーブ/ロード =====
	// 現在地点が安定した待ち（クリック/選択/ページ）か。ここでだけセーブを許す。
	bool CanSave() const;
	// 実行位置(pc/vars/read) + 見た目(背景/立ち絵/本文/BGM/フィルター) + バックログを JSON 化。
	std::string SaveToJson() const;
	// SaveToJson の JSON から復元する（シナリオは事前に Start 済みであること）。失敗時 false。
	bool LoadFromJson(const std::string& Json);

	// バックログ（既読テキスト履歴）。
	const std::vector<FKaedeHistoryLine>& History() const { return Handler.History(); }

	const kaedevn::GameScreenState& State() const { return Handler.State(); }
	kaedevn::ui::UiNode CurrentTree() const;

	// レイアウトの論理サイズとテンプレート種別。
	//   bIn=false … 全画面テンプレート（1280x720 or 1920x1080。作品設定の解像度）
	//   bIn=true  … 下部ストリップ用コンパクトテンプレート（16:9 の帯なら 427x240）
	// W/H はスロットの論理サイズ。実寸と一致させれば縮尺1.0（本文16pxが実16pxで出る）。
	// ⚠ 既定は 1280x720。ここを 427x240 にすると、SetCompactLayout を呼ばないホストの
	//   全画面テンプレートまで 427 幅で生成されてしまう（BuildPlayTree が W/H を両方の
	//   テンプレートに使うようになったため）。
	void SetCompactLayout(bool bIn, int W = 1280, int H = 720)
	{ bCompactLayout = bIn; LogicalW = W; LogicalH = H; }

	// スクリーンフィルター（widget が .usf 適用に使う）。
	FString FilterName() const { return FString(UTF8_TO_TCHAR(Handler.FilterName().c_str())); }
	float   FilterIntensity() const { return Handler.FilterIntensity(); }

	// 画面エフェクトの現在値（SHAKE の揺れ幅・全画面オーバーレイ）。描画側が毎フレーム読む。
	void  ShakeOffset(float& OutX, float& OutY) const { Handler.ShakeOffset(OutX, OutY); }
	float OverlayAlpha() const { return Handler.OverlayAlpha(); }
	bool  OverlayIsWhite() const { return Handler.OverlayIsWhite(); }
	const std::vector<FKaedeOverlayItem>& OverlayItems() const { return Handler.OverlayItems(); }
	// スプライト（SPRITE_SET / TEXT_SPRITE_SET）。描画側が order 昇順で描く。
	const std::vector<FKaedeSpriteItem>& Sprites() const { return Handler.Sprites(); }
	// 宣言的UI画面（UI_SHOW）。widget が毎フレーム見て、空でなければその画面を開く。
	// 閉じたら NotifyUiAction で返す（"close" / "jump:<label>"）。
	FString PendingUiScreen() const { return FString(UTF8_TO_TCHAR(Handler.PendingUiScreen().c_str())); }
	void NotifyUiAction(const FString& Action) { Handler.NotifyUiAction(TCHAR_TO_UTF8(*Action)); Runner.tick(); }

	// カメラ（CAMERA_SET）。シーン（背景/立ち絵/スプライト/一枚絵）にだけ掛かる。
	void  CameraOffset(float& OutX, float& OutY) const { Handler.CameraOffset(OutX, OutY); }
	float CameraZoom() const { return Handler.CameraZoom(); }

	// マスク（MASK_SET）と論理レイヤ（LAYER_SET / TRANSITION）。
	float MaskAlpha() const { return Handler.MaskAlpha(); }
	FString MaskColor() const { return FString(UTF8_TO_TCHAR(Handler.MaskColor().c_str())); }
	bool  LayerVisible(const char* Name) const { return Handler.LayerVisible(Name); }
	float LayerOpacity(const char* Name) const { return Handler.LayerOpacity(Name); }

	// タイプライター速度（バイト/秒）。設定画面のメッセージ速度から結線する。
	void SetTextSpeed(float BytesPerSec) { Handler.SetTextSpeed(BytesPerSec); }

private:
	kaedevn::OpRunner Runner;
	FKaedeOpHandler Handler;
	kaedevn::CompiledScenario Scenario;
	bool bStarted = false;
	int32 FocusedChoice = 0;
	bool bCompactLayout = false;
	int  LogicalW = 1280;
	int  LogicalH = 720;
};
