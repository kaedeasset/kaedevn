// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnGameMode.cpp — PlayerController を差し替えるだけの GameMode 実装。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "KaedeVnGameMode.h"
#include "KaedeVnPlayerController.h"

AKaedeVnGameMode::AKaedeVnGameMode()
{
	PlayerControllerClass = AKaedeVnPlayerController::StaticClass();
}
