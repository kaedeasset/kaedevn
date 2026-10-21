// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// FKaedeKscSession.cpp — KSC の VM・ホスト・画面状態を束ねた再生セッション。
//
// JSON シナリオ側の FKaedePlaySession に相当する KSC 版。widget（SKaedeKscPlayWidget）が
// 触るのはこのクラスだけで済むようにするための層。
// IR.json を読み込んで VM を回し、本文枠のツリーは本編と同じ BuildPlayTree で作る
// （＝KSC でも見た目が本編と揃う）。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "FKaedeKscSession.h"

#include "KaedeVnCore.h"           // KaedeCore::BuildPlayTree
#include "kaedevn/ksc/IRLoader.hpp"      // kaedevn::ksc::load_ir_from_json
#include "HAL/PlatformTime.h"

using kaedevn::ksc::VMStatus;

bool FKaedeKscSession::StartFromIrJson(const std::string& IrJson)
{
	kaedevn::ksc::LoadResult Res = kaedevn::ksc::load_ir_from_json(IrJson);
	if (!Res.ok) return false;

	Stop();
	Module = std::move(Res.module);
	Vm = std::make_unique<kaedevn::ksc::KscVM>(Module, &Host);
	bStarted = true;
	FocusedChoice = 0;

	DriveVm();   // 最初の非同期 op（Awaiting）まで同期実行を進める。
	return true;
}

void FKaedeKscSession::Stop()
{
	Vm.reset(); // VM borrows Module; release it before replacing Module.
	Host.ResetPending();
	Handler.CancelPendingCommands(); // Retain camera, images and in-flight fades between ADV batches.
	bStarted = false;
}

void FKaedeKscSession::DriveVm()
{
	if (!Vm) return;
	const double Deadline = FPlatformTime::Seconds() + 0.002;
	for (int32 Step = 0; Step < (bDrainImmediateOps ? 256 : 1); ++Step)
	{
		// 直前の非同期 op が完了していれば、その結果で resume する。
		if (Vm->status() == VMStatus::Awaiting && Host.IsPendingDone())
		{
			Vm->resume(Host.TakePendingResult());
		}

		// Ready/Running の間、次の yield（Awaiting）/ Done / Errored まで回す。
		const VMStatus S = Vm->status();
		if (S == VMStatus::Ready || S == VMStatus::Running)
		{
			Vm->run();
		}
		if (Vm->status() != VMStatus::Awaiting || !Host.IsPendingDone() || FPlatformTime::Seconds() >= Deadline) break;
	}
}

void FKaedeKscSession::Tick(float DeltaMs)
{
	if (!bStarted || !Vm) return;

	Handler.update(DeltaMs);   // タイプライター/待ちタイマーを進め、完了 cb を発火しうる。
	DriveVm();

	// フォーカスを有効範囲に保つ（選択肢が無ければ 0）。
	const int32 N = NumChoices();
	if (!IsWaitingForChoice() || N <= 0) FocusedChoice = 0;
	else FocusedChoice = FMath::Clamp(FocusedChoice, 0, N - 1);
}

void FKaedeKscSession::HandleClick()
{
	if (!bStarted || !Vm) return;
	Handler.handleClick();   // 待機中の click callback を発火 → Host.bPendingDone
	DriveVm();               // resume して次の待機まで進める。
}

void FKaedeKscSession::SelectChoice(int32 Index)
{
	if (!bStarted || !Vm) return;
	Handler.selectChoice(Index);   // showChoices の IntCallback を発火（選択 index を resume 値に）。
	FocusedChoice = 0;
	DriveVm();
}

void FKaedeKscSession::FocusNext()
{
	const int32 N = NumChoices();
	if (IsWaitingForChoice() && N > 0) FocusedChoice = (FocusedChoice + 1) % N;
}

void FKaedeKscSession::FocusPrev()
{
	const int32 N = NumChoices();
	if (IsWaitingForChoice() && N > 0) FocusedChoice = (FocusedChoice - 1 + N) % N;
}

void FKaedeKscSession::SetFocus(int32 Index)
{
	const int32 N = NumChoices();
	if (IsWaitingForChoice() && N > 0) FocusedChoice = FMath::Clamp(Index, 0, N - 1);
}

void FKaedeKscSession::Confirm()
{
	if (!bStarted) return;
	if (IsWaitingForChoice()) SelectChoice(FocusedChoice);
	else HandleClick();
}

bool FKaedeKscSession::IsFinished() const
{
	return Vm && (Vm->status() == VMStatus::Done || Vm->status() == VMStatus::Errored);
}

bool FKaedeKscSession::IsErrored() const
{
	return Vm && Vm->status() == VMStatus::Errored;
}

std::string FKaedeKscSession::ErrorMessage() const
{
	return Vm ? Vm->error().message : std::string();
}

kaedevn::ui::UiNode FKaedeKscSession::CurrentTree() const
{
	return KaedeCore::BuildPlayTree(Handler.State(), bCompactLayout, LogicalW, LogicalH);
}
