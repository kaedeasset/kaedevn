// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

#include "CoreMinimal.h"

class UTexture;

// 背景の「ライブテクスチャ」供給の登録口。
//
// 背景 id が assets.json で "camera:<Tag>" を指す場合、KaedeUI（描画層）は
// World/Actor を持たないので自前ではカメラを描けない。そこで kaedevn（ランタイム層）が
// SceneCapture → RenderTarget を作り、ここに provider を登録する。描画層はタグを渡して
// UTexture（= RenderTarget でも可）を受け取り、従来の PNG と同じブラシ経路で背景に使う。
// 未登録/解決失敗なら nullptr を返し、呼び出し側は PNG/手続きテクスチャへフォールバックする。
namespace KaedeUI
{
	using FSceneTextureProvider = TFunction<UTexture* (const FString& CameraTag)>;

	// provider を登録/解除（空の TFunction で解除）。kaedevn 側から呼ぶため export する。
	KAEDEVNUI_API void SetSceneTextureProvider(FSceneTextureProvider Provider);

	// 登録済み provider で CameraTag を解決。未登録/失敗時は nullptr。
	// KaedeUI モジュール内（SKaedeMomijiUIWidget）からのみ使う。
	UTexture* ResolveSceneTexture(const FString& CameraTag);
}
