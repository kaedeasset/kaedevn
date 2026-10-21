// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// SKaedeKscPlayWidget.cpp — KSC（IR.json）を再生する簡易ノベル画面。
//
// SKaedeMomijiUIWidget とは別経路。あちらが JSON シナリオを OpRunner で回すのに対し、
// こちらは FKaedeKscSession（KSC の C++ VM）を回す。`-KaedeKscIr=<path>` 起動時のみ使う。
//
// タイトル・メニュー・セーブ等は持たない**再生確認用の最小画面**で、本文と選択肢だけ。
// `-KaedeKscToEnd` で自動送りして最後まで進み終了する（headless 検証用）。
//
// 書体は本編と同じ設定（KaedeVn::GetVnFontFamily）に従う。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "SKaedeKscPlayWidget.h"
#include "KaedeVnLog.h"

#include "KaedeVnDraw.h"           // KaedeVn::DrawKaedeCmds / FKaedeLetterbox / MakeVnMeasure（本編と同じ描き方）
#include "KaedeVnCore.h"     // (FKaedeKscSession 経由で BuildPlayTree を使う)

#include "HAL/PlatformMisc.h"
#include "InputCoreTypes.h"   // EKeys

void SKaedeKscPlayWidget::Construct(const FArguments& InArgs)
{
	LogicalW = FMath::Max(1, InArgs._LogicalW);
	LogicalH = FMath::Max(1, InArgs._LogicalH);
	LogicalFontSize = FMath::Max(1, InArgs._FontSize);
	bAutoToEnd = InArgs._AutoToEnd;

	const std::string Ir = TCHAR_TO_UTF8(*InArgs._IrJson);
	const bool bOk = Session.StartFromIrJson(Ir);
	UE_LOG(LogKaedeVn, Display, TEXT("[KSC-play] StartFromIrJson ok=%d (autoToEnd=%d)"), bOk ? 1 : 0, bAutoToEnd ? 1 : 0);
	if (!bOk)
	{
		// 始まっていないセッションは IsFinished が false のままなので、回すと -KaedeKscToEnd が終わらない。
		// 回さずに止める。自動送りなら失敗の終了コードで抜け、呼び出し側をタイムアウトまで待たせない。
		UE_LOG(LogKaedeVn, Error, TEXT("[KSC-play] IR を読めない（-KaedeKscIr の JSON が壊れているか形が違う）。再生しない"));
		bExitRequested = true;
		if (bAutoToEnd) FPlatformMisc::RequestExitWithStatus(false, 1);
		return;
	}

	SetCanTick(true);
}

void SKaedeKscPlayWidget::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);

	Session.Tick(InDeltaTime * 1000.0f);   // ミリ秒
	Tree = Session.CurrentTree();

	if (bAutoToEnd) DriveAuto(InDeltaTime);
}

void SKaedeKscPlayWidget::DriveAuto(float DeltaSec)
{
	if (Session.IsFinished())
	{
		if (!bExitRequested)
		{
			bExitRequested = true;
			UE_LOG(LogKaedeVn, Display, TEXT("[KSC-play] finished=%d errored=%d err=%s -> exit"),
				Session.IsFinished(), Session.IsErrored(),
				*FString(UTF8_TO_TCHAR(Session.ErrorMessage().c_str())));
			FPlatformMisc::RequestExit(false);
		}
		return;
	}

	// 表示テキストが変わったら action列としてログ（重複抑止）。
	if (Session.State().text.has_value())
	{
		const std::string& C = Session.State().text->content;
		if (!C.empty() && C != LastLoggedText)
		{
			LastLoggedText = C;
			UE_LOG(LogKaedeVn, Display, TEXT("[KSC-play] text: %s"), *FString(UTF8_TO_TCHAR(C.c_str())));
		}
	}

	AutoAccum += DeltaSec;
	if (AutoAccum < 0.25f) return;   // 送り間隔（タイプライター完了を待ちつつ観測可能に）
	AutoAccum = 0.0f;

	if (Session.IsWaitingForChoice())
	{
		UE_LOG(LogKaedeVn, Display, TEXT("[KSC-play] choice -> select 0 (numChoices=%d)"), Session.NumChoices());
		Session.SelectChoice(0);
	}
	else
	{
		Session.HandleClick();   // タイプライター完了 or テキスト送り
	}
}

void SKaedeKscPlayWidget::AdvanceOrChoose(int32 ChoiceIndex)
{
	if (Session.IsWaitingForChoice())
	{
		const int32 N = Session.NumChoices();
		const int32 Idx = (ChoiceIndex >= 0 && ChoiceIndex < N) ? ChoiceIndex : Session.GetFocusedChoice();
		Session.SelectChoice(FMath::Clamp(Idx, 0, FMath::Max(0, N - 1)));
	}
	else
	{
		Session.HandleClick();
	}
}

int32 SKaedeKscPlayWidget::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry,
	const FSlateRect& MyCullingRect, FSlateWindowElementList& OutDrawElements,
	int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	// 論理 W×H をアロット領域へアスペクト維持で収める（レターボックス）。描き方は本編と同じ（KaedeVnDraw）。
	const KaedeVn::FKaedeLetterbox Box =
		KaedeVn::FKaedeLetterbox::Fit(AllottedGeometry.GetLocalSize(), LogicalW, LogicalH);
	if (!Box.IsValid()) return LayerId;

	CachedHits.Reset();
	const TArray<KaedeUI::FKaedeDrawCmd> Cmds = KaedeUI::ComputeDrawList(
		Tree, LogicalW, LogicalH, KaedeVn::MakeVnMeasure(LogicalFontSize), &CachedHits);
	return KaedeVn::DrawKaedeCmds(Cmds, AllottedGeometry, Box, OutDrawElements, LayerId, (float)LogicalFontSize);
}

FReply SKaedeKscPlayWidget::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (MouseEvent.GetEffectingButton() != EKeys::LeftMouseButton) return FReply::Unhandled();

	const KaedeVn::FKaedeLetterbox Box = KaedeVn::FKaedeLetterbox::Fit(MyGeometry.GetLocalSize(), LogicalW, LogicalH);
	if (!Box.IsValid()) return FReply::Handled();
	const FVector2f L = Box.ToLogical(FVector2f(MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition())));

	// 選択肢ボタンに当たったか（前フレーム OnPaint が収集した CachedHits・action="play.choice:N"）。
	const int32 Choice = KaedeVn::ChoiceIndexAt(CachedHits, L.X, L.Y);
	if (Choice >= 0) Session.SelectChoice(Choice);
	else             Session.HandleClick();   // それ以外はテキスト送り
	return FReply::Handled().SetUserFocus(SharedThis(this), EFocusCause::Mouse);
}

FReply SKaedeKscPlayWidget::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& KeyEvent)
{
	const FKey Key = KeyEvent.GetKey();

	// 数字キー 1..9 = 選択肢決定。
	static const FKey Nums[9] = { EKeys::One, EKeys::Two, EKeys::Three, EKeys::Four, EKeys::Five,
	                              EKeys::Six, EKeys::Seven, EKeys::Eight, EKeys::Nine };
	for (int32 i = 0; i < 9; ++i)
	{
		if (Key == Nums[i]) { AdvanceOrChoose(i); return FReply::Handled(); }
	}

	// Space / Enter = テキスト送り（選択肢待ちなら現フォーカスを決定）。
	if (Key == EKeys::SpaceBar || Key == EKeys::Enter || Key == EKeys::Virtual_Accept)
	{
		AdvanceOrChoose(-1);
		return FReply::Handled();
	}
	// 選択肢フォーカス移動。
	if (Key == EKeys::Down || Key == EKeys::Right) { Session.FocusNext(); return FReply::Handled(); }
	if (Key == EKeys::Up   || Key == EKeys::Left)  { Session.FocusPrev(); return FReply::Handled(); }

	return FReply::Unhandled();
}
