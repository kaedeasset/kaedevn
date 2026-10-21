// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnDraw.h — ノベルの画面 3 つ（本編 SKaedeMomijiUIWidget・KSC 再生 SKaedeKscPlayWidget・
// エディタのプレビュー SKaedeVnPreview）が共有する描き方。
//
// 前は 3 つがそれぞれ同じ式を持っていた（描画コマンドを Slate に描く手順・レターボックスの変換・
// 字の計測）。片方だけ直すと画面ごとに見た目がずれるので、ここ 1 本にした（2026-10-18 Issue #60）。
#pragma once

#include "CoreMinimal.h"
#include "KaedeUiPainter.h"   // KaedeUI::FKaedeDrawCmd / FKaedeHit / FKaedeMeasureFn

class FSlateWindowElementList;
struct FGeometry;
struct FSlateFontInfo;
namespace KaedeUI { enum class EKaedeFontFamily : uint8; }   // SKaedeUiCanvas.h

namespace KaedeVn
{
	// 論理座標（例 1920x1080）を割り当て領域へアスペクトを保って収める変換（レターボックス）。
	// 描画（OnPaint）と当たり判定（OnMouseButtonDown）が同じ式を使うためにある。
	struct KAEDEVNUI_API FKaedeLetterbox
	{
		float Scale = 0.f;   // 論理 px → ローカル px
		float OffX = 0.f;    // 論理 (0,0) のローカル位置
		float OffY = 0.f;

		// Size（ローカル）へ LogicalW x LogicalH を中央寄せで収める。Size が空なら IsValid() が false。
		static FKaedeLetterbox Fit(const FVector2f& Size, int32 LogicalW, int32 LogicalH);

		bool IsValid() const { return Scale > 0.f; }
		// 原点を論理 px でずらした写し（SHAKE の揺れ）。
		FKaedeLetterbox Shifted(float LogicalDX, float LogicalDY) const;
		FVector2f ToLocal(float X, float Y) const { return FVector2f(OffX + X * Scale, OffY + Y * Scale); }
		FVector2f ToLogical(const FVector2f& Local) const { return FVector2f((Local.X - OffX) / Scale, (Local.Y - OffY) / Scale); }
	};

	// ノベルの書体（プレイヤー設定 config.json の "fontFace"）。本編・KSC実プレイ・
	// ノベルエディタのプレビューが共通で参照する。既定はゴシック（fontFace を持たない settings.json の見た目を変えない）。
	// 設定は1つなので、インスタンス（帯クアッドの4画面など）を跨いで共有する。2026-10-18 に MomijiUI から移した（Issue #78）。
	KAEDEVNUI_API void SetVnFontFamily(KaedeUI::EKaedeFontFamily Family);
	KAEDEVNUI_API KaedeUI::EKaedeFontFamily GetVnFontFamily();

	// ノベルの字（本編・KSC 再生・プレビュー共通。書体は GetVnFontFamily）。
	KAEDEVNUI_API FSlateFontInfo MakeVnFont(bool bBold, int32 SizePx);
	// ノベルの字の計測（論理 px）。fontSize 0 の部品は DefaultFontPt で測る。描画と同じ書体で測る。
	KAEDEVNUI_API KaedeUI::FKaedeMeasureFn MakeVnMeasure(int32 DefaultFontPt);

	// 描画コマンド列を Slate に描く（Rect・RectOutline＝BaseLayer / Text＝BaseLayer+1）。次の空き層を返す。
	// DefaultFontPt は fontSize 0 の文字の大きさ（論理 px）。
	KAEDEVNUI_API int32 DrawKaedeCmds(const TArray<KaedeUI::FKaedeDrawCmd>& Cmds, const FGeometry& Geometry,
		const FKaedeLetterbox& Box, FSlateWindowElementList& OutDrawElements, int32 BaseLayer, float DefaultFontPt);

	// 論理座標の矩形の枠を、太さ ThicknessPx（ローカル px）の 4 本の帯で描く。
	KAEDEVNUI_API void DrawRectFrame(const FGeometry& Geometry, const FKaedeLetterbox& Box,
		FSlateWindowElementList& OutDrawElements, int32 Layer, float X, float Y, float W, float H,
		float ThicknessPx, const FLinearColor& Color);

	// 論理座標の点 (Lx, Ly) が当たり判定の矩形の中か（右と下の辺は含まない）。
	inline bool HitContains(const KaedeUI::FKaedeHit& H, float Lx, float Ly)
	{
		return Lx >= H.X && Lx < H.X + H.W && Ly >= H.Y && Ly < H.Y + H.H;
	}

	// 選択肢の当たり（action "play.choice:<n>"）なら n を、そうでなければ -1 を返す。
	KAEDEVNUI_API int32 ChoiceIndexAt(const TArray<KaedeUI::FKaedeHit>& Hits, float Lx, float Ly);
}
