// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeSceneTextureProvider.cpp — 「カメラタグ → レンダーテクスチャ」の解決を差し替える口。
//
// KaedeUI は UE のワールドやアクタを知らない層なので、3Dシーンを UI へ貼るときの
// テクスチャ解決を自前で持てない。ホスト（kaedevn の GameInstance）が起動時に
// 関数を1つ登録し、KaedeUI 側はそれを呼ぶだけにしてある。
//
// 未登録なら nullptr を返す＝2D だけで動く構成でもリンク・実行できる。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "KaedeSceneTextureProvider.h"

namespace KaedeUI
{
	// モジュール内グローバル。kaedevn の GameInstance 起動時に一度登録される想定。
	static FSceneTextureProvider GSceneTextureProvider;

	void SetSceneTextureProvider(FSceneTextureProvider Provider)
	{
		GSceneTextureProvider = MoveTemp(Provider);
	}

	UTexture* ResolveSceneTexture(const FString& CameraTag)
	{
		return GSceneTextureProvider ? GSceneTextureProvider(CameraTag) : nullptr;
	}
}
