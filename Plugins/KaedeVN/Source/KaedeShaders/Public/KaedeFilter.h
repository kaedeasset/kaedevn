// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

#include "CoreMinimal.h"

class UTextureRenderTarget2D;
class UTexture;

namespace KaedeShaders
{
	// Src を FilterType / Intensity でフィルタして Dest(RT) に書き出す。
	// 描画スレッドへ ENQUEUE するので呼び出しはゲームスレッドから。
	//   FilterType: 0=none / 1=grayscale / 2=sepia / 3=warm / 4=cool
	KAEDESHADERS_API void ApplyFilter(UTextureRenderTarget2D* Dest, UTexture* Src,
	                                  int32 FilterType, float Intensity);
}
