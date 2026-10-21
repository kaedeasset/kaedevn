// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;

// KaedeVnHost — ゲームプロジェクトが ini 指定だけで 2D ノベルを起動できる最小ホスト層。
// GameInstance / GameMode / PlayerController の3点セット。KaedeVnUI(SKaedeMomijiUIWidget) を使う。
public class KaedeVnHost : ModuleRules
{
	public KaedeVnHost(ReadOnlyTargetRules Target) : base(Target)
	{
		// SKaedeMomijiUIWidget.h 経由で core/UiNode.hpp(nlohmann) を含むため例外が要る。
		bEnableExceptions = true;
		bUseUnity = false;
		PCHUsage = PCHUsageMode.NoPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"SlateCore",
			"Slate",
			"EnhancedInput",
			"KaedeVnCore",
			"KaedeVnUI",   // SKaedeMomijiUIWidget・SKaedeKscPlayWidget（KSC実プレイ経路）
		});
	}
}
