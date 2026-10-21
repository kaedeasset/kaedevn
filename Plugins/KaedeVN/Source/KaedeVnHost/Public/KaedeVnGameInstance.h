// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnGameInstance.h — 配布用 VN ホストの起動点（GameInstance）。
//
// KaedeVnHost モジュールは「ノベルを動かすのに最低限これだけあればいい」を集めた層。
// 開発リポジトリ側の Source/kaedevn（アルケミスト・帯窓・3D 等を含む）とは**別系統**で、
// Fab などへ配布するクリーンプロジェクトはこちらを ini で指すだけで 2D ノベルが起動する。
// 実際の描画・進行は KaedeVnUI の SKaedeMomijiUIWidget が持ち、ここは載せるだけ。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "KaedeVnGameInstance.generated.h"

// 起動時に SKaedeMomijiUIWidget をゲーム viewport に重ねるだけの最小 GameInstance。
// クリーン配布プロジェクトは DefaultEngine.ini の GameInstanceClass に
// /Script/KaedeVnHost.KaedeVnGameInstance を指定すれば 2D ノベルが起動する。
// アルケミスト/帯窓など開発リポジトリ固有のブートは持たない（それらは
// Source/kaedevn の UKaedeGameInstance 側。本クラスは配布用に分離した VN 専用）。
UCLASS()
class KAEDEVNHOST_API UKaedeVnGameInstance : public UGameInstance
{
	GENERATED_BODY()

public:
	virtual void OnStart() override;

	// AKaedeVnPlayerController が Enhanced Input をこの widget へ流すための参照。
	TSharedPtr<class SKaedeMomijiUIWidget> GetKaedeWidget() const { return KaedeWidget; }

private:
	TSharedPtr<class SKaedeMomijiUIWidget> KaedeWidget;
	// -KaedeKscIr=<path> 起動時に生成する KSC 実プレイ ウィジェット（KS 経路とは排他）。
	TSharedPtr<class SKaedeKscPlayWidget> KscWidget;
};
