// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KSC の VM の状態保存（deserializeState の範囲の確認）と IR の読み込み（壊れた IR）の単体テスト。
// ワールドもエディタの画面も使わない（KscVM と IRLoader だけ）。
// 実行: UnrealEditor-Cmd <proj> -ExecCmds="Automation RunTests Kaede.Ksc; Quit" -unattended -nullrhi

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "kaedevn/ksc/IRLoader.hpp"
#include "kaedevn/ksc/KscVM.hpp"

#include <string>

namespace
{
	// 関数 2 つ（$main は 2 命令・sub は 1 命令）の小さな IR。
	const char* const kTinyIr = R"JSON(
{"constants":[7],"functions":[
 {"name":"$main","paramCount":0,"paramNames":[],"localCount":0,"instructions":[{"op":"LOAD_CONST","operand":0},{"op":"RET"}]},
 {"name":"sub","paramCount":0,"paramNames":[],"localCount":0,"instructions":[{"op":"RET"}]}
],"entryPoint":0,"switchTables":[],"sourceMap":[[0,1]]}
)JSON";

	std::string Frame(const std::string& FuncIndex, const std::string& Pc)
	{
		return R"({"stack":[],"callStack":[{"funcIndex":)" + FuncIndex + R"(,"pc":)" + Pc
			+ R"(,"locals":{}}],"globals":{},"currentLine":0,"status":"Ready"})";
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKscVmStateBoundsTest, "Kaede.Ksc.VmStateBounds",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKscVmStateBoundsTest::RunTest(const FString& Parameters)
{
	using namespace kaedevn::ksc;
	const LoadResult Ir = load_ir_from_json(kTinyIr);
	if (!TestTrue(TEXT("小さな IR を読める"), Ir.ok)) return false;

	// 1) 正しい範囲は読める（pc == 命令の数 は「関数の終わり」で正しい）
	{
		KscVM Vm(Ir.module);
		TestTrue(TEXT("main の先頭"), Vm.deserializeState(Frame("0", "0")));
		TestTrue(TEXT("main の終わり"), Vm.deserializeState(Frame("0", "2")));
		TestTrue(TEXT("sub の終わり"), Vm.deserializeState(Frame("1", "1")));
		TestEqual(TEXT("終わりから進めると終了"), (int32)Vm.run(), (int32)VMStatus::Done);
	}

	// 2) 範囲外・型違いは false で、VM の状態は変わらない
	const struct { const char* Name; std::string Json; } Bad[] = {
		{"funcIndex が関数の数", Frame("2", "0")},
		{"funcIndex が負", Frame("-1", "0")},
		{"pc が命令の数を超える", Frame("0", "3")},
		{"pc が負", Frame("1", "-1")},
		{"pc が小数", Frame("0", "0.5")},
		{"pc が文字列", Frame("0", "\"1\"")},
		{"funcIndex が巨大", Frame("4294967296", "0")},
		{"根がオブジェクトでない", "[1,2]"},
		{"currentLine が文字列", R"({"callStack":[],"currentLine":"x"})"},
		{"instructionCount が文字列", R"({"callStack":[],"instructionCount":"x"})"},
	};
	KscVM Vm(Ir.module);
	TestTrue(TEXT("始めの状態"), Vm.deserializeState(Frame("0", "0")));
	const std::string Before = Vm.serializeState();
	for (const auto& B : Bad)
	{
		bool bOk = true;
		try { bOk = Vm.deserializeState(B.Json); }
		catch (...) { AddError(FString::Printf(TEXT("例外を投げた: %s"), UTF8_TO_TCHAR(B.Name))); }
		TestFalse(FString::Printf(TEXT("断る: %s"), UTF8_TO_TCHAR(B.Name)), bOk);
		TestTrue(FString::Printf(TEXT("断った後も状態はそのまま: %s"), UTF8_TO_TCHAR(B.Name)), Vm.serializeState() == Before);
	}

	// 3) 断った後もそのまま走れる（配列の外を読まない）
	TestEqual(TEXT("走り切る"), (int32)Vm.run(), (int32)VMStatus::Done);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKscIrLoaderBadInputTest, "Kaede.Ksc.IrLoaderBadInput",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKscIrLoaderBadInputTest::RunTest(const FString& Parameters)
{
	using namespace kaedevn::ksc;
	TestTrue(TEXT("正しい IR は読める"), load_ir_from_json(kTinyIr).ok);

	// 壊れた IR は ok=false（noexcept の関数から例外が漏れると std::terminate で落ちる）
	const struct { const char* Name; const char* Json; } Bad[] = {
		{"op が数", R"({"functions":[{"instructions":[{"op":5}]}]})"},
		{"op が null", R"({"functions":[{"instructions":[{"op":null}]}]})"},
		{"sourceMap の値が文字列", R"({"functions":[],"sourceMap":[["a",1]]})"},
		{"sourceMap の値が小数", R"({"functions":[],"sourceMap":[[0.5,1]]})"},
		{"sourceMap の値が null", R"({"functions":[],"sourceMap":[[0,null]]})"},
		{"根が配列", R"([1,2])"},
		{"根が数", R"(5)"},
		{"entryPoint が文字列", R"({"entryPoint":"x","functions":[]})"},
		{"関数名が数", R"({"functions":[{"name":3,"instructions":[]}]})"},
		{"switch の既定が文字列", R"({"functions":[],"switchTables":[{"defaultTarget":"x"}]})"},
		{"functions が無い", R"({})"},
		{"JSON でない", R"({"functions":)"},
	};
	for (const auto& B : Bad)
	{
		const LoadResult R = load_ir_from_json(B.Json);
		TestFalse(FString::Printf(TEXT("断る: %s"), UTF8_TO_TCHAR(B.Name)), R.ok);
		TestFalse(FString::Printf(TEXT("理由がある: %s"), UTF8_TO_TCHAR(B.Name)), R.errorMessage.empty());

		// 同じ中身を CBOR にしても断る
		const std::vector<std::uint8_t> Cbor = encode_ir_to_cbor(B.Json);
		if (!Cbor.empty())
		{
			TestFalse(FString::Printf(TEXT("CBOR でも断る: %s"), UTF8_TO_TCHAR(B.Name)), load_ir_from_cbor(Cbor.data(), Cbor.size()).ok);
		}
	}
	TestFalse(TEXT("空の入力"), load_ir_auto(nullptr, 0).ok);
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
