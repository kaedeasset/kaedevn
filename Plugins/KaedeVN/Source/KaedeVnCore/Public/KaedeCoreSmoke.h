// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

// KaedeCore スモークテスト。
// 公開シグネチャは bool のみ(std::string / nlohmann を露出しない)ので、
// 例外無効・IWYU 標準の通常 UE モジュールからも安全に include して呼べる。
namespace KaedeCore
{
	// 最小 play.json を Core(screenFromJsonString)に通し、UiNode ツリーを生成できれば true。
	// 「純 C++ Core が UE から呼べる(=コピペ可能)」を実機で実証するためのもの。
	// KAEDEVNCORE_API: モジュール境界(別 DLL)越しに呼べるよう dllexport する。
	KAEDEVNCORE_API bool SmokeTest();
}
