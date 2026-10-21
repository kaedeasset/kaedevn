// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnHost.cpp — モジュール登録のみ。独自の起動処理は持たない。
//
// KaedeVnHost は配布用の最小 VN ホスト。起動の実体は UKaedeVnGameInstance::OnStart にある。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "Modules/ModuleManager.h"

IMPLEMENT_MODULE(FDefaultModuleImpl, KaedeVnHost)
