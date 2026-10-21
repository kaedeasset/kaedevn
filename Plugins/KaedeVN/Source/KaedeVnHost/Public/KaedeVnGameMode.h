// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnGameMode.h — 配布用 VN ホストの GameMode。
//
// 役割は PlayerController の差し替えだけ。ノベルはレベル上のアクタを使わないので、
// GameMode に持たせる責務がこれ以外に無い。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "KaedeVnGameMode.generated.h"

// PlayerController を AKaedeVnPlayerController に差し替える GameMode。
// クリーン配布プロジェクトは DefaultEngine.ini の GlobalDefaultGameMode に
// /Script/KaedeVnHost.KaedeVnGameMode を指定する。
UCLASS()
class KAEDEVNHOST_API AKaedeVnGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AKaedeVnGameMode();
};
