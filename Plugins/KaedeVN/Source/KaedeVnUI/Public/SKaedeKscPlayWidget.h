// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

// SKaedeKscPlayWidget — KSC(IR.json) を実プレイするための最小 Slate ウィジェット。
// SKaedeMomijiUIWidget(KS/OpRunner経路) の姉妹だが、こちらは FKaedeKscSession で
// KscVM を駆動する。タイトル/オーバーレイ/セーブ等は持たず「本編を遊ぶ」ことに集中した
// 増分3の最小結線（KS 経路のウィジェットには一切手を触れない）。
//
// 描画は KaedeUI::ComputeDrawList(CurrentTree()) を本編と共有の KaedeVn::DrawKaedeCmds（KaedeVnDraw.h）で
// FSlateDrawElement に発行（論理1280x720レターボックス）。クリック=テキスト送り/選択肢決定。

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"

#include "FKaedeKscSession.h"       // FKaedeKscSession（KaedeKsc）
#include "core/UiNode.hpp"          // kaedevn::ui::UiNode
#include "KaedeUiPainter.h"         // KaedeUI::FKaedeHit / ComputeDrawList

class KAEDEVNUI_API SKaedeKscPlayWidget : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SKaedeKscPlayWidget)
		: _LogicalW(1920)
		, _LogicalH(1080)
		, _FontSize(22)
		, _AutoToEnd(false)
	{}
		// 再生する IR.json 本文（TS ksc-compiler emitIR 出力）。
		SLATE_ARGUMENT(FString, IrJson)
		SLATE_ARGUMENT(int32, LogicalW)
		SLATE_ARGUMENT(int32, LogicalH)
		SLATE_ARGUMENT(int32, FontSize)
		// 検証用: 自動でテキスト送り＋選択肢0を選び、最後まで進めて終了要求する（headless確認）。
		SLATE_ARGUMENT(bool, AutoToEnd)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime,
		const float InDeltaTime) override;

	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry,
		const FSlateRect& MyCullingRect, FSlateWindowElementList& OutDrawElements,
		int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry,
		const FPointerEvent& MouseEvent) override;

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& KeyEvent) override;

private:
	// クリック/キーの共通処理: 選択肢待ちなら Index を決定、そうでなければテキスト送り。
	void AdvanceOrChoose(int32 ChoiceIndex /* <0 = テキスト送り */);
	// 自動再生（AutoToEnd）の1ステップ。
	void DriveAuto(float DeltaSec);

	FKaedeKscSession                        Session;
	kaedevn::ui::UiNode                     Tree;
	mutable TArray<KaedeUI::FKaedeHit>      CachedHits;

	int32 LogicalW = 1920;
	int32 LogicalH = 1080;
	int32 LogicalFontSize = 22;

	bool  bAutoToEnd = false;
	float AutoAccum = 0.0f;         // 自動送りの間隔管理
	std::string LastLoggedText;     // action列ログの重複抑止
	bool  bExitRequested = false;
};
