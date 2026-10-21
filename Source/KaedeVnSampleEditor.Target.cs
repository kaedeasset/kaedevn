// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;

public class KaedeVnSampleEditorTarget : TargetRules
{
	public KaedeVnSampleEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("KaedeVnSample");
	}
}
