// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

// KaedeVnExpression.h — 表情の切り替えを外へ知らせる受け口（KaedeVnUI はそれだけを持つ）。
//
// ノベルの画面（SKaedeMomijiUIWidget）は、読み進めた行数が変わるたびにここへ流すだけで、
// 誰が受けて何をするか（3D の顔に表情を入れる等）は知らない。受ける側は社内のモジュール
// （KaedeRuntime の表情の処理）。設計 Docs/Guides/Working/product-split-design.md §5.4。
//
// 概要記述: Claude Opus 5.5 — 2026-10-14

#include "CoreMinimal.h"
#include "Delegates/Delegate.h"

struct FKaedeVnExpressionRequest
{
	// 表情の番号。今は「読み進めた行数」をそのまま渡し、受ける側が自分の表情の数で循環させる。
	int32 ExpressionIndex = 0;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FKaedeVnOnExpressionRequest, const FKaedeVnExpressionRequest&);

namespace KaedeVn
{
	// 表情の切り替えの受け口（モジュールに1つ）。受ける側は AddStatic などで登録し、
	// モジュールを閉じるときに Remove する。
	KAEDEVNUI_API FKaedeVnOnExpressionRequest& OnExpressionRequest();
}
