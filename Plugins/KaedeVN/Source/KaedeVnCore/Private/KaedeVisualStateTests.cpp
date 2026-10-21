// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// 演出状態の保存（SaveVisualState / RestoreVisualState）と、OpRunner の変数 Op の読み方の単体テスト。
// ワールドもエディタの画面も使わない（FKaedeOpHandler と OpRunner だけ）。
// 実行: UnrealEditor-Cmd <proj> -ExecCmds="Automation RunTests Kaede.VnCore; Quit" -unattended -nullrhi

#include "Misc/AutomationTest.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "FKaedeOpHandler.h"
#include "OpRunner.hpp"

namespace
{
	// 立ち絵・重ね絵・カメラ・マスク・揺れ・レイヤを全部動かした状態を作る。
	void FillVisuals(FKaedeOpHandler& H)
	{
		H.bgSet("bg01", 0, "fade", 0.f, 0.f, 1.f);
		H.cameraSet(true, 10.f, true, 20.f, true, 1.5f, 500, false);
		H.maskSet("#ff0000", 0.5f, 0);
		H.spriteSet("s1", "img01", "back", 1.f, 2.f, 1.f, 0);
		H.textSpriteSet("t1", "Hello", 3.f, 4.f, 30.f, "#00ff00", true, "front", 0);
		H.overlaySet("ov1", 0, 5.f, 6.f, 0.8f);
		H.layerSet("character", true, false, true, 0.3f);
		H.shake(4.f, 1000, [] {});
		H.update(100.f);
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeVisualStateRoundTripTest, "Kaede.VnCore.VisualStateRoundTrip",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeVisualStateRoundTripTest::RunTest(const FString& Parameters)
{
	using FJson = nlohmann::json;

	// 1) 保存した形は名前つきのオブジェクトで、読み戻すと同じものが保存される
	FKaedeOpHandler A;
	FillVisuals(A);
	const FJson Saved = A.SaveVisualState();
	TestTrue(TEXT("camera は名前つき"), Saved["camera"].is_object() && Saved["camera"].contains("zoom"));
	TestTrue(TEXT("mask は名前つき"), Saved["mask"].is_object() && Saved["mask"].contains("color"));
	TestTrue(TEXT("重ね絵は名前つき"), Saved["overlays"].size() == 1 && Saved["overlays"][0].is_object());
	TestTrue(TEXT("レイヤは名前つき"), Saved["layers"].contains("character") && Saved["layers"]["character"].is_object());

	FKaedeOpHandler B;
	TestTrue(TEXT("読み戻せる"), B.RestoreVisualState(Saved));
	TestTrue(TEXT("読み戻した後の保存が同じ"), B.SaveVisualState() == Saved);
	TestEqual(TEXT("立ち絵 2 枚"), (int32)B.Sprites().size(), 2);
	TestEqual(TEXT("マスクの色"), FString(UTF8_TO_TCHAR(B.MaskColor().c_str())), FString(TEXT("#ff0000")));
	TestEqual(TEXT("レイヤの不透明度"), B.LayerOpacity("character"), 0.3f);

	// 2) 古い位置決めの配列も読める
	const FJson Legacy = FJson::parse(R"({
		"background": "bg02",
		"backgroundTransition": ["bg01", "bg02", "fade", 0.5, 1000, 500],
		"camera": [1, 2, 2.0, 0, 0, 1, 1, 2, 2.0, 0, 0],
		"mask": ["#000000", 0.25, 0, 0.25, 0, 0],
		"shake": [0, 0, 0, 0],
		"fade": [0, false, 0, 0, 0],
		"transitionLayer": "",
		"sprites": [{"id": "s9", "storage": "img9", "order": 1, "isText": false, "text": "", "fontSize": 24,
			"color": "", "bold": false, "transform": [7, 8, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0]}],
		"overlays": [["ov9", 1, 2, 1, 1, 1, 0, 0]],
		"layers": {"overlay": [false, 0.5, 0, 0]}
	})");
	FKaedeOpHandler C;
	TestTrue(TEXT("古い配列の形を読める"), C.RestoreVisualState(Legacy));
	TestEqual(TEXT("古い形: 背景"), FString(UTF8_TO_TCHAR(C.State().bgId.c_str())), FString(TEXT("bg02")));
	TestEqual(TEXT("古い形: ズーム"), C.CameraZoom(), 2.0f);
	TestEqual(TEXT("古い形: マスク"), C.MaskAlpha(), 0.25f);
	TestTrue(TEXT("古い形: 立ち絵の位置"), C.Sprites().size() == 1 && C.Sprites()[0].x == 7.f && C.Sprites()[0].y == 8.f);
	TestTrue(TEXT("古い形: 重ね絵"), C.OverlayItems().size() == 1 && C.OverlayItems()[0].id == "ov9");
	TestFalse(TEXT("古い形: レイヤの表示"), C.LayerVisible("overlay"));
	TestTrue(TEXT("古い形: 背景の切り替え"), C.State().bgTransition.has_value() && C.State().bgTransition->toId == "bg02");

	// 3) 壊れたセーブは false を返し、今の見た目を変えない（例外を投げない）
	const FJson Before = B.SaveVisualState();
	const char* const Broken[] = {
		R"([1, 2, 3])",                                        // オブジェクトでない
		R"({"camera": [1, 2]})",                               // 古い配列が足りない
		R"({"camera": {"x": "left"}})",                        // 数でない
		R"({"camera": "zoom"})",                               // まとまりが値
		R"({"background": 5})",                                // 文字列でない
		R"({"fade": {"mode": 9}})",                            // 範囲外の種類
		R"({"sprites": {"id": "s1"}})",                        // 配列でない
		R"({"sprites": [{"id": "s1", "isText": "yes"}]})",     // bool でない
		R"({"overlays": [["ov1", 1]]})",                       // 古い配列が足りない
		R"({"layers": {"character": [true]}})",                // 古い配列が足りない
		R"({"backgroundTransition": ["a", "b"]})",             // 古い配列が足りない
	};
	for (const char* Text : Broken)
	{
		bool bOk = true;
		try { bOk = B.RestoreVisualState(FJson::parse(Text)); }
		catch (...) { AddError(FString::Printf(TEXT("例外を投げた: %s"), UTF8_TO_TCHAR(Text))); }
		TestFalse(FString::Printf(TEXT("壊れたセーブを断る: %s"), UTF8_TO_TCHAR(Text)), bOk);
		TestTrue(FString::Printf(TEXT("断った後も見た目はそのまま: %s"), UTF8_TO_TCHAR(Text)), B.SaveVisualState() == Before);
	}

	// 4) 鍵が欠けているだけなら既定値で読む
	FKaedeOpHandler D;
	TestTrue(TEXT("camera だけのセーブ"), D.RestoreVisualState(FJson::parse(R"({"camera": {"zoom": 3}})")));
	TestEqual(TEXT("欠けた鍵は既定値"), D.CameraZoom(), 3.0f);
	TestTrue(TEXT("立ち絵は空"), D.Sprites().empty());
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeOpRunnerVarValueTest, "Kaede.VnCore.OpRunnerVarValue",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeOpRunnerVarValueTest::RunTest(const FString& Parameters)
{
	using FJson = nlohmann::json;
	// 台本の書き損じ（値の鍵なし・数でない値・文字列の変数への加算）で tick() が例外を投げない
	kaedevn::CompiledScenario Sc;
	Sc.ops = {
		{kaedevn::OpType::VAR_SET, FJson{{"name", "a"}}},                       // value なし → null
		{kaedevn::OpType::VAR_SET, FJson{{"name", "s"}, {"value", "text"}}},    // 文字列
		{kaedevn::OpType::VAR_ADD, FJson{{"name", "s"}, {"value", 2}}},         // 文字列に足す → 0 + 2
		{kaedevn::OpType::VAR_ADD, FJson{{"name", "n"}, {"value", "x"}}},       // 数でない値 → 0
		{kaedevn::OpType::VAR_SET, FJson{{"name", "b"}, {"value", true}}},
		{kaedevn::OpType::VAR_SUB, FJson{{"name", "b"}, {"value", 3}}},         // bool → 1 - 3
		{kaedevn::OpType::VAR_ADD, FJson{{"name", "c"}, {"value", false}}},     // bool の値 → 0
	};
	FKaedeOpHandler H;
	kaedevn::OpRunner R;
	R.start(Sc, &H);
	try { R.tick(); }
	catch (...) { AddError(TEXT("tick() が例外を投げた")); return false; }
	TestTrue(TEXT("最後まで進む"), R.isFinished());
	const FJson& V = R.vars();
	TestTrue(TEXT("value なしは null"), V.contains("a") && V["a"].is_null());
	TestTrue(TEXT("文字列に足すと 2"), V["s"].is_number() && V["s"].get<double>() == 2.0);
	TestTrue(TEXT("数でない値は 0"), V["n"].is_number() && V["n"].get<double>() == 0.0);
	TestTrue(TEXT("bool から引く"), V["b"].is_number() && V["b"].get<double>() == -2.0);
	TestTrue(TEXT("bool の値は 0/1"), V["c"].is_number() && V["c"].get<double>() == 0.0);
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
