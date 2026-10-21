// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
using UnrealBuildTool;

// KaedeKsc — KSC(KaedeScript) スタック VM の C++ 移植を UE に載せるモジュール。
// upstream: monorepo packages/ksc-vm-cpp（engine 非依存 C++17 + nlohmann/json）。
// IR.json を KscVM で実行し、HostAPI（FKaedeKscHost）経由で KaedeVnCore の DispatchDisplayOp へ橋渡しする（execOp）。
// ソースは monorepo の packages/ksc-vm-cpp からのミラー（Public/kaedevn/ksc/*.hpp・Private/*.cpp）。
public class KaedeKsc : ModuleRules
{
	public KaedeKsc(ReadOnlyTargetRules Target) : base(Target)
	{
		// 素の C++ として扱う（KaedeVnCore と同方針）。
		PCHUsage = PCHUsageMode.NoPCHs;
		bUseUnity = false;

		// nlohmann::json / IR パースが throw しうるため例外を有効化。
		bEnableExceptions = true;

		IWYUSupport = IWYUSupport.None;

		// Public/ は既定で public include path に入る（"kaedevn/ksc/KscVM.hpp" 解決）。
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"KaedeVnCore", // IOpHandler・BuildPlayTree。<nlohmann/json.hpp> は KaedeVnCore が公開で使う MomijiUICore の ThirdParty から
		});
	}
}
