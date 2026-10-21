// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnPlayerController.h — キーボード/ゲームパッド入力を widget へ橋渡しする。
//
// ノベルの操作（送り・フォーカス移動・オート/スキップ・クイックセーブ）はすべて
// Slate 側（SKaedeMomijiUIWidget）が実装していて、ここは Enhanced Input のイベントを
// そこへ転送するだけ。widget は GameInstance 経由で引く。
// GameInstance が UKaedeVnGameInstance でないとき（GameInstance を設定していないプロジェクトで、
// ノベルエディタの ▶ プレイが AKaedeVnGameMode で遊ぶとき）は、ここが widget を載せて持つ。
// IMC/IA を実行時生成しているのは、配布プロジェクトに入力アセットを同梱させないため。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "KaedeVnPlayerController.generated.h"

class UInputAction;
class UInputMappingContext;
class SKaedeMomijiUIWidget;

// Enhanced Input でノベル操作を受ける PlayerController（配布用最小ホスト）。
// IMC/IA は実行時に生成（アセット不要）。入力は UKaedeVnGameInstance 経由で widget へ流す。
UCLASS()
class KAEDEVNHOST_API AKaedeVnPlayerController : public APlayerController
{
	GENERATED_BODY()

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void SetupInputComponent() override;

private:
	void OnAdvance();     // 決定 / テキスト送り / フォーカス中ボタン実行（Enter / Space / Gamepad A）
	void OnFocusUp();     // フォーカス上（↑ / DPad上 / 左スティック上）
	void OnFocusDown();   // フォーカス下（↓ / DPad下 / 左スティック下）
	void OnFocusLeft();   // フォーカス左 / スライダー減（← / DPad左 / 左スティック左）
	void OnFocusRight();  // フォーカス右 / スライダー増（→ / DPad右 / 左スティック右）
	void OnCancel();      // 戻る（Esc / Backspace / Gamepad B）
	void OnAuto();        // オート再生 ON/OFF（A / Gamepad L1）
	void OnSkip();        // スキップ ON/OFF（Ctrl / Gamepad R1）
	void OnMenu();        // メニューを開く（Gamepad Start）
	void OnQuickSave();   // クイックセーブ（F5 / Gamepad Y）
	void OnQuickLoad();   // クイックロード（F9 / Gamepad X）

	SKaedeMomijiUIWidget* GetKaedeWidget() const;
	// 直近の入力がゲームパッドか（入力ガイドの記号切替用。Enhanced Input はデバイス非依存のため
	// 現在押下中のキーから推定する）。
	bool WasGamepadInput() const;

	// GameInstance が載せないときに、自分で載せた widget（EndPlay で外す）
	TSharedPtr<SKaedeMomijiUIWidget> OwnWidget;

	UPROPERTY() TObjectPtr<UInputMappingContext> IMC;
	UPROPERTY() TObjectPtr<UInputAction> IA_Advance;
	UPROPERTY() TObjectPtr<UInputAction> IA_Up;
	UPROPERTY() TObjectPtr<UInputAction> IA_Down;
	UPROPERTY() TObjectPtr<UInputAction> IA_Left;
	UPROPERTY() TObjectPtr<UInputAction> IA_Right;
	UPROPERTY() TObjectPtr<UInputAction> IA_Cancel;
	UPROPERTY() TObjectPtr<UInputAction> IA_Auto;
	UPROPERTY() TObjectPtr<UInputAction> IA_Skip;
	UPROPERTY() TObjectPtr<UInputAction> IA_Menu;
	UPROPERTY() TObjectPtr<UInputAction> IA_QuickSave;
	UPROPERTY() TObjectPtr<UInputAction> IA_QuickLoad;
};
