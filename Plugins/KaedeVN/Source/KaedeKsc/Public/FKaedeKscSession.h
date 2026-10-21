// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

// FKaedeKscSession — KSC VM 実行トラックの再生コントローラ。
// KaedeCore の FKaedePlaySession（OpRunner + FKaedeOpHandler）の姉妹版で、
// OpRunner の代わりに KscVM + FKaedeKscHost を駆動する。
//
// widget が毎フレーム Tick() し、CurrentTree() を描画、クリック/選択を
// HandleClick/SelectChoice へ流す（FKaedePlaySession と同じ操作面）。
//
// 実行モデル（FKaedeKscHost の pending/poll 前提）:
//   - StartFromIrJson で IR をロードし VM を最初の yield（非同期 op）まで進める。
//   - Tick: Handler.update() でタイマー/タイプライターを進め、pending が完了して
//     いれば vm.resume() → vm.run() で次の yield まで進める。
//   - HandleClick/SelectChoice: Handler 側の待機コールバックを発火させ、続けて
//     VM を進める。

#include "CoreMinimal.h"

#include <memory>
#include <string>

#include "FKaedeOpHandler.h"              // FKaedeOpHandler（KaedeCore）
#include "FKaedeKscHost.h"                // FKaedeKscHost
#include "GameScreenState.hpp"            // kaedevn::GameScreenState
#include "core/UiNode.hpp"               // kaedevn::ui::UiNode
#include "kaedevn/ksc/IR.hpp"            // kaedevn::ksc::IRModule
#include "kaedevn/ksc/KscVM.hpp"         // kaedevn::ksc::KscVM

class KAEDEKSC_API FKaedeKscSession
{
public:
	FKaedeKscSession() : Handler(DefaultHandler), Host(Handler) {}
	explicit FKaedeKscSession(FKaedeOpHandler& InHandler) : Handler(InHandler), Host(Handler) {}
	~FKaedeKscSession() { Stop(); }
	FKaedeKscSession(const FKaedeKscSession&) = delete;
	FKaedeKscSession& operator=(const FKaedeKscSession&) = delete;
	// Clears outstanding handler callbacks while retaining the displayed scene.
	void Stop();
	void SetDisplayObserver(std::function<void(const std::string&)> Observer) { Host.OnDisplayOp = std::move(Observer); }
	// Legacy novel playback keeps its original one-yield-per-tick timing.
	void SetDrainImmediateOps(bool bIn) { bDrainImmediateOps = bIn; }

	// IR.json（TS ksc-compiler の emitIR 出力）から開始し、最初の待機まで進める。失敗時 false。
	bool StartFromIrJson(const std::string& IrJson);

	// 毎フレーム: Handler 更新 + pending 完了なら VM を resume して次の待機まで進める。
	void Tick(float DeltaMs);

	// 入力: テキスト送り / 選択肢決定。内部で VM を再開させる。
	void HandleClick();
	void SelectChoice(int32 Index);

	// フォーカス操作（選択肢ナビ。FKaedePlaySession と同シェイプ）。
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

	bool IsStarted() const { return bStarted; }
	bool IsFinished() const;
	bool IsErrored() const;
	// VM エラー時の説明（IsErrored のとき有効）。
	std::string ErrorMessage() const;
	bool IsWaitingForChoice() const { return Handler.State().waitingForChoice; }

	const kaedevn::GameScreenState& State() const { return Handler.State(); }
	kaedevn::ui::UiNode CurrentTree() const;

	// レイアウトの論理サイズとテンプレート種別（FKaedePlaySession と同じ。既定 1280x720）。
	void SetCompactLayout(bool bIn, int W = 1280, int H = 720)
	{ bCompactLayout = bIn; LogicalW = W; LogicalH = H; }

	// タイプライター速度（バイト/秒）。設定画面のメッセージ速度から結線する。
	void SetTextSpeed(float BytesPerSec) { Handler.SetTextSpeed(BytesPerSec); }

	FString FilterName() const { return FString(UTF8_TO_TCHAR(Handler.FilterName().c_str())); }
	float   FilterIntensity() const { return Handler.FilterIntensity(); }

private:
	// pending 完了なら resume、その後 Ready/Running の間 VM を回して次の yield まで進める。
	void DriveVm();

	FKaedeOpHandler        DefaultHandler;
	FKaedeOpHandler&       Handler;
	FKaedeKscHost          Host;      // Handler を参照（宣言順: Handler → Host）
	kaedevn::ksc::IRModule Module;    // VM が借用（VM より長命であること）
	std::unique_ptr<kaedevn::ksc::KscVM> Vm;

	bool  bStarted = false;
	bool  bDrainImmediateOps = false;
	int32 FocusedChoice = 0;
	bool  bCompactLayout = false;
	int   LogicalW = 1280;
	int   LogicalH = 720;
};
