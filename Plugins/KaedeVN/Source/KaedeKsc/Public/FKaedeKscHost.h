// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

// FKaedeKscHost — KSC VM の HostAPI を KaedeCore の IOpHandler へ橋渡しするアダプタ。
// monorepo の packages/web/src/engine/KscHostAdapter.ts の C++/UE 版（VN 主要サブセット）。
//
// 非同期モデル（TS の Promise → C++ の「pending + poll」）:
//   - HostAPI::call は同期。ブロッキング系（waitClick/showChoice/execOp 等）は
//     handler の完了コールバックを仕掛けて bPending を立て、CONTINUE を返す。
//   - VM は各非同期 HOST_CALL の直後に AWAIT で yield（Awaiting）。
//   - session（FKaedeKscSession）が毎フレーム IsPendingDone() を polling し、
//     完了したら TakePendingResult() の値で vm.resume() する。
//   - 同期系（playBgm/setFlag 等）は即 CONTINUE（AWAIT を伴わない or 即 resolve）。

#include <string>
#include <functional>
#include <unordered_map>
#include <vector>

#include "kaedevn/ksc/HostAPI.hpp"
#include "kaedevn/ksc/Value.hpp"

namespace kaedevn { class IOpHandler; }

class FKaedeKscHost : public kaedevn::ksc::HostAPI
{
public:
	explicit FKaedeKscHost(kaedevn::IOpHandler& InHandler) : Handler(InHandler) {}

	kaedevn::ksc::VMResult call(const std::string& name,
	                            const std::vector<kaedevn::ksc::Value>& args) override;

	// ===== session 用: 非同期 pending の polling =====
	// VM が Awaiting のとき、この非同期 op が完了したか。pending が無ければ true。
	bool IsPendingDone() const { return !bPending || bPendingDone; }
	// pending 結果を取り出し pending をクリアする（vm.resume に渡す値）。
	kaedevn::ksc::Value TakePendingResult();
	// Invalidate callbacks before reusing the host for another in-memory batch.
	void ResetPending() { ++Generation; bPending = false; bPendingDone = false; PendingResult = {}; }
	// Optional observer for display batches (including immediately completed ops).
	std::function<void(const std::string&)> OnDisplayOp;

private:
	kaedevn::IOpHandler& Handler;

	// flags / inventory は最小 in-memory 実装（monorepo FlagSystem/InventorySystem 相当）。
	std::unordered_map<std::string, kaedevn::ksc::Value> Flags;
	std::unordered_map<std::string, double>              Inventory;

	// 非同期 pending 状態
	bool                bPending     = false;
	bool                bPendingDone = false;
	kaedevn::ksc::Value PendingResult;
	uint64_t Generation = 0;

	// ブロッキング開始: pending を立て結果を null に初期化し、完了を知らせる関数を返す。
	// 返す関数は始めたときの Generation を持ち、ResetPending の後に呼ばれても何もしない。
	using FDone = std::function<void()>;
	FDone BeginAsync();
	// 待ちの完了（結果つき）。StartedGeneration が今の Generation と違えば捨てる。
	void Complete(uint64_t StartedGeneration, kaedevn::ksc::Value Result);

	// ---- arg ヘルパ ----
	static std::string ArgStr(const std::vector<kaedevn::ksc::Value>& a, std::size_t i);
	static double      ArgNum(const std::vector<kaedevn::ksc::Value>& a, std::size_t i, double def = 0.0);
	static bool        ArgIsNull(const std::vector<kaedevn::ksc::Value>& a, std::size_t i);

	// showDialogue / showChoice のマッピング（KscHostAdapter の private メソッド相当）。
	void MapShowDialogue(const std::vector<kaedevn::ksc::Value>& args);
	void MapShowChoice(const std::vector<kaedevn::ksc::Value>& args);
};
