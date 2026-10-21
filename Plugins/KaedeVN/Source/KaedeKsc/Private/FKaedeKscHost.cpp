// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// FKaedeKscHost.cpp — KSC VM の組み込み関数呼び出しを IOpHandler へ橋渡しする。
//
// KSC（kaedevn 独自スクリプト）の VM は engine 非依存で、画面を知らない。
// VM が `showText` `setBg` `playBgm` … を呼んだとき、それを既存の Op ハンドラへ
// 翻訳するのがこのファイル。名前で分岐する素朴な作り。
//
// execOp（KS のシーンコマンド行）の表示系 Op は DispatchDisplayOp に渡す。JSON シナリオの
// OpRunner も同じ関数を使うので、表示系の Op を足すのは DispatchDisplayOp だけでよい。
//
// 非同期の呼び出しは BeginAsync が返す完了の関数で VM を待たせる。完了の関数は始めたときの
// 世代番号を持ち、ResetPending の後（別の batch）に古い待ちが終わっても何もしない。
// 同期の呼び出し（setBg・showChar 等）は待ちを立てず Continue() を返すだけ。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "FKaedeKscHost.h"

#include <cctype>

#include <nlohmann/json.hpp>

#include "DispatchDisplayOp.hpp"   // kaedevn::DispatchDisplayOp（KaedeCore engine/）
#include "IOpHandler.hpp"          // kaedevn::IOpHandler
#include "Op.hpp"                  // kaedevn::Op / opTypeFromString

using kaedevn::ksc::Value;
using kaedevn::ksc::VMResult;
using kaedevn::ksc::VMResultType;
using kaedevn::ksc::make_null;
using kaedevn::ksc::make_bool;
using kaedevn::ksc::make_number;

namespace {

// CONTINUE 即返し（同期呼び出し）。
inline VMResult Continue(Value v = make_null()) {
	VMResult r;
	r.type  = VMResultType::CONTINUE;
	r.value = std::move(v);
	return r;
}

// position 文字列を left/center/right に正規化（KscHostAdapter.normalizePosition 相当）。
std::string NormalizePosition(const std::string& pos) {
	std::string lower;
	lower.reserve(pos.size());
	for (char c : pos) lower.push_back((char)std::tolower((unsigned char)c));
	if (lower == "left")  return "left";
	if (lower == "right") return "right";
	return "center";
}

// Value → 文字列（プリミティブのみ。null→""）。
std::string ValueToString(const Value& v) {
	if (kaedevn::ksc::is_string(v)) return std::get<std::string>(v);
	if (kaedevn::ksc::is_number(v)) {
		// 整数はそのまま、少数は既定表現。VN 用途では主に整数。
		double d = std::get<double>(v);
		if (d == (double)(long long)d) return std::to_string((long long)d);
		return std::to_string(d);
	}
	if (kaedevn::ksc::is_bool(v)) return std::get<bool>(v) ? "true" : "false";
	return "";
}

// Value(array|string) → 行の配列（KscHostAdapter.valueToStringArray 相当）。
std::vector<std::string> ValueToStringArray(const Value& v) {
	std::vector<std::string> out;
	if (kaedevn::ksc::is_array(v)) {
		const auto& arr = std::get<kaedevn::ksc::ArrayPtr>(v);
		if (arr) {
			for (const auto& e : arr->elements) out.push_back(ValueToString(e));
		}
		return out;
	}
	out.push_back(ValueToString(v));
	return out;
}

} // namespace

// =============================================================================
// arg ヘルパ
// =============================================================================

std::string FKaedeKscHost::ArgStr(const std::vector<Value>& a, std::size_t i) {
	if (i < a.size()) return ValueToString(a[i]);
	return "";
}

double FKaedeKscHost::ArgNum(const std::vector<Value>& a, std::size_t i, double def) {
	if (i < a.size() && kaedevn::ksc::is_number(a[i])) return std::get<double>(a[i]);
	return def;
}

bool FKaedeKscHost::ArgIsNull(const std::vector<Value>& a, std::size_t i) {
	return i >= a.size() || kaedevn::ksc::is_null(a[i]);
}

// =============================================================================
// pending 管理
// =============================================================================

FKaedeKscHost::FDone FKaedeKscHost::BeginAsync() {
	bPending      = true;
	bPendingDone  = false;
	PendingResult = make_null();
	const uint64_t StartedGeneration = Generation;
	return [this, StartedGeneration]() { Complete(StartedGeneration, make_null()); };
}

void FKaedeKscHost::Complete(uint64_t StartedGeneration, Value Result) {
	if (StartedGeneration != Generation) return;   // 中断・作り直しの後に届いた古い完了
	PendingResult = std::move(Result);
	bPendingDone = true;
}

Value FKaedeKscHost::TakePendingResult() {
	Value v = PendingResult;
	bPending      = false;
	bPendingDone  = false;
	PendingResult = make_null();
	return v;
}

// =============================================================================
// HostAPI::call
// =============================================================================

VMResult FKaedeKscHost::call(const std::string& name, const std::vector<Value>& args) {
	// ===== KS シーンコマンド行（execOp: Op JSON → DispatchDisplayOp）=====
	if (name == "execOp") {
		const std::string js = ArgStr(args, 0);
		nlohmann::json j = nlohmann::json::parse(js, nullptr, /*allow_exceptions=*/false);
		if (j.is_discarded() || !j.is_object() || !j.contains("op")) {
			// 壊れた op JSON: pending なしで即継続。
			return Continue();
		}
		kaedevn::Op op;
		op.type = kaedevn::opTypeFromString(j.value("op", std::string("")));
		op.data = j;

		if (OnDisplayOp) OnDisplayOp(js);
		// TEXT_APPEND は DispatchDisplayOp の対象外（OpRunner では read フラグが pc に結びつくため）。
		// KSC に read フラグは無いので、同期で handler へ直接渡す。
		if (op.type == kaedevn::OpType::TEXT_APPEND) {
			Handler.textAppend(j.value("who", std::string()), j.value("text", std::string()));
			return Continue();
		}
		const FDone Done = BeginAsync();
		if (!kaedevn::DispatchDisplayOp(op, Handler, Done)) {
			// pc 結合・未知 op はここでは扱えない。完了扱いにして先へ。
			Done();
		}
		return Continue();
	}

	// ===== Dialogue =====
	if (name == "showDialogue") { MapShowDialogue(args); return Continue(); }

	// ===== Background =====
	if (name == "setBg") {
		const std::string id     = ArgStr(args, 0);
		const std::string effect = ArgIsNull(args, 1) ? "" : ArgStr(args, 1);
		int   fadeMs = 0;
		std::string bgEffect = "fade";
		if (effect == "fade")             { fadeMs = 500; bgEffect = "fade"; }
		else if (effect == "slide_left")  { fadeMs = 500; bgEffect = "slide_left"; }
		else if (effect == "slide_right") { fadeMs = 500; bgEffect = "slide_right"; }
		Handler.bgSet(id, fadeMs, bgEffect, 0.0f, 0.0f, 1.0f);
		return Continue();
	}

	// ===== Character =====
	if (name == "showChar") {
		const std::string chName = ArgStr(args, 0);
		const std::string pose   = ArgStr(args, 1);
		const std::string pos    = NormalizePosition(ArgIsNull(args, 2) ? "center" : ArgStr(args, 2));
		const int fadeMs = ArgIsNull(args, 3) ? 0 : (int)ArgNum(args, 3);
		Handler.chSet(chName, pose, pos, fadeMs, 0.0f, 0.0f, 1.0f);
		return Continue();
	}
	if (name == "showCharAnim") {
		// UE IOpHandler に chAnim は無いため静止ポーズ（chSet）へ縮退。
		const std::string chName = ArgStr(args, 0);
		const std::string pose   = ArgStr(args, 1);
		const std::string pos    = NormalizePosition(ArgStr(args, 2));
		Handler.chSet(chName, pose, pos, 0, 0.0f, 0.0f, 1.0f);
		return Continue();
	}
	if (name == "hideChar") {
		const std::string chName = ArgStr(args, 0);
		const int fadeMs = ArgIsNull(args, 1) ? 0 : (int)ArgNum(args, 1);
		Handler.chHide(chName, fadeMs);
		return Continue();
	}
	if (name == "clearChars") {
		const int fadeMs = ArgIsNull(args, 0) ? 0 : (int)ArgNum(args, 0);
		Handler.chClear(fadeMs);
		return Continue();
	}
	if (name == "moveChar") {
		// moveChar(name, position, time)。CH_MOVE と同じく、移動は handler の update() が進めるので
		// 待たずに次へ進む（移動中も本文を送れる）。
		const std::string chName = ArgStr(args, 0);
		const std::string pos    = NormalizePosition(ArgStr(args, 1));
		Handler.chMove(chName, pos, (int)ArgNum(args, 2, 300.0), 0.0f, 0.0f);
		return Continue();
	}

	// ===== Audio (sync) =====
	if (name == "playBgm") {
		Handler.bgmPlay(ArgStr(args, 0), (float)ArgNum(args, 1, 1.0), (int)ArgNum(args, 2, 0.0));
		return Continue();
	}
	if (name == "stopBgm") { Handler.bgmStop(0); return Continue(); }
	if (name == "playSe")  { Handler.sePlay(ArgStr(args, 0), (float)ArgNum(args, 1, 1.0)); return Continue(); }
	if (name == "playVoice"){ Handler.voicePlay(ArgStr(args, 0)); return Continue(); }
	if (name == "fadeBgm") { Handler.bgmStop((int)ArgNum(args, 0, 0.0)); return Continue(); }

	// ===== Wait =====
	if (name == "wait") {
		Handler.waitMs((int)ArgNum(args, 0, 0.0), BeginAsync());
		return Continue();
	}
	if (name == "waitForClick" || name == "waitClick") {
		Handler.waitClick(BeginAsync());
		return Continue();
	}
	if (name == "newLine") {
		Handler.textNl();   // 同期。AWAIT が続いても session が即 resume。
		return Continue();
	}
	if (name == "pageClear") {
		Handler.page(BeginAsync());
		return Continue();
	}

	// ===== Choice =====
	if (name == "showChoice") { MapShowChoice(args); return Continue(); }

	// ===== Flag (sync) =====
	if (name == "setFlag") {
		const std::string key = ArgStr(args, 0);
		Flags[key] = (args.size() > 1) ? args[1] : make_null();
		return Continue();
	}
	if (name == "getFlag") {
		auto it = Flags.find(ArgStr(args, 0));
		return Continue(it != Flags.end() ? it->second : make_null());
	}

	// ===== Inventory (sync) =====
	if (name == "giveItem") {
		Inventory[ArgStr(args, 0)] += ArgNum(args, 1, 1.0);
		return Continue();
	}
	if (name == "takeItem") {
		const std::string id  = ArgStr(args, 0);
		const double      amt = ArgNum(args, 1, 1.0);
		auto it = Inventory.find(id);
		const bool ok = (it != Inventory.end() && it->second >= amt);
		if (ok) it->second -= amt;
		return Continue(make_bool(ok));
	}
	if (name == "hasItem") {
		auto it = Inventory.find(ArgStr(args, 0));
		return Continue(make_bool(it != Inventory.end() && it->second > 0.0));
	}

	// ===== Screen filter (sync) =====
	if (name == "screenFilter" || name == "filter") {
		Handler.screenFilter(ArgStr(args, 0), (float)ArgNum(args, 1, 1.0), {});
		return Continue();
	}
	if (name == "screenFilterClear" || name == "filter_clear") {
		Handler.screenFilterClear();
		return Continue();
	}

	// ===== Shake (async) =====
	if (name == "shake") {
		Handler.shake((float)ArgNum(args, 0, 5.0), (int)ArgNum(args, 1, 300.0), BeginAsync());
		return Continue();
	}

	// 未知 HOST_CALL: 何もせず継続（VN 非対応の builtin は Web の fallback 相当）。
	return Continue();
}

// =============================================================================
// Dialogue / Choice マッピング
// =============================================================================

void FKaedeKscHost::MapShowDialogue(const std::vector<Value>& args) {
	const std::string speaker = ArgStr(args, 0);
	const std::vector<std::string> lines = ValueToStringArray(args.size() > 1 ? args[1] : make_null());

	std::string text;
	for (std::size_t i = 0; i < lines.size(); ++i) {
		if (i) text += '\n';
		text += lines[i];
	}

	// TS: await textAppend; await waitClick。C++ は textAppend 同期 → waitClick 非同期。
	Handler.textAppend(speaker, text);
	Handler.waitClick(BeginAsync());
}

void FKaedeKscHost::MapShowChoice(const std::vector<Value>& args) {
	std::vector<std::string> labels;
	if (!args.empty() && kaedevn::ksc::is_array(args[0])) {
		const auto& arr = std::get<kaedevn::ksc::ArrayPtr>(args[0]);
		if (arr) {
			for (const auto& elem : arr->elements) {
				if (kaedevn::ksc::is_object(elem)) {
					const auto& obj = std::get<kaedevn::ksc::ObjectPtr>(elem);
					std::string label;
					if (obj) {
						auto it = obj->fields.find("text");
						if (it != obj->fields.end()) label = ValueToString(it->second);
					}
					labels.push_back(label);
				} else {
					labels.push_back(ValueToString(elem));
				}
			}
		}
	}

	// showChoices の完了で選択 index を resume 値として返す（KSC 側が index で分岐）。
	BeginAsync();
	const uint64_t StartedGeneration = Generation;
	Handler.showChoices(labels, [this, StartedGeneration](int selected) {
		Complete(StartedGeneration, make_number((double)selected));
	});
}
