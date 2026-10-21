// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// 条件式（evalCondExpr）と JUMP_IF の分岐テスト。
// 実行: UnrealEditor-Cmd <proj> -ExecCmds="Automation RunTests Kaede.Runtime.Cond; Quit" -unattended -nullrhi
//
// 文法の上限は意図的: ループも関数も無いので分岐は静的に全ルート列挙できる（分岐QAの前提）。
// 台本言語は KS。KSC（本格スクリプト言語）は台本の代替にしない方針。

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "KaedePlaySession.h"
#include "ui/Interp.hpp"

#include <map>
#include <string>

namespace
{
	// 固定の変数表から解決する VarEnv。未登録キーは「未設定」= 0 扱い。
	kaedevn::ui::VarEnv MakeEnv(const std::map<std::string, double>& Vars)
	{
		kaedevn::ui::VarEnv Env;
		Env.resolveNum = [Vars](const std::string& Key, double& Out) -> bool
		{
			const auto It = Vars.find(Key);
			if (It == Vars.end()) return false;
			Out = It->second;
			return true;
		};
		return Env;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeCondExprTest, "Kaede.Runtime.Cond.Expr",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeCondExprTest::RunTest(const FString& Parameters)
{
	using kaedevn::ui::evalCondExpr;

	const kaedevn::ui::VarEnv Env = MakeEnv({
		{ "affection", 30.0 },
		{ "gold",       0.0 },
		{ "read_ch1",   1.0 },
	});

	// ---- 後方互換: 変数名だけの旧形式は truthy 判定のまま ----
	TestTrue (TEXT("bare var truthy"),        evalCondExpr("read_ch1", Env));
	TestFalse(TEXT("bare var zero is false"), evalCondExpr("gold", Env));
	TestFalse(TEXT("unknown var is false"),   evalCondExpr("no_such_var", Env));
	TestFalse(TEXT("empty expr is false"),    evalCondExpr("", Env));

	// ---- 比較演算子（今回の主目的）----
	TestTrue (TEXT(">= true"),  evalCondExpr("affection >= 30", Env));
	TestFalse(TEXT(">= false"), evalCondExpr("affection >= 31", Env));
	TestTrue (TEXT("> true"),   evalCondExpr("affection > 29", Env));
	TestFalse(TEXT("> false"),  evalCondExpr("affection > 30", Env));
	TestTrue (TEXT("<= true"),  evalCondExpr("gold <= 0", Env));
	TestTrue (TEXT("< true"),   evalCondExpr("gold < 1", Env));
	TestTrue (TEXT("== true"),  evalCondExpr("affection == 30", Env));
	TestFalse(TEXT("== false"), evalCondExpr("affection == 31", Env));
	TestTrue (TEXT("!= true"),  evalCondExpr("affection != 31", Env));
	TestFalse(TEXT("!= false"), evalCondExpr("affection != 30", Env));
	// 負数リテラルと小数。
	TestTrue (TEXT("negative literal"), evalCondExpr("gold > -1", Env));
	TestTrue (TEXT("decimal literal"),  evalCondExpr("affection >= 29.5", Env));
	// 未設定変数は 0 として比較される（未設定と 0 は区別しない = 旧仕様と同じ）。
	TestTrue (TEXT("unknown var compares as 0"), evalCondExpr("no_such_var == 0", Env));

	// ---- 論理合成 ----
	TestTrue (TEXT("&& both true"),  evalCondExpr("affection >= 30 && read_ch1", Env));
	TestFalse(TEXT("&& one false"),  evalCondExpr("affection >= 30 && gold > 0", Env));
	TestTrue (TEXT("|| one true"),   evalCondExpr("gold > 0 || affection >= 30", Env));
	TestFalse(TEXT("|| both false"), evalCondExpr("gold > 0 || affection > 99", Env));

	// 優先順位 && > ||: (false && false) || true = true
	TestTrue(TEXT("&& binds tighter than ||"),
		evalCondExpr("gold > 0 && affection > 99 || read_ch1", Env));

	// ---- 否定 ----
	TestTrue (TEXT("! on falsy var"),   evalCondExpr("!gold", Env));
	TestFalse(TEXT("! on truthy var"),  evalCondExpr("!read_ch1", Env));
	TestTrue (TEXT("! on comparison"),  evalCondExpr("!(affection > 99)", Env));
	// "!=" を否定として食わないこと（回帰の要）。
	TestTrue (TEXT("!= not parsed as negation"), evalCondExpr("affection != 31", Env));
	TestTrue (TEXT("!= inside &&"),              evalCondExpr("affection != 31 && read_ch1", Env));

	// ---- 括弧 ----
	TestTrue (TEXT("parens change grouping"),
		evalCondExpr("(gold > 0 || affection >= 30) && read_ch1", Env));
	TestFalse(TEXT("parens change grouping (false)"),
		evalCondExpr("(gold > 0 || affection > 99) && read_ch1", Env));
	TestTrue (TEXT("nested parens"),
		evalCondExpr("!((gold > 0) && (read_ch1))", Env));

	// ---- 壊れた式は例外を投げず偽に倒れる（台本の打ち間違いでクラッシュさせない）----
	TestFalse(TEXT("dangling && is false"), evalCondExpr("gold > 0 &&", Env));
	TestFalse(TEXT("empty parens is false"), evalCondExpr("()", Env));
	TestTrue (TEXT("unclosed paren is tolerated"), evalCondExpr("(read_ch1", Env));

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeJumpIfTest, "Kaede.Runtime.Cond.JumpIf",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeJumpIfTest::RunTest(const FString& Parameters)
{
	// pc: 0=VAR_SET 1=JUMP_IF 2=TEXT(LOW) 3=JUMP(5) 4=TEXT(HIGH) 5=WAIT_CLICK
	// 本文は ASCII 固定（ソースの文字コードに依存させない）。
	auto MakeScenario = [](const char* Value, const char* Cond) -> std::string
	{
		std::string J = R"({"id":"t","ops":[)";
		J += std::string(R"({"op":"VAR_SET","name":"affection","value":)") + Value + "},";
		J += std::string(R"({"op":"JUMP_IF","condition":")") + Cond + R"(","pc":4},)";
		J += R"({"op":"TEXT_APPEND","who":"","text":"LOW"},)";
		J += R"({"op":"JUMP","pc":5},)";
		J += R"({"op":"TEXT_APPEND","who":"","text":"HIGH"},)";
		J += R"({"op":"WAIT_CLICK"}]})";
		return J;
	};

	auto RunAndGetText = [&](const std::string& Json) -> FString
	{
		FKaedePlaySession S;
		if (!S.StartFromJson(Json)) return FString(TEXT("<start failed>"));
		S.Tick(5000.0f);   // タイプライターを最後まで進める
		return S.State().text.has_value()
			? FString(UTF8_TO_TCHAR(S.State().text->content.c_str()))
			: FString();
	};

	// 比較が成立 → then 側（HIGH）へ飛ぶ。
	TestEqual(TEXT("comparison true takes jump"),
		RunAndGetText(MakeScenario("30", "affection >= 30")), FString(TEXT("HIGH")));

	// 比較が不成立 → 直下（LOW）へ落ちる。
	TestEqual(TEXT("comparison false falls through"),
		RunAndGetText(MakeScenario("10", "affection >= 30")), FString(TEXT("LOW")));

	// 論理合成。
	TestEqual(TEXT("compound && true"),
		RunAndGetText(MakeScenario("30", "affection >= 30 && affection != 99")), FString(TEXT("HIGH")));
	TestEqual(TEXT("compound && false"),
		RunAndGetText(MakeScenario("30", "affection >= 30 && affection == 99")), FString(TEXT("LOW")));

	// 旧形式（変数名だけ）が壊れていないこと。
	TestEqual(TEXT("legacy bare var truthy"),
		RunAndGetText(MakeScenario("1", "affection")), FString(TEXT("HIGH")));
	TestEqual(TEXT("legacy bare var zero"),
		RunAndGetText(MakeScenario("0", "affection")), FString(TEXT("LOW")));

	return true;
}

#endif  // WITH_DEV_AUTOMATION_TESTS
