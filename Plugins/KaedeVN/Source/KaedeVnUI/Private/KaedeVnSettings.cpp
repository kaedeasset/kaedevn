// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnSettings.cpp — 作品の置き場を求める 1 か所の関数（宣言の .h を参照）。
// 既定値はコードに書かない（プラグインの Config/DefaultKaedeVN.ini。分割 S5・2026-10-14）。
#include "KaedeVnSettings.h"
#include "Misc/Paths.h"

UKaedeVnSettings::UKaedeVnSettings()
{
}

namespace KaedeVn
{
	FString GetWorkRoot()
	{
		FString Root = GetDefault<UKaedeVnSettings>()->WorkRoot;
		if (FPaths::IsRelative(Root)) { Root = FPaths::ProjectDir() / Root; }
		FPaths::NormalizeDirectoryName(Root);
		return Root;
	}
}