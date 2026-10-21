// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;

// KaedeShaders — SCREEN_FILTER 用の .usf グローバルシェーダと、RT へのフルスクリーン適用。
// 設計書のフィルター parity 方針（.usf フルスクリーンパス）に沿う。
// LoadingPhase=PostConfigInit でシェーダ仮想ディレクトリ /Kaede を登録する。
public class KaedeShaders : ModuleRules
{
	public KaedeShaders(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"RenderCore",
			"RHI",
			"Renderer",
			"Projects",
		});
	}
}
