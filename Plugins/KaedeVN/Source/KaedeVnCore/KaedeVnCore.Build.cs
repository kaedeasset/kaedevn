// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;
using System.IO;

// KaedeVnCore — KaedeVN（ノベルの再生）の核。monorepo(native-engine)の純 C++ Core を UE 非依存のまま取り込むモジュール。
// 中身: Op / OpRunner / GameScreenState / IOpHandler / core(Action) と UE 側の糊（FKaedeOpHandler・FKaedePlaySession・
//       BuildPlayTree 等。公開は Public/KaedeVnCore.h）。SDL を一切引かない。
// UiNode・Interp（条件式）・nlohmann は MomijiUICore から使う（設計 product-split-design.md §3.3）。
public class KaedeVnCore : ModuleRules
{
	public KaedeVnCore(ReadOnlyTargetRules Target) : base(Target)
	{
		// 素の C++ として扱う。PCH を使わない(共有 PCH の強制も明示 PCH も不要)。
		PCHUsage = PCHUsageMode.NoPCHs;

		// ヘッダオンリー大物(json.hpp)と同名 static の結合衝突を避けるため Unity を無効化。
		bUseUnity = false;

		// nlohmann::json はパース失敗時に throw するため例外を有効化(native と挙動を揃える)。
		bEnableExceptions = true;

		// Core は素の C++。UE の IWYU ポリシーの対象外にする。
		IWYUSupport = IWYUSupport.None;

		PublicIncludePaths.AddRange(new string[]
		{
			Path.Combine(ModuleDirectory, "engine"),     // "Op.hpp" / "OpRunner.hpp" 等
		});

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"MomijiUICore",   // UiNode（再生中の画面）・evalCondExpr（JUMP_IF の条件式）・<nlohmann/json.hpp>
		});
	}
}
