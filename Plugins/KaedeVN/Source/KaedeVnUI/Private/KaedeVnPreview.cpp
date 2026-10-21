// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnPreview.cpp — ノベルエディタの「本番同一レンダラ」プレビュー。
//
// SKaedeBlockEditor / SKaedeWorkEditor が編集中の1シーンを表示するために使う。
// **本編と同じ経路で描くのが要件**なので、テンプレート生成（BuildPlayTree）も
// 描画（ComputeDrawList + SKaedeUiCanvas）も論理解像度も書体も本編に合わせる。
// ここが本編とズレると「エディタで見た通りに出ない」になる。
//
// 本編と違うのはライブ進行が無いことだけ（タイプライタは完成形で表示）。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "KaedeVnPreview.h"

#include "SKaedeUiCanvas.h"        // SKaedeUiCanvas / MakeKaedeUiFont / KaedeLoadPngBrush / FKaedeCanvasSprite / KaedeLogical*
#include "KaedeUiPainter.h"        // KaedeUI::ComputeDrawList / FKaedeDrawCmd / FKaedeHit / FKaedeMeasureFn
#include "KaedeVnCore.h"     // KaedeCore::BuildPlayTree（+ GameScreenState.hpp / UiNode.hpp）
#include "KaedeVnDraw.h"     // KaedeVn::MakeVnMeasure（本編と同じ字の計測）
#include "KaedeVnLayout.h"   // KaedeVn::CharPlacement（立ち絵の置き方）

#include "Engine/Texture2D.h"

namespace
{
	// 本番同一プレビューなので、ランタイム（SKaedeMomijiUIWidget）と同じ VN 既定解像度で組む。
	// 既定文字サイズもパリティ基準からの倍率で合わせる（16 → 24。16:9 相似なので整数）。
	constexpr int32 kPvW = KaedeUI::KaedeVnLogicalW;
	constexpr int32 kPvH = KaedeUI::KaedeVnLogicalH;
	constexpr int32 kPvFont =
		KaedeUI::KaedeLogicalFontSize * KaedeUI::KaedeVnLogicalW / KaedeUI::KaedeLogicalW;
}

void SKaedeVnPreview::Construct(const FArguments& InArgs)
{
	ChildSlot
	[
		SAssignNew(Canvas, SKaedeUiCanvas)
		.LogicalW(kPvW)
		.LogicalH(kPvH)
		.FontSize(kPvFont)
		.FontFamily(KaedeVn::GetVnFontFamily())   // 本編と同じ書体で描く
	];
}

void SKaedeVnPreview::SetScene(const FString& BgImagePath,
	const TArray<KaedeUI::FKaedeVnPreviewChar>& Chars,
	const FString& Speaker, const FString& Body)
{
	if (!Canvas.IsValid()) return;

	// プレイヤー設定で書体が変わっている可能性があるので毎回追従させる（本番同一プレビュー）。
	Canvas->SetFontFamily(KaedeVn::GetVnFontFamily());

	// 前回の保持物を解放（SetContent/SetSprites で古いブラシ参照は差し替わる）。
	KeepTextures.Reset();
	KeepBrushes.Reset();

	// ===== テキスト枠: ランタイムと同じ BuildPlayTree → ComputeDrawList =====
	kaedevn::GameScreenState St;
	if (!Body.IsEmpty() || !Speaker.IsEmpty())
	{
		kaedevn::ScreenTextState T;
		T.content = TCHAR_TO_UTF8(*Body);
		T.speaker = TCHAR_TO_UTF8(*Speaker);
		T.displayedChars = 1.0e9f;   // 全文表示（タイプライタ途中ではなく完成形）
		St.text = T;
	}
	const kaedevn::ui::UiNode PlayTree = KaedeCore::BuildPlayTree(St, /*bCompact=*/false, kPvW, kPvH);

	// 計測は本編と同じ書体・同じ式（KaedeVn::MakeVnMeasure。違うと折り返し位置とセンタリングがずれる）。
	TArray<KaedeUI::FKaedeHit> Hits;
	TArray<KaedeUI::FKaedeDrawCmd> Cmds = KaedeUI::ComputeDrawList(
		PlayTree, kPvW, kPvH, KaedeVn::MakeVnMeasure(kPvFont), &Hits);

	// ===== 背景・立ち絵: ランタイムと同じ座標計算でスプライト化 =====
	const float LW = (float)kPvW;   // 1920
	const float LH = (float)kPvH;   // 1080

	// PNG を読み、ブラシ/テクスチャの寿命を保持する。
	auto LoadSprite = [this](const FString& Path, UTexture2D*& OutTex) -> TSharedPtr<FSlateBrush>
	{
		OutTex = nullptr;
		if (Path.IsEmpty()) return nullptr;
		TSharedPtr<FSlateBrush> Brush = KaedeUI::KaedeLoadPngBrush(Path, OutTex);
		if (Brush.IsValid())
		{
			KeepBrushes.Add(Brush);
			if (OutTex) KeepTextures.Add(TStrongObjectPtr<UTexture2D>(OutTex));
		}
		return Brush;
	};

	TArray<KaedeUI::FKaedeCanvasSprite> Sprites;

	// 背景: 高さ基準でアスペクト維持・水平センタリング（SKaedeMomijiUIWidget と同一）。
	{
		UTexture2D* BgTex = nullptr;
		if (TSharedPtr<FSlateBrush> BgBrush = LoadSprite(BgImagePath, BgTex))
		{
			const float Aspect = (BgTex && BgTex->GetSizeY() > 0)
				? (float)BgTex->GetSizeX() / (float)BgTex->GetSizeY()
				: (LW / LH);
			const float BH = LH;
			const float BW = BH * Aspect;
			KaedeUI::FKaedeCanvasSprite S;
			S.Brush = BgBrush; S.X = (LW - BW) * 0.5f; S.Y = 0.f; S.W = BW; S.H = BH;
			Sprites.Add(S);
		}
	}

	// 立ち絵: 下端そろえ・高さと左右の余白は本編と同じ KaedeVn::CharPlacement。
	const KaedeVn::FKaedeCharPlacement Place = KaedeVn::CharPlacement(LW, LH);
	for (const KaedeUI::FKaedeVnPreviewChar& C : Chars)
	{
		if (C.Alpha <= 0.f) continue;
		UTexture2D* ChTex = nullptr;
		TSharedPtr<FSlateBrush> ChBrush = LoadSprite(C.ImagePath, ChTex);
		if (!ChBrush.IsValid()) continue;
		const float Aspect = (ChTex && ChTex->GetSizeY() > 0)
			? (float)ChTex->GetSizeX() / (float)ChTex->GetSizeY() : 0.6f;
		const float CH = Place.Height;
		const float CW = CH * Aspect;
		const float Margin = Place.SideMargin;
		const float CX = (C.Pos == TEXT("left")) ? Margin
			: (C.Pos == TEXT("right")) ? (LW - Margin - CW) : (LW - CW) * 0.5f;
		const float CY = LH - CH;
		KaedeUI::FKaedeCanvasSprite S;
		S.Brush = ChBrush; S.X = CX; S.Y = CY; S.W = CW; S.H = CH;
		Sprites.Add(S);
	}

	Canvas->SetContent(MoveTemp(Cmds), MoveTemp(Hits), FLinearColor::Black);
	Canvas->SetSprites(MoveTemp(Sprites));
}
