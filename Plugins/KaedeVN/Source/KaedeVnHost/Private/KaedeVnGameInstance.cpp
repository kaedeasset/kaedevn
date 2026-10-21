// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnGameInstance.cpp — 起動時にノベル widget を viewport へ載せる。
//
// 再生経路は2つあり、OnStart で排他に選ぶ:
//   -KaedeKscIr=<path> あり … SKaedeKscPlayWidget（KSC の IR.json を再生）
//   なし               … SKaedeMomijiUIWidget（従来の KS/JSON シナリオ）
// -KaedeShot はヘッドレスの起動確認用フック（4秒後に撮影・7秒後に終了）。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "KaedeVnGameInstance.h"
#include "KaedeVnLog.h"
#include "KaedeVnSettings.h"   // KaedeVn::GetWorkRoot（作品の置き場）

#include "SKaedeMomijiUIWidget.h"
#include "SKaedeKscPlayWidget.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "TimerManager.h"
#include "UnrealClient.h"

namespace
{
	// -KaedeKscIr の値を実ファイルパスへ解決する。絶対 → プロジェクト直下 → Game/ の順に探す。
	bool ResolveKscIrPath(const FString& In, FString& OutPath)
	{
		if (FPaths::FileExists(In)) { OutPath = In; return true; }
		const FString P1 = FPaths::Combine(FPaths::ProjectDir(), In);
		if (FPaths::FileExists(P1)) { OutPath = P1; return true; }
		const FString P2 = FPaths::Combine(KaedeVn::GetWorkRoot(), In);
		if (FPaths::FileExists(P2)) { OutPath = P2; return true; }
		return false;
	}
}

void UKaedeVnGameInstance::OnStart()
{
	Super::OnStart();

	// -KaedeKscIr=<path>: KSC(IR.json) 実プレイ経路。指定時は KS 経路の代わりにこちらを起動する。
	FString KscIr;
	if (GEngine && GEngine->GameViewport &&
		FParse::Value(FCommandLine::Get(), TEXT("KaedeKscIr="), KscIr) && !KscIr.IsEmpty())
	{
		FString IrPath, IrJson;
		if (ResolveKscIrPath(KscIr, IrPath) && FFileHelper::LoadFileToString(IrJson, *IrPath))
		{
			const bool bAuto = FParse::Param(FCommandLine::Get(), TEXT("KaedeKscToEnd"));
			KscWidget = SNew(SKaedeKscPlayWidget).IrJson(IrJson).AutoToEnd(bAuto);
			GEngine->GameViewport->AddViewportWidgetContent(KscWidget.ToSharedRef());
			UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] SKaedeKscPlayWidget added (KSC ir=%s auto=%d)"), *IrPath, bAuto ? 1 : 0);
			return;   // KS 経路は起動しない
		}
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] -KaedeKscIr='%s' を解決/読込できず。KS 経路にフォールバック"), *KscIr);
	}

	if (GEngine && GEngine->GameViewport)
	{
		KaedeWidget = SNew(SKaedeMomijiUIWidget);
		GEngine->GameViewport->AddViewportWidgetContent(KaedeWidget.ToSharedRef());
		UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] SKaedeMomijiUIWidget added to viewport (VnHost)"));
	}
	else
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] no GameViewport at OnStart; widget not added (VnHost)"));
	}

	// 検証用: -KaedeShot 付きで起動したら 4 秒後にスクショ、7 秒後に終了。
	// クリーン配布プロジェクトの起動確認をヘッドレスで回すためのフック。
	if (FParse::Param(FCommandLine::Get(), TEXT("KaedeShot")) && GetWorld())
	{
		FTimerHandle ShotHandle, QuitHandle;
		GetTimerManager().SetTimer(ShotHandle, FTimerDelegate::CreateLambda([]()
		{
			FScreenshotRequest::RequestScreenshot(TEXT("KaedeShot"), /*bShowUI*/ true, /*bAddFilenameSuffix*/ false);
			UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] screenshot requested (showUI)"));
		}), 4.0f, false);

		GetTimerManager().SetTimer(QuitHandle, FTimerDelegate::CreateLambda([]()
		{
			UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] KaedeShot done; requesting exit"));
			FPlatformMisc::RequestExit(false);
		}), 7.0f, false);
	}
}
