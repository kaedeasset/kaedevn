// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeKsc.cpp — モジュール登録とログ分類の定義のみ。
//
// KaedeKsc は KSC（kaedevn 独自スクリプト）の C++ スタックVM を UE へ組み込む層。
// VM 本体は engine 非依存（nlohmann/json のみ）で、monorepo と共有できる。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "Modules/ModuleManager.h"
#include "KaedeKscLog.h"

IMPLEMENT_MODULE(FDefaultModuleImpl, KaedeKsc)
DEFINE_LOG_CATEGORY(LogKaedeKsc);
