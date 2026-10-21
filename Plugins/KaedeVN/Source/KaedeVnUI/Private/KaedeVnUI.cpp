// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnUI.cpp — モジュール登録と、表情の切り替えの受け口（KaedeVnExpression.h）。
//
// KaedeVnUI はノベルの画面（SKaedeMomijiUIWidget・SKaedeKscPlayWidget・KaedeVnPreview・KaedeSceneTextureProvider）。
// 描画は MomijiUISlate（SKaedeUiCanvas・KaedeUiPainter）に任せる。2026-10-14 に KaedeUI から分けた
// （設計 Docs/Guides/Working/product-split-design.md §5.2）。起動引数 -KaedeUiShot・-KaedeUiExample は MomijiUISlate.cpp。
//
// 概要記述: Claude Opus 5.5 — 2026-10-14
#include "Modules/ModuleManager.h"
#include "KaedeVnExpression.h"

FKaedeVnOnExpressionRequest& KaedeVn::OnExpressionRequest()
{
	static FKaedeVnOnExpressionRequest Delegate;
	return Delegate;
}

IMPLEMENT_MODULE(FDefaultModuleImpl, KaedeVnUI);
