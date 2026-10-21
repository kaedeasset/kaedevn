// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;

// The sample's game module is empty: the novel is played by KaedeVnHost (GameInstance / GameMode / PlayerController).
// It exists so the project builds the KaedeVN and MomijiUI plugins from source.
public class KaedeVnSample : ModuleRules
{
	public KaedeVnSample(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
	}
}
