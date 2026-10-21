// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

#include "CoreMinimal.h"          // KAEDEVNCORE_API / int32 / DLLEXPORT 定義のため
#include "core/UiNode.hpp"        // kaedevn::ui::UiNode / UiTheme（MomijiUICore）
#include "GameScreenState.hpp"    // kaedevn::GameScreenState
#include "Op.hpp"                 // kaedevn::CompiledScenario

// KaedeVN（ノベルの再生）の公開の関数。host 役（native PlayScreenView::buildTree 相当）として
// Play 画面のツリーを組む。画面 JSON の解析・prune・repeat・補間は MomijiUICore の関数を使い、
// ここで KAEDEVNCORE_API として他モジュールへ公開する（Core ヘッダは無改変）。
// 画面 JSON 一般の関数（LoadScreenTree・BindScreenTree ほか）は MomijiUICore.h。
// 2026-10-14 分割 S1 で旧 KaedeCore の公開ヘッダから分けた。名前空間 KaedeCore は変えない（設計 product-split-design.md §4）。
namespace KaedeCore
{
	// 静的 Play 画面（サンプル状態固定）。レイアウト契約テスト用。
	KAEDEVNCORE_API kaedevn::ui::UiNode BuildDemoPlayTree();

	// ライブの GameScreenState から Play 画面ツリーを組む（speaker/text/choices/skip を反映）。
	// LogicalW/H はテンプレートを生成する論理サイズ。
	//   bCompact=false（既定）… 全画面テンプレート。1280x720 は kPlayJson そのもの
	//     （native/web とのパリティ契約。Kaede.UI.PlayLayout が固定）で、1920x1080 は
	//     その厳密 1.5 倍の相似形（2解像度対応。Docs/Reports/2026/07/25/02）。
	//   bCompact=true  … 下部ストリップ用テンプレート（4画面並置。16:9 の帯なら 427x240）。
	//     スロット実寸を渡せば縮尺 1.0 になる。
	KAEDEVNCORE_API kaedevn::ui::UiNode BuildPlayTree(const kaedevn::GameScreenState& State,
	                                                  bool bCompact = false,
	                                                  int LogicalW = 1280, int LogicalH = 720);

	// A2 デモ用の組み込みシナリオ（テキスト→クリック→選択肢→分岐）。
	KAEDEVNCORE_API kaedevn::CompiledScenario BuildDemoScenario();

	// UIスキンのテーマトークン（Component Standard スキン切替仕様 CodexReports/2026/07/12-09）。
	// Family: 0=premium-atelier / 1=pc98。Variant: atelier=warm/dusk/light、pc98=dark-console/peach-status。
	// 範囲外は 0 に丸める。トークン値は仕様書 04/05 のカラートークン表が正。
	KAEDEVNCORE_API kaedevn::ui::UiTheme SkinTheme(int32 Family, int32 Variant);
	// Family ごとの variant 数（設定UIのクランプ用）。
	KAEDEVNCORE_API int32 SkinVariantCount(int32 Family);
}
