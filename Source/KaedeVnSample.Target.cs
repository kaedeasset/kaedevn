// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;

public class KaedeVnSampleTarget : TargetRules
{
	public KaedeVnSampleTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("KaedeVnSample");
	}
}
