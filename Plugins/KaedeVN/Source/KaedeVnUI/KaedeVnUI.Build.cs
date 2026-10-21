// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;

// KaedeVnUI — ノベルの画面（SKaedeMomijiUIWidget・SKaedeKscPlayWidget・KaedeVnPreview・KaedeSceneTextureProvider）。
// 描画は MomijiUISlate（SKaedeUiCanvas・KaedeUiPainter）。2026-10-14 に KaedeUI から分けた
// （設計 Docs/Guides/Working/product-split-design.md §5.2）。同梱フォントの積み込みは MomijiUISlate.Build.cs。
public class KaedeVnUI : ModuleRules
{
	public KaedeVnUI(ReadOnlyTargetRules Target) : base(Target)
	{
		// UiNode.hpp 経由で nlohmann を含み、screenFromJsonString が throw しうる。
		bEnableExceptions = true;
		bUseUnity = false;
		PCHUsage = PCHUsageMode.NoPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",       // UTexture2D（シーン背景/立ち絵の手続き生成テクスチャ）
			"SlateCore",
			"Slate",
			"InputCore",
			"ImageWrapper",   // PNG デコード（実アート読み込み・白透過）
			"KaedeVnCore",    // BuildPlayTree・FKaedePlaySession（ノベルの再生）
			"MomijiUICore",   // UiNode・LoadScreenTree ほか（画面 JSON）
			"MomijiUISlate",  // SKaedeUiCanvas・ComputeDrawList（描画）
			"KaedeKsc",       // FKaedeKscSession（KSC実プレイ SKaedeKscPlayWidget）
			"KaedeShaders",
			"DeveloperSettings", // UKaedeVnSettings（作品の置き場・プレビューのマップ）
		});
	}
}
