// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "KaedeVnDraw.h"

#include "SKaedeUiCanvas.h"   // MakeKaedeUiFont / MakeSlateMeasure / 角丸ブラシ / KaedeInkCenteredTextPos
#include "Framework/Application/SlateApplication.h"
#include "Layout/Geometry.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"

namespace KaedeVn
{
	FKaedeLetterbox FKaedeLetterbox::Fit(const FVector2f& Size, int32 LogicalW, int32 LogicalH)
	{
		FKaedeLetterbox B;
		if (Size.X <= 0.f || Size.Y <= 0.f || LogicalW <= 0 || LogicalH <= 0) return B;
		B.Scale = FMath::Min(Size.X / (float)LogicalW, Size.Y / (float)LogicalH);
		B.OffX = (Size.X - LogicalW * B.Scale) * 0.5f;
		B.OffY = (Size.Y - LogicalH * B.Scale) * 0.5f;
		return B;
	}

	FKaedeLetterbox FKaedeLetterbox::Shifted(float LogicalDX, float LogicalDY) const
	{
		FKaedeLetterbox B = *this;
		B.OffX += LogicalDX * Scale;
		B.OffY += LogicalDY * Scale;
		return B;
	}

	namespace { KaedeUI::EKaedeFontFamily GVnFontFamily = KaedeUI::EKaedeFontFamily::Gothic; }
	void SetVnFontFamily(KaedeUI::EKaedeFontFamily Family) { GVnFontFamily = Family; }
	KaedeUI::EKaedeFontFamily GetVnFontFamily() { return GVnFontFamily; }

	FSlateFontInfo MakeVnFont(bool bBold, int32 SizePx)
	{
		return KaedeUI::MakeKaedeUiFont(bBold, SizePx, GetVnFontFamily());
	}

	KaedeUI::FKaedeMeasureFn MakeVnMeasure(int32 DefaultFontPt)
	{
		return KaedeUI::MakeSlateMeasure(DefaultFontPt, GetVnFontFamily());
	}

	void DrawRectFrame(const FGeometry& Geometry, const FKaedeLetterbox& Box,
		FSlateWindowElementList& OutDrawElements, int32 Layer, float X, float Y, float W, float H,
		float ThicknessPx, const FLinearColor& Color)
	{
		const FSlateBrush* WhiteBrush = FCoreStyle::Get().GetBrush("WhiteBrush");
		// 位置は論理座標・大きさはローカル px。
		auto Bar = [&](float LX, float LY, float LocalW, float LocalH)
		{
			const FPaintGeometry PG = Geometry.ToPaintGeometry(
				FVector2f(LocalW, LocalH), FSlateLayoutTransform(Box.ToLocal(LX, LY)));
			FSlateDrawElement::MakeBox(OutDrawElements, Layer, PG, WhiteBrush, ESlateDrawEffect::None, Color);
		};
		Bar(X, Y, W * Box.Scale, ThicknessPx);
		Bar(X, Y + H, W * Box.Scale, ThicknessPx);
		Bar(X, Y, ThicknessPx, H * Box.Scale);
		Bar(X + W, Y, ThicknessPx, H * Box.Scale);
	}

	int32 DrawKaedeCmds(const TArray<KaedeUI::FKaedeDrawCmd>& Cmds, const FGeometry& Geometry,
		const FKaedeLetterbox& Box, FSlateWindowElementList& OutDrawElements, int32 BaseLayer, float DefaultFontPt)
	{
		const FSlateBrush* WhiteBrush = FCoreStyle::Get().GetBrush("WhiteBrush");
		const float Scale = Box.Scale;
		for (const KaedeUI::FKaedeDrawCmd& C : Cmds)
		{
			// sRGB(#rrggbb) → リニア変換（/255 直渡しは全色が明るく浮き native/web とずれる）。
			const FLinearColor Tint = FLinearColor::FromSRGBColor(C.Color);
			switch (C.Kind)
			{
			case KaedeUI::EKaedeDrawKind::Rect:
			{
				const FPaintGeometry PG = Geometry.ToPaintGeometry(
					FVector2f(C.W * Scale, C.H * Scale), FSlateLayoutTransform(Box.ToLocal(C.X, C.Y)));
				const FSlateBrush* Brush = C.Radius > 0.f
					? KaedeUI::GetKaedeRoundedFillBrush(C.Radius * Scale) : WhiteBrush;
				FSlateDrawElement::MakeBox(OutDrawElements, BaseLayer, PG, Brush, ESlateDrawEffect::None, Tint);
				break;
			}
			case KaedeUI::EKaedeDrawKind::RectOutline:
			{
				if (C.Radius > 0.f)
				{
					// RoundedBox の塗りは要素Tintで決まるため、枠線だけ残すには Tint をアルファ0にする
					// （枠色はブラシに焼き込み済み。SKaedeUiCanvas と同じ扱い）。
					const FPaintGeometry PG = Geometry.ToPaintGeometry(
						FVector2f(C.W * Scale, C.H * Scale), FSlateLayoutTransform(Box.ToLocal(C.X, C.Y)));
					FSlateDrawElement::MakeBox(OutDrawElements, BaseLayer, PG,
						KaedeUI::GetKaedeRoundedOutlineBrush(C.Radius * Scale, Tint, FMath::Max(1.f, Scale)),
						ESlateDrawEffect::None, FLinearColor(0.f, 0.f, 0.f, 0.f));
					break;
				}
				DrawRectFrame(Geometry, Box, OutDrawElements, BaseLayer, C.X, C.Y, C.W, C.H,
					FMath::Max(1.f, Scale), Tint);
				break;
			}
			case KaedeUI::EKaedeDrawKind::Text:
			{
				const float FontPt = C.FontPt > 0.f ? C.FontPt : DefaultFontPt;   // ルビ等は小サイズ
				const FSlateFontInfo Font = MakeVnFont(C.bBold, FMath::RoundToInt(FontPt * Scale));
				FVector2f Pos = Box.ToLocal(C.X, C.Y);
				if (C.CenterH > 0.f && FSlateApplication::IsInitialized())
				{
					// 字面で中央寄せ（SKaedeUiCanvas と同じ。2026-10-02）
					Pos = KaedeUI::KaedeInkCenteredTextPos(C.Text, Font, Pos, C.CenterH * Scale, C.bCenterX);
				}
				const FPaintGeometry PG = Geometry.ToPaintGeometry(
					FVector2f(FMath::Max(1.f, C.WrapW > 0 ? C.WrapW * Scale : 4000.f), FontPt * Scale),
					FSlateLayoutTransform(Pos));
				FSlateDrawElement::MakeText(OutDrawElements, BaseLayer + 1, PG, C.Text, Font,
					ESlateDrawEffect::None, Tint);
				break;
			}
			}
		}
		return BaseLayer + 2;
	}

	int32 ChoiceIndexAt(const TArray<KaedeUI::FKaedeHit>& Hits, float Lx, float Ly)
	{
		static const FString ChoicePrefix = TEXT("play.choice:");
		for (const KaedeUI::FKaedeHit& Hit : Hits)
		{
			if (HitContains(Hit, Lx, Ly) && Hit.Action.StartsWith(ChoicePrefix))
				return FCString::Atoi(*Hit.Action.RightChop(ChoicePrefix.Len()));
		}
		return -1;
	}
}
