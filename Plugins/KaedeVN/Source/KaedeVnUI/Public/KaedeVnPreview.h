// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "UObject/StrongObjectPtr.h"

// SKaedeVnPreview — エディタ用の VN プレビュー。ランタイム(SKaedeMomijiUIWidget)と同じ
// 描画経路（KaedeCore::BuildPlayTree → KaedeUI::ComputeDrawList → SKaedeUiCanvas）で
// 背景・立ち絵・テキスト枠を描くため、本番の実行画面と一致する（16:9レターボックス・
// 立ち絵位置・テキスト色すべて共通）。以前の手描き SOverlay プレビューの置き換え。
//
// 設計方針: このヘッダは nlohmann/core ヘッダを露出しない（前方宣言のみ）。呼び出し側
// （KaedeEditor）は FString/プレーン構造体だけを渡し、nlohmann を引き込まずに済む。
// 実体（GameScreenState 構築・BuildPlayTree・ComputeDrawList）は .cpp に閉じる。

class SKaedeUiCanvas;
class UTexture2D;
struct FSlateBrush;

namespace KaedeUI
{
	// プレビューに載せる立ち絵1体（画像は絶対パス。空なら描かない）。
	struct FKaedeVnPreviewChar
	{
		FString ImagePath;               // 立ち絵PNGの絶対パス
		FString Pos = TEXT("center");    // "left" / "center" / "right"
		float   Alpha = 1.f;
	};
}

class KAEDEVNUI_API SKaedeVnPreview : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SKaedeVnPreview) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	// 背景・立ち絵・話者・本文から本番同一の VN 画面を再構築する。
	// 画像はいずれも絶対パス（空可）。Body/Speaker が両方空ならテキスト枠は出さない。
	void SetScene(const FString& BgImagePath,
	              const TArray<KaedeUI::FKaedeVnPreviewChar>& Chars,
	              const FString& Speaker, const FString& Body);

private:
	TSharedPtr<SKaedeUiCanvas> Canvas;

	// スプライトが参照するテクスチャ/ブラシの寿命保持（GC・Slate 参照切れ防止）。
	TArray<TStrongObjectPtr<UTexture2D>> KeepTextures;
	TArray<TSharedPtr<FSlateBrush>>      KeepBrushes;
};
