// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KscVnPlaythroughTest — KSC生成物をUEで実際に走らせる end-to-end 検証（増分2の実プレイ検証）。
//
// TS ksc-compiler が出した IR.json（VN: setBg/showChar/showDialogue/showChoice→分岐/if-else）を
// FKaedeKscSession で駆動し、産出テキスト・選択肢・分岐・終了を action列で検証する。
// 実行: UnrealEditor-Cmd <proj> -ExecCmds="Automation RunTests Kaedevn.Ksc.VnPlaythrough; Quit" -unattended -nullrhi
//
// IR は vn_ue_ascii.ksc（monorepo で node gen-vn-ir.mjs 生成）を埋め込み＝ソース文字コード非依存でヘルメティック。

// AutomationTest.h を先に無条件 include（WITH_AUTOMATION_TESTS を定義するのはこのヘッダ）。
#include "Misc/AutomationTest.h"
#include "KaedeKscLog.h"

#if WITH_AUTOMATION_TESTS

#include "FKaedeKscSession.h"

namespace
{
	// vn_ue_ascii.ksc → IR.json（ASCII）。以下の台本に対応:
	//   @bg bg01 / @ch hero smile center / # hero "Eat it?"
	//   sel = await engine.showChoice([{text:"Eat"},{text:"Skip"}])
	//   if (sel==0) # hero "Ate it." else # hero "Skipped."
	//   # "The End"
	const char* const kVnAsciiIr = R"JSON(
{"constants":["bg01","setBg","hero","smile","center","showChar","Eat it?","showDialogue","sel","text","Eat","Skip","showChoice",0,"Ate it.","Skipped.","","The End",null],"functions":[{"name":"$main","paramCount":0,"paramNames":[],"localCount":1,"instructions":[{"op":"DEBUG_LINE","operand":1},{"op":"LOAD_CONST","operand":0},{"op":"HOST_CALL","operand":1,"operand2":1},{"op":"AWAIT"},{"op":"POP"},{"op":"DEBUG_LINE","operand":2},{"op":"LOAD_CONST","operand":2},{"op":"LOAD_CONST","operand":3},{"op":"LOAD_CONST","operand":4},{"op":"HOST_CALL","operand":5,"operand2":3},{"op":"AWAIT"},{"op":"POP"},{"op":"DEBUG_LINE","operand":3},{"op":"LOAD_CONST","operand":2},{"op":"LOAD_CONST","operand":6},{"op":"HOST_CALL","operand":7,"operand2":2},{"op":"AWAIT"},{"op":"POP"},{"op":"DEBUG_LINE","operand":5},{"op":"LOAD_CONST","operand":9},{"op":"LOAD_CONST","operand":10},{"op":"MAKE_OBJECT","operand":1},{"op":"LOAD_CONST","operand":9},{"op":"LOAD_CONST","operand":11},{"op":"MAKE_OBJECT","operand":1},{"op":"MAKE_ARRAY","operand":2},{"op":"HOST_CALL","operand":12,"operand2":1},{"op":"AWAIT"},{"op":"DUP"},{"op":"STORE_VAR","operand":8},{"op":"POP"},{"op":"DEBUG_LINE","operand":7},{"op":"LOAD_VAR","operand":8},{"op":"LOAD_CONST","operand":13},{"op":"CMP_EQ"},{"op":"JMP_IF_FALSE","operand":43},{"op":"DEBUG_LINE","operand":8},{"op":"LOAD_CONST","operand":2},{"op":"LOAD_CONST","operand":14},{"op":"HOST_CALL","operand":7,"operand2":2},{"op":"AWAIT"},{"op":"POP"},{"op":"JMP","operand":49},{"op":"DEBUG_LINE","operand":10},{"op":"LOAD_CONST","operand":2},{"op":"LOAD_CONST","operand":15},{"op":"HOST_CALL","operand":7,"operand2":2},{"op":"AWAIT"},{"op":"POP"},{"op":"DEBUG_LINE","operand":13},{"op":"LOAD_CONST","operand":16},{"op":"LOAD_CONST","operand":17},{"op":"HOST_CALL","operand":7,"operand2":2},{"op":"AWAIT"},{"op":"POP"},{"op":"LOAD_CONST","operand":18},{"op":"RET"}]}],"entryPoint":0,"switchTables":[],"sourceMap":[[0,1],[5,2],[12,3],[18,5],[31,7],[36,8],[43,10],[49,13]]}
)JSON";

	FString Txt(const FKaedeKscSession& S)
	{
		return S.State().text.has_value()
			? FString(UTF8_TO_TCHAR(S.State().text->content.c_str()))
			: FString();
	}

	// 停止点（クリック待ち / 選択肢待ち / 終了）まで同期 op を消化する。
	void Settle(FKaedeKscSession& S)
	{
		for (int32 i = 0; i < 4000; ++i)
		{
			if (S.IsWaitingForChoice() || S.State().waitingForClick || S.IsFinished()) return;
			S.Tick(100000.0f);   // 大 dt でタイプライター/待ちタイマーを一気に進める
		}
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKscVnPlaythroughTest, "Kaede.Ksc.VnPlaythrough",
	EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FKscVnPlaythroughTest::RunTest(const FString& /*Parameters*/)
{
	FKaedeKscSession S;

	TestTrue(TEXT("IR.json ロード成功"), S.StartFromIrJson(std::string(kVnAsciiIr)));

	// 1) 最初の台詞 "Eat it?"（setBg/showChar は同期消化）
	Settle(S);
	UE_LOG(LogKaedeKsc, Display, TEXT("[KSC-VN] dialogue1: speaker=%s text=%s"),
		*FString(UTF8_TO_TCHAR(S.State().text.has_value() ? S.State().text->speaker.c_str() : "")), *Txt(S));
	TestTrue(TEXT("台詞1でクリック待ち"), S.State().waitingForClick);
	TestEqual(TEXT("台詞1本文"), Txt(S), FString(TEXT("Eat it?")));

	// 2) クリックで進め、選択肢待ちへ
	S.Tick(100000.0f);   // タイプライター完了（2クリック仕様の1回目を消化）
	S.HandleClick();     // 台詞送り
	Settle(S);
	TestTrue(TEXT("選択肢待ち"), S.IsWaitingForChoice());
	TestEqual(TEXT("選択肢数"), S.NumChoices(), 2);
	if (S.State().choices.has_value() && S.State().choices->labels.size() == 2)
	{
		const auto& L = S.State().choices->labels;
		UE_LOG(LogKaedeKsc, Display, TEXT("[KSC-VN] choices: [0]=%s [1]=%s"),
			*FString(UTF8_TO_TCHAR(L[0].c_str())), *FString(UTF8_TO_TCHAR(L[1].c_str())));
		TestEqual(TEXT("選択肢0"), FString(UTF8_TO_TCHAR(L[0].c_str())), FString(TEXT("Eat")));
		TestEqual(TEXT("選択肢1"), FString(UTF8_TO_TCHAR(L[1].c_str())), FString(TEXT("Skip")));
	}

	// 3) index 0 を選択 → sel==0 分岐 "Ate it."
	S.SelectChoice(0);
	Settle(S);
	UE_LOG(LogKaedeKsc, Display, TEXT("[KSC-VN] branch(sel=0): text=%s"), *Txt(S));
	TestTrue(TEXT("分岐後クリック待ち"), S.State().waitingForClick);
	TestEqual(TEXT("分岐本文(sel==0)"), Txt(S), FString(TEXT("Ate it.")));

	// 4) 続けて末尾台詞 "The End"
	S.Tick(100000.0f);
	S.HandleClick();
	Settle(S);
	UE_LOG(LogKaedeKsc, Display, TEXT("[KSC-VN] final: text=%s"), *Txt(S));
	TestEqual(TEXT("末尾本文"), Txt(S), FString(TEXT("The End")));

	// 5) 最後のクリックで終了（RET → Done）
	S.Tick(100000.0f);
	S.HandleClick();
	Settle(S);
	UE_LOG(LogKaedeKsc, Display, TEXT("[KSC-VN] finished=%d errored=%d err=%s"),
		S.IsFinished(), S.IsErrored(), *FString(UTF8_TO_TCHAR(S.ErrorMessage().c_str())));
	TestTrue(TEXT("シナリオ終了"), S.IsFinished());
	TestFalse(TEXT("VM エラー無し"), S.IsErrored());

	return true;
}

#endif // WITH_AUTOMATION_TESTS
