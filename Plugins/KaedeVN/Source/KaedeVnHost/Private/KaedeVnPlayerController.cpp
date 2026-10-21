// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnPlayerController.cpp — Enhanced Input の実行時セットアップと widget への転送。
//
// IMC/InputAction をアセットではなく BeginPlay で生成している（配布物に入力アセットを
// 同梱しなくて済む＝クリーンプロジェクトが ini 指定だけで動く）。
// 各ハンドラは widget のメソッドを呼ぶだけで、判定やUI状態は一切持たない。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "KaedeVnPlayerController.h"
#include "KaedeVnLog.h"

#include "KaedeVnGameInstance.h"
#include "SKaedeMomijiUIWidget.h"

#include "Engine/LocalPlayer.h"   // NoPCHs のため明示include（GetSubsystem に完全型が要る）
#include "Engine/GameViewportClient.h"   // GameInstance が載せないときに widget を載せる
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputMappingContext.h"
#include "InputAction.h"

void AKaedeVnPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();

	// IA/IMC を実行時生成（SetupInputComponent は BeginPlay より前に呼ばれるためここで作る）。
	IMC = NewObject<UInputMappingContext>(this);
	auto MakeIA = [this](EInputActionValueType T)
	{
		UInputAction* A = NewObject<UInputAction>(this);
		A->ValueType = T;
		return A;
	};
	IA_Advance   = MakeIA(EInputActionValueType::Boolean);
	IA_Up        = MakeIA(EInputActionValueType::Boolean);
	IA_Down      = MakeIA(EInputActionValueType::Boolean);
	IA_Left      = MakeIA(EInputActionValueType::Boolean);
	IA_Right     = MakeIA(EInputActionValueType::Boolean);
	IA_Cancel    = MakeIA(EInputActionValueType::Boolean);
	IA_Auto      = MakeIA(EInputActionValueType::Boolean);
	IA_Skip      = MakeIA(EInputActionValueType::Boolean);
	IA_Menu      = MakeIA(EInputActionValueType::Boolean);
	IA_QuickSave = MakeIA(EInputActionValueType::Boolean);
	IA_QuickLoad = MakeIA(EInputActionValueType::Boolean);

	IMC->MapKey(IA_Advance, EKeys::Enter);
	IMC->MapKey(IA_Advance, EKeys::SpaceBar);
	IMC->MapKey(IA_Advance, EKeys::Gamepad_FaceButton_Bottom);  // A / ×
	// 方向は矢印＋ゲームパッドのみ（VN ではオート/スキップに文字キーを充てる）。
	IMC->MapKey(IA_Up,   EKeys::Up);
	IMC->MapKey(IA_Up,   EKeys::Gamepad_DPad_Up);
	IMC->MapKey(IA_Up,   EKeys::Gamepad_LeftStick_Up);
	IMC->MapKey(IA_Down, EKeys::Down);
	IMC->MapKey(IA_Down, EKeys::Gamepad_DPad_Down);
	IMC->MapKey(IA_Down, EKeys::Gamepad_LeftStick_Down);
	IMC->MapKey(IA_Left,  EKeys::Left);
	IMC->MapKey(IA_Left,  EKeys::Gamepad_DPad_Left);
	IMC->MapKey(IA_Left,  EKeys::Gamepad_LeftStick_Left);
	IMC->MapKey(IA_Right, EKeys::Right);
	IMC->MapKey(IA_Right, EKeys::Gamepad_DPad_Right);
	IMC->MapKey(IA_Right, EKeys::Gamepad_LeftStick_Right);
	IMC->MapKey(IA_Cancel, EKeys::Escape);
	IMC->MapKey(IA_Cancel, EKeys::BackSpace);
	IMC->MapKey(IA_Cancel, EKeys::Gamepad_FaceButton_Right);     // B / ○
	// オート/スキップ/メニュー（VN 標準: A=オート・Ctrl=スキップ）。
	IMC->MapKey(IA_Auto, EKeys::A);
	IMC->MapKey(IA_Auto, EKeys::Gamepad_LeftShoulder);           // L1
	IMC->MapKey(IA_Skip, EKeys::LeftControl);
	IMC->MapKey(IA_Skip, EKeys::Gamepad_RightShoulder);          // R1
	IMC->MapKey(IA_Menu, EKeys::Gamepad_Special_Right);          // Start / +
	IMC->MapKey(IA_QuickSave, EKeys::F5);
	IMC->MapKey(IA_QuickSave, EKeys::Gamepad_FaceButton_Top);     // Y / △
	IMC->MapKey(IA_QuickLoad, EKeys::F9);
	IMC->MapKey(IA_QuickLoad, EKeys::Gamepad_FaceButton_Left);    // X / □

	if (UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(InputComponent))
	{
		EIC->BindAction(IA_Advance, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnAdvance);
		EIC->BindAction(IA_Up,    ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnFocusUp);
		EIC->BindAction(IA_Down,  ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnFocusDown);
		EIC->BindAction(IA_Left,  ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnFocusLeft);
		EIC->BindAction(IA_Right, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnFocusRight);
		EIC->BindAction(IA_Cancel, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnCancel);
		EIC->BindAction(IA_Auto, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnAuto);
		EIC->BindAction(IA_Skip, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnSkip);
		EIC->BindAction(IA_Menu, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnMenu);
		EIC->BindAction(IA_QuickSave, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnQuickSave);
		EIC->BindAction(IA_QuickLoad, ETriggerEvent::Started, this, &AKaedeVnPlayerController::OnQuickLoad);
		UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] Enhanced Input actions bound (VnHost)"));
	}
	else
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] InputComponent is not UEnhancedInputComponent (VnHost)"));
	}
}

void AKaedeVnPlayerController::BeginPlay()
{
	Super::BeginPlay();

	bShowMouseCursor = true;
	SetInputMode(FInputModeGameAndUI());  // widget のマウス + PC の key/gamepad を両立

	if (ULocalPlayer* LP = GetLocalPlayer())
	{
		if (UEnhancedInputLocalPlayerSubsystem* Sub =
			LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
		{
			Sub->AddMappingContext(IMC, 0);
			UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] Enhanced Input mapping context added (VnHost)"));
		}
	}

	// GameInstance が UKaedeVnGameInstance でなければ、ノベルを載せる者がいない（GameInstance を設定していない
	// プロジェクトで、ノベルエディタの ▶ プレイが AKaedeVnGameMode で遊ぶとき）。ここで載せる。
	if (IsLocalController() && !GetGameInstance<UKaedeVnGameInstance>())
	{
		ULocalPlayer* LP = GetLocalPlayer();
		if (UGameViewportClient* VC = LP ? LP->ViewportClient.Get() : nullptr)
		{
			OwnWidget = SNew(SKaedeMomijiUIWidget);
			VC->AddViewportWidgetContent(OwnWidget.ToSharedRef());
			UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] SKaedeMomijiUIWidget added to viewport (VnHost PlayerController)"));
		}
		else
		{
			UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] no GameViewport at BeginPlay; widget not added (VnHost PlayerController)"));
		}
	}
}

void AKaedeVnPlayerController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (OwnWidget.IsValid())
	{
		ULocalPlayer* LP = GetLocalPlayer();
		if (UGameViewportClient* VC = LP ? LP->ViewportClient.Get() : nullptr)
		{
			VC->RemoveViewportWidgetContent(OwnWidget.ToSharedRef());
		}
		OwnWidget.Reset();
	}
	Super::EndPlay(EndPlayReason);
}

SKaedeMomijiUIWidget* AKaedeVnPlayerController::GetKaedeWidget() const
{
	if (UKaedeVnGameInstance* GI = GetGameInstance<UKaedeVnGameInstance>())
	{
		return GI->GetKaedeWidget().Get();
	}
	return OwnWidget.Get();
}

// 現在押下中のキーからゲームパッド操作かを推定する（Enhanced Input の統合 Action は
// どの物理キーで発火したかを持たないため）。1つでもパッドキーが押下中なら Gamepad とみなす。
bool AKaedeVnPlayerController::WasGamepadInput() const
{
	static const FKey PadKeys[] = {
		EKeys::Gamepad_FaceButton_Bottom, EKeys::Gamepad_FaceButton_Right,
		EKeys::Gamepad_FaceButton_Left,   EKeys::Gamepad_FaceButton_Top,
		EKeys::Gamepad_DPad_Up,   EKeys::Gamepad_DPad_Down,
		EKeys::Gamepad_DPad_Left, EKeys::Gamepad_DPad_Right,
		EKeys::Gamepad_LeftStick_Up,   EKeys::Gamepad_LeftStick_Down,
		EKeys::Gamepad_LeftStick_Left, EKeys::Gamepad_LeftStick_Right };
	for (const FKey& K : PadKeys) if (IsInputKeyDown(K)) return true;
	return false;
}

void AKaedeVnPlayerController::OnAdvance()   { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputConfirm(); } }
void AKaedeVnPlayerController::OnFocusUp()   { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputFocusPrev(); } }
void AKaedeVnPlayerController::OnFocusDown() { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputFocusNext(); } }
void AKaedeVnPlayerController::OnFocusLeft() { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputFocusLeft(); } }
void AKaedeVnPlayerController::OnFocusRight(){ if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputFocusRight(); } }
void AKaedeVnPlayerController::OnCancel()    { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputCancel(); } }
void AKaedeVnPlayerController::OnAuto()      { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputAuto(); } }
void AKaedeVnPlayerController::OnSkip()      { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputSkip(); } }
void AKaedeVnPlayerController::OnMenu()      { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) { W->NotifyInputDevice(WasGamepadInput()); W->InputMenu(); } }
void AKaedeVnPlayerController::OnQuickSave() { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) W->QuickSave(); }
void AKaedeVnPlayerController::OnQuickLoad() { if (SKaedeMomijiUIWidget* W = GetKaedeWidget()) W->QuickLoad(); }
