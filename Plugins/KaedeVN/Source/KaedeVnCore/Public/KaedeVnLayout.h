// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnLayout.h — ノベル本編の数の決まり（セーブの枠の数・文字の速さ・立ち絵の置き方）。
// 本編（SKaedeMomijiUIWidget）・エディタのプレビュー（SKaedeVnPreview）・再生の核（FKaedeOpHandler）が
// 同じ値を使うので、ここ 1 か所で決める（2026-10-18 Issue #60。前は各所に数字で直書きしていた）。
#pragma once

#include "CoreMinimal.h"

namespace KaedeVn
{
	// セーブの枠の数。save:<n> / load:<n> の n は 1..KaedeSaveSlotCount（Game/ui/save.json・load.json と合わせる）。
	inline constexpr int32 KaedeSaveSlotCount = 6;

	// 文字の速さの既定（バイト/秒。日本語でおよそ 20 字/秒）。
	inline constexpr float KaedeDefaultTextSpeed = 60.f;
	// 設定画面のメッセージ速度 msgSpeed（0..1）に掛ける数。既定の msgSpeed は KaedeDefaultTextSpeed / これ。
	inline constexpr double KaedeTextSpeedPerMsgSpeed = 150.0;

	// 立ち絵の置き方（論理座標）。高さと左右の余白は論理解像度に対する比で持つ
	// （1280x720 で高さ 700px・余白 60px。帯の 480x240 でも画面の外へ突き抜けない）。
	struct FKaedeCharPlacement
	{
		float Height = 0.f;      // 立ち絵の高さ（下端は画面の下端にそろえる）
		float SideMargin = 0.f;  // 左右の余白（xNorm 0 / 1 の立ち絵の外側）
	};
	KAEDEVNCORE_API FKaedeCharPlacement CharPlacement(float LogicalW, float LogicalH);
}
