// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "Misc/AutomationTest.h"
#include "KaedeVnSettings.h"   // KaedeVn::GetWorkRoot（作品の置き場）
#include "KaedeUiPainter.h"
#include "MomijiUICore.h"
#include "KaedeVnCore.h"   // BuildPlayTree / BuildDemoPlayTree（Play 画面の契約テスト）
#include "KaedeVnLayout.h" // KaedeVn::KaedeSaveSlotCount
#include "SKaedeUiCanvas.h"
#include "ui/Tween.hpp"   // UiMotionState（HUD countUp の経路テスト）
#include "Layout/ArrangedChildren.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "Framework/Application/SlateApplication.h"
#include "Fonts/FontMeasure.h"
#include "Rendering/SlateRenderer.h"
#include "Rendering/DrawElements.h"

namespace KaedeVnUITests
{
	// テスト用のスタブ測定: 1 文字 11px。align center/right の位置だけに効き、box 幾何には影響しない。
	float StubMeasure(const FString& S, bool /*bBold*/, float /*FontPt*/) { return (float)S.Len() * 11.f; }
}

// Phase A1 契約テスト: native の kPlayJson と同じ UiNode 契約から、同じレイアウト幾何が
// 出ることを GUI 無し(ヘッドレス)で検証する。native UiSnapshotTest の UE 版にあたる。
// 描画(FSlateDrawElement)に依存せず ComputeDrawList の論理座標だけを assert する。
// ここは作品の画面（Play・設定・HUD・手帳の札など）を見る Kaede.UI.*。描画器そのものの契約は MomijiUISlateTests.cpp（MomijiUI.*）。

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiPlayLayoutTest, "Kaede.UI.PlayLayout",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiPlayLayoutTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;

	const kaedevn::ui::UiNode Tree = KaedeCore::BuildDemoPlayTree();

	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;

	const TArray<FKaedeDrawCmd> Cmds = ComputeDrawList(Tree, 1280, 720, Measure);
	TestTrue(TEXT("draw list is non-empty"), Cmds.Num() > 0);

	auto HasRect = [&Cmds](float X, float Y, float W, float H) -> bool
	{
		for (const FKaedeDrawCmd& C : Cmds)
			if (C.Kind == EKaedeDrawKind::Rect &&
				C.X == X && C.Y == Y && C.W == W && C.H == H)
				return true;
		return false;
	};
	auto HasText = [&Cmds](const TCHAR* Needle) -> bool
	{
		for (const FKaedeDrawCmd& C : Cmds)
			if (C.Kind == EKaedeDrawKind::Text && C.Text.Contains(Needle))
				return true;
		return false;
	};
	auto CountTextAtY = [&Cmds](float Y) -> int32
	{
		int32 N = 0;
		for (const FKaedeDrawCmd& C : Cmds)
			if (C.Kind == EKaedeDrawKind::Text && C.Y == Y) ++N;
		return N;
	};

	// 名前枠 / 本文枠 = play.json の絶対座標どおり（native と同一契約）。
	TestTrue(TEXT("namebox rect (84,450,200,35)"),    HasRect(84.f, 450.f, 200.f, 35.f));
	TestTrue(TEXT("textwindow rect (64,480,1152,200)"), HasRect(64.f, 480.f, 1152.f, 200.f));

	// anchor:"fill" のルートが viewport 全面に解決される。
	TestTrue(TEXT("root fill rect (0,0,1280,720)"),   HasRect(0.f, 0.f, 1280.f, 720.f));

	// 文字コードに依存しないよう、Japanese 文字列ではなく「位置」で検証する。
	// 単一行テキストの Y は「親ボックス上端」= 450（縦センタリングは描画側が CenterH で実施）。
	TestEqual(TEXT("speaker label at y=450 (box top)"), CountTextAtY(450.f), 1);

	// showIf=false の skip は prune される（SKIP は ASCII なので存在チェックでよい）。
	TestFalse(TEXT("skip text pruned"), HasText(TEXT("SKIP MODE")));

	// 本文は wrapW=1112 で折り返す: 1 行目 Y=500、2 行目以降 Y=530,560...（kLineH=30）。
	TestEqual(TEXT("body line 1 at y=500"), CountTextAtY(500.f), 1);
	TestTrue(TEXT("body wrapped: line 2 at y=530"), CountTextAtY(530.f) >= 1);

	return true;
}

// 2解像度対応（Docs/Reports/2026/07/25/02）の契約テスト:
// 全画面テンプレートを 1920x1080 で生成すると、1280x720 の幾何がちょうど 1.5 倍の
// 相似形になる（16:9 同士なので x/y/w/h すべて同係数）。720p 側は上の PlayLayout が
// 従来値のまま固定しているので、両方が通れば「720p 不変 + 1080p 相似」が保証される。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiPlayLayout1080pTest, "Kaede.UI.PlayLayout1080p",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiPlayLayout1080pTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;

	// State を持たない静的ツリーで幾何だけを見る（BuildDemoPlayTree の 1080p 版に相当）。
	kaedevn::GameScreenState St;
	St.text = kaedevn::ScreenTextState{};
	St.text->speaker = "speaker";
	St.text->content = "body";
	St.text->displayedChars = 4.0f;

	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;

	auto RectsOf = [&Measure](int32 W, int32 H, const kaedevn::GameScreenState& State)
	{
		const kaedevn::ui::UiNode Tree = KaedeCore::BuildPlayTree(State, /*bCompact*/ false, W, H);
		return ComputeDrawList(Tree, W, H, Measure);
	};
	auto HasRect = [](const TArray<FKaedeDrawCmd>& Cmds, float X, float Y, float W, float H) -> bool
	{
		for (const FKaedeDrawCmd& C : Cmds)
			if (C.Kind == EKaedeDrawKind::Rect && C.X == X && C.Y == Y && C.W == W && C.H == H)
				return true;
		return false;
	};

	// 720p: 契約の座標そのまま（MakePlayJson は 1280x720 で kPlayJson を無変換で返す）。
	const TArray<FKaedeDrawCmd> C720 = RectsOf(1280, 720, St);
	TestTrue(TEXT("720p namebox (84,450,200,35)"),      HasRect(C720, 84.f, 450.f, 200.f, 35.f));
	TestTrue(TEXT("720p textwindow (64,480,1152,200)"), HasRect(C720, 64.f, 480.f, 1152.f, 200.f));
	TestTrue(TEXT("720p root fill (0,0,1280,720)"),     HasRect(C720, 0.f, 0.f, 1280.f, 720.f));

	// 1080p: すべて 1.5 倍（84→126 / 450→675 / 200→300 / 35→53(四捨五入) など）。
	const TArray<FKaedeDrawCmd> C1080 = RectsOf(1920, 1080, St);
	TestTrue(TEXT("1080p namebox (126,675,300,53)"),      HasRect(C1080, 126.f, 675.f, 300.f, 53.f));
	TestTrue(TEXT("1080p textwindow (96,720,1728,300)"),  HasRect(C1080, 96.f, 720.f, 1728.f, 300.f));
	TestTrue(TEXT("1080p root fill (0,0,1920,1080)"),     HasRect(C1080, 0.f, 0.f, 1920.f, 1080.f));

	// --- 行送りの回帰（2026-07-28 に実機で「2行目が重なる」不具合が出たケース）---
	// 矩形だけ見ていると通ってしまうので、本文の行Y差分を直接見る。
	//   720p … kPlayJson を無変換で返す＝lineH 無指定。painter の既定 kLineH=30（契約は不変）
	//   1080p… MakePlayJson が "lineH": 56 を出す（基準37 × 1.5。font33 に対し比 1.7）
	// 当初は lineH が無く、フォントだけ 22→33 に太って送りが 30 のままで行が重なっていた。
	// fontSize 明示で 45 まで直したが「ぎりぎり重ならない」程度だったため lineH を新設した。
	{
		kaedevn::GameScreenState Long;
		Long.text = kaedevn::ScreenTextState{};
		Long.text->speaker = "s";
		Long.text->content = std::string(400, 'a');   // Measure=len*11 なので確実に複数行になる
		Long.text->displayedChars = 1.0e9f;

		// 本文行（'a' で始まる Text コマンド）の Y 差分を並べる。
		auto BodyLineGaps = [&](int32 W, int32 H) -> TArray<float>
		{
			const TArray<FKaedeDrawCmd> Cmds = RectsOf(W, H, Long);
			TArray<float> Ys;
			for (const FKaedeDrawCmd& C : Cmds)
				if (C.Kind == EKaedeDrawKind::Text && C.Text.StartsWith(TEXT("a"))) Ys.Add(C.Y);
			Ys.Sort();
			TArray<float> Gaps;
			for (int32 i = 1; i < Ys.Num(); ++i) Gaps.Add(Ys[i] - Ys[i - 1]);
			return Gaps;
		};

		const TArray<float> G720 = BodyLineGaps(1280, 720);
		TestTrue(TEXT("720p body wraps to 2+ lines"), G720.Num() >= 1);
		for (float G : G720) TestEqual(TEXT("720p line gap == 30 (font 22)"), G, 30.f);

		const TArray<float> G1080 = BodyLineGaps(1920, 1080);
		TestTrue(TEXT("1080p body wraps to 2+ lines"), G1080.Num() >= 1);
		// フォント33に対し送り56（比1.7）。30のままだと重なり、45だとぎりぎりで詰まる。
		for (float G : G1080) TestEqual(TEXT("1080p line gap == 56 (font 33, lineH)"), G, 56.f);
	}

	return true;
}

// 設定画面 Phase 0 契約テスト: Slider/Toggle/ToggleGroup/Modal のレイアウト幾何が
// native drawNode（Momiji.cpp）/ web momiji.js と同じ式で出ることを検証する。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiConfigWidgetsTest, "Kaede.UI.ConfigWidgets",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiConfigWidgetsTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;

	// config.json と同じ構造の縮小版（Modal 中央寄せ→VL 縦積み→タブ/Slider/Toggle 行）。
	const char* kJson = R"JSON(
{ "type":"Modal","w":860,"h":600,"dim":true,"pad":0,"gap":0,"children":[
  { "type":"VerticalLayout","h":600,"pad":28,"gap":18,"children":[
    { "type":"ToggleGroup","h":46,"selected":0,"children":[
      {"type":"Button","text":"A","action":"set:tab=0"},
      {"type":"Button","text":"B","action":"set:tab=1"} ] },
    { "type":"HorizontalLayout","h":40,"children":[
      {"type":"Label","text":"L1","flex":1,"align":"left"},
      {"type":"Slider","w":320,"margin":13,"value":0.5,"action":"slider:v"} ] },
    { "type":"HorizontalLayout","h":40,"hideIf":"touch","children":[
      {"type":"Label","text":"L2","flex":1,"align":"left"},
      {"type":"Toggle","w":28,"margin":6,"on":true,"action":"toggle:t"} ] }
  ]}
]}
)JSON";

	kaedevn::ui::UiNode Tree = KaedeCore::LoadScreenTree(kJson);
	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;

	TArray<FKaedeHit> Hits;
	const TArray<FKaedeDrawCmd> Cmds = ComputeDrawList(Tree, 1280, 720, Measure, &Hits);

	auto HasRect = [&Cmds](float X, float Y, float W, float H) -> bool
	{
		for (const FKaedeDrawCmd& C : Cmds)
			if (C.Kind == EKaedeDrawKind::Rect && C.X == X && C.Y == Y && C.W == W && C.H == H)
				return true;
		return false;
	};
	auto FindHit = [&Hits](const TCHAR* Action) -> const FKaedeHit*
	{
		for (const FKaedeHit& H : Hits) if (H.Action == Action) return &H;
		return nullptr;
	};

	// Modal: 暗幕は全画面、パネルは w/h 指定で自動中央寄せ（(1280-860)/2, (720-600)/2）。
	TestTrue(TEXT("modal dim rect (0,0,1280,720)"),   HasRect(0.f, 0.f, 1280.f, 720.f));
	TestTrue(TEXT("modal panel rect (210,60,860,600)"), HasRect(210.f, 60.f, 860.f, 600.f));
	TestTrue(TEXT("backdrop hit is first and absorbing"),
		Hits.Num() > 0 && Hits[0].Action.IsEmpty() && Hits[0].W == 1280.f);

	// ToggleGroup: VL(pad28)内 → x=238,y=88,w=804。2 セル等分 402px、selected=0 に上部バー。
	TestTrue(TEXT("togglegroup accent bar (238,88,402,3)"), HasRect(238.f, 88.f, 402.f, 3.f));
	const FKaedeHit* TabB = FindHit(TEXT("set:tab=1"));
	TestTrue(TEXT("tab B hit exists"), TabB != nullptr);
	if (TabB) { TestEqual(TEXT("tab B hit x"), TabB->X, 640.f); TestEqual(TEXT("tab B hit w"), TabB->W, 402.f); }

	// Slider: 行 y=152(88+46+18)。flex Label=442px → slider x=701,y=165(margin13),h=14。
	// value 0.5 → 塗り幅 160。
	TestTrue(TEXT("slider track (701,165,320,14)"), HasRect(701.f, 165.f, 320.f, 14.f));
	TestTrue(TEXT("slider fill (701,165,160,14)"),  HasRect(701.f, 165.f, 160.f, 14.f));
	const FKaedeHit* SliderHit = FindHit(TEXT("slider:v"));
	TestTrue(TEXT("slider hit exists"), SliderHit != nullptr);
	if (SliderHit) { TestEqual(TEXT("slider hit x"), SliderHit->X, 701.f); TestEqual(TEXT("slider hit h"), SliderHit->H, 14.f); }

	// Toggle: 行 y=210。flex Label=748px → box x=1000,y=216(margin6),28x28。on → 内側 accent。
	TestTrue(TEXT("toggle box (1000,216,28,28)"),   HasRect(1000.f, 216.f, 28.f, 28.f));
	TestTrue(TEXT("toggle inner (1005,221,18,18)"), HasRect(1005.f, 221.f, 18.f, 18.f));

	// prune: touch=1 で hideIf:"touch" の Toggle 行が消える（showIf/hideIf のランタイム結線）。
	kaedevn::ui::UiNode Pruned = KaedeCore::LoadScreenTree(kJson);
	KaedeCore::PruneScreenTree(Pruned, { {"touch", 1.0} });
	TArray<FKaedeHit> PrunedHits;
	ComputeDrawList(Pruned, 1280, 720, Measure, &PrunedHits);
	bool bToggleSurvived = false;
	for (const FKaedeHit& H : PrunedHits) if (H.Action == TEXT("toggle:t")) bToggleSurvived = true;
	TestFalse(TEXT("hideIf:touch row pruned"), bToggleSurvived);

	return true;
}

// 実データ検証: Game/ui/config.json が読めて、PC/タッチの prune 分岐が効くこと。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiConfigScreenTest, "Kaede.UI.ConfigScreen",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiConfigScreenTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;

	FString Json;
	const FString Path = KaedeVn::GetWorkRoot() / TEXT("ui/config.json");
	if (!FFileHelper::LoadFileToString(Json, *Path))
	{
		AddError(FString::Printf(TEXT("config.json を読めません: %s"), *Path));
		return false;
	}

	// config.json は {"id","note","root":{...}} ラッパ形式。LoadScreenTree が root を剥がす。
	const kaedevn::ui::UiNode Screen = KaedeCore::LoadScreenTree(TCHAR_TO_UTF8(*Json));
	if (Screen.children.empty())
	{
		AddError(TEXT("config.json の root が解析できていません（children が空）"));
		return false;
	}
	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;

	auto CollectActions = [&Measure](const kaedevn::ui::UiNode& Tree) -> TArray<FString>
	{
		TArray<FKaedeHit> Hits;
		ComputeDrawList(Tree, 1280, 720, Measure, &Hits);
		TArray<FString> Actions;
		for (const FKaedeHit& H : Hits) Actions.Add(H.Action);
		return Actions;
	};

	// PC(touch=0)・タブ2(表示): フルスクリーン toggle があり、タッチ注記はない。
	{
		kaedevn::ui::UiNode T = Screen;
		KaedeCore::PruneScreenTree(T, { {"touch", 0.0}, {"tab", 2.0} });
		const TArray<FString> A = CollectActions(T);
		TestTrue(TEXT("PC: fullscreen toggle visible"), A.Contains(TEXT("toggle:fullscreen")));
		TestTrue(TEXT("PC: resolution segment visible"), A.Contains(TEXT("set:resolution=2")));
	}
	// タッチ(touch=1)・タブ2: PC専用行が消える。
	{
		kaedevn::ui::UiNode T = Screen;
		KaedeCore::PruneScreenTree(T, { {"touch", 1.0}, {"tab", 2.0} });
		const TArray<FString> A = CollectActions(T);
		TestFalse(TEXT("touch: fullscreen toggle hidden"), A.Contains(TEXT("toggle:fullscreen")));
		TestFalse(TEXT("touch: resolution segment hidden"), A.Contains(TEXT("set:resolution=1")));
	}

	return true;
}

// 画面カタログ検証: Game/ui/*.json（title/menu/toc/config）が解析でき、
// 主要ボタンの action（goto: 遷移含む）が hit として出ること。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiScreenCatalogTest, "Kaede.UI.ScreenCatalog",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiScreenCatalogTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;

	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;
	auto LoadActions = [this, &Measure](const TCHAR* Screen, TArray<FString>& OutActions) -> bool
	{
		const FString Path = KaedeVn::GetWorkRoot() / TEXT("ui") / Screen;
		FString Json;
		if (!FFileHelper::LoadFileToString(Json, *Path))
		{
			AddError(FString::Printf(TEXT("読めません: %s"), *Path));
			return false;
		}
		kaedevn::ui::UiNode Tree = KaedeCore::LoadScreenTree(TCHAR_TO_UTF8(*Json));
		if (Tree.children.empty())
		{
			AddError(FString::Printf(TEXT("解析失敗（children が空）: %s"), *Path));
			return false;
		}
		KaedeCore::PruneScreenTree(Tree, { {"touch", 0.0} });  // PC 想定
		TArray<FKaedeHit> Hits;
		ComputeDrawList(Tree, 1280, 720, Measure, &Hits);
		for (const FKaedeHit& H : Hits) OutActions.Add(H.Action);
		return true;
	};

	// タイトル: はじめる/つづきから/目次/設定/終了（終了は PC で表示）。
	{
		TArray<FString> A;
		if (LoadActions(TEXT("title.json"), A))
		{
			TestTrue(TEXT("title: newgame"),     A.Contains(TEXT("newgame")));
			TestTrue(TEXT("title: continue"),    A.Contains(TEXT("continue")));
			TestTrue(TEXT("title: goto:toc"),    A.Contains(TEXT("goto:toc")));
			TestTrue(TEXT("title: goto:config"), A.Contains(TEXT("goto:config")));
			TestTrue(TEXT("title: quit (PC)"),   A.Contains(TEXT("quit")));
		}
	}
	// メニュー: セーブ/ロード/目次/環境設定/タイトルへ/クイックセーブ/解説書/閉じる。
	// クイックロードは enabled:false なので hit に出ないこと。
	{
		TArray<FString> A;
		if (LoadActions(TEXT("menu.json"), A))
		{
			TestTrue(TEXT("menu: goto:save"),    A.Contains(TEXT("goto:save")));
			TestTrue(TEXT("menu: goto:load"),    A.Contains(TEXT("goto:load")));
			TestTrue(TEXT("menu: goto:toc"),     A.Contains(TEXT("goto:toc")));
			TestTrue(TEXT("menu: goto:config"),  A.Contains(TEXT("goto:config")));
			TestTrue(TEXT("menu: goto:title"),   A.Contains(TEXT("goto:title")));
			TestTrue(TEXT("menu: quicksave"),    A.Contains(TEXT("quicksave")));
			TestTrue(TEXT("menu: goto:manual"),  A.Contains(TEXT("goto:manual")));
			TestTrue(TEXT("menu: close"),        A.Contains(TEXT("close")));
			TestFalse(TEXT("menu: quickload disabled"), A.Contains(TEXT("quickload")));
		}
	}
	// 目次: 既読章のみ hit（未読 enabled:false は出ない）・閉じる。
	{
		TArray<FString> A;
		if (LoadActions(TEXT("toc.json"), A))
		{
			TestTrue(TEXT("toc: jump:start"), A.Contains(TEXT("jump:start")));
			TestTrue(TEXT("toc: jump:ch6 (current)"), A.Contains(TEXT("jump:ch6")));
			TestTrue(TEXT("toc: close"), A.Contains(TEXT("close")));
			TestFalse(TEXT("toc: unread ch7 not clickable"), A.Contains(TEXT("jump:ch7")));
		}
	}
	// セーブ/ロード: スロット1..KaedeSaveSlotCount の action が出る（本編の枠の数と画面 JSON が合っている）。
	{
		TArray<FString> A;
		if (LoadActions(TEXT("save.json"), A))
			for (int32 i = 1; i <= KaedeVn::KaedeSaveSlotCount; ++i)
				TestTrue(*FString::Printf(TEXT("save: slot %d"), i),
					A.Contains(FString::Printf(TEXT("save:%d"), i)));
	}
	{
		TArray<FString> A;
		if (LoadActions(TEXT("load.json"), A))
			for (int32 i = 1; i <= KaedeVn::KaedeSaveSlotCount; ++i)
				TestTrue(*FString::Printf(TEXT("load: slot %d"), i),
					A.Contains(FString::Printf(TEXT("load:%d"), i)));
	}
	// 解説書: 閉じるだけあればよい。
	{
		TArray<FString> A;
		if (LoadActions(TEXT("manual.json"), A))
			TestTrue(TEXT("manual: close"), A.Contains(TEXT("close")));
	}

	// SetActionEnabled: 動的無効化（セーブが無いとき continue / 空スロット load:n を消す）の確認。
	{
		const FString Path = KaedeVn::GetWorkRoot() / TEXT("ui/title.json");
		FString Json;
		if (FFileHelper::LoadFileToString(Json, *Path))
		{
			kaedevn::ui::UiNode Tree = KaedeCore::LoadScreenTree(TCHAR_TO_UTF8(*Json));
			TestEqual(TEXT("SetActionEnabled matches continue"),
				KaedeUI::SetActionEnabled(Tree, TEXT("continue"), false), 1);
			KaedeCore::PruneScreenTree(Tree, { {"touch", 0.0} });
			TArray<FKaedeHit> Hits;
			ComputeDrawList(Tree, 1280, 720, Measure, &Hits);
			bool bFound = false;
			for (const FKaedeHit& H : Hits) if (H.Action == TEXT("continue")) bFound = true;
			TestFalse(TEXT("disabled continue emits no hit"), bFound);
		}
	}

	return true;
}

// 画面の焦点の到達性: Game/ui の title/menu/save/load/toc/config で、最上位 FocusGroup の先頭 focusable から
// Up/Down/Left/Right を辿って 1) 到達先が同じ群に閉じる 2) 群の action 付き focusable に全部届く（Focus できないボタンが無い）。
// 07/13 の VN Focus 一般化（オーバーレイ/タイトルの方向操作）を回帰網に固める。規則の合成ケースは MomijiUI.FocusReachability。
// 2026-10-18（Issue #76）に MomijiUI のテストから移した（プラグインのテストが作品の画面に依存していた）。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiFocusReachabilityScreensTest, "Kaede.UI.FocusReachability",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiFocusReachabilityScreensTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;
	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;
	auto CheckScreen = [&](const TCHAR* File, const std::unordered_map<std::string, double>& Cond)
	{
		const FString Path = KaedeVn::GetWorkRoot() / TEXT("ui") / File;
		FString Json;
		if (!FFileHelper::LoadFileToString(Json, *Path))
		{
			AddError(FString::Printf(TEXT("読めません: %s"), *Path));
			return;
		}
		kaedevn::ui::UiNode Tree = KaedeCore::LoadScreenTree(TCHAR_TO_UTF8(*Json));
		KaedeCore::PruneScreenTree(Tree, Cond);
		TArray<FKaedeHit> H;
		ComputeDrawList(Tree, 1280, 720, Measure, &H);

		int32 Grp = 0;
		for (const FKaedeHit& X : H) Grp = FMath::Max(Grp, X.FocusGroup);
		const int32 Start = H.IndexOfByPredicate([Grp](const FKaedeHit& X) { return X.bFocusable && X.FocusGroup == Grp; });
		TestTrue(*FString::Printf(TEXT("%s: has initial focus"), File), Start != INDEX_NONE);
		if (Start == INDEX_NONE) return;
		const TArray<FKaedeFocusNav> Nav = BuildFocusNav(H);
		TSet<int32> Seen;
		TArray<int32> Stack;
		Stack.Push(Start); Seen.Add(Start);
		while (Stack.Num() > 0)
		{
			const FKaedeFocusNav& Nv = Nav[Stack.Pop()];
			for (int32 Next : { Nv.Up, Nv.Down, Nv.Left, Nv.Right })
				if (H.IsValidIndex(Next) && !Seen.Contains(Next)) { Seen.Add(Next); Stack.Push(Next); }
		}
		bool bStaysInGroup = true;
		for (int32 I : Seen) if (H[I].FocusGroup != Grp) bStaysInGroup = false;
		TestTrue(*FString::Printf(TEXT("%s: reachable set stays in top group"), File), bStaysInGroup);
		for (int32 I = 0; I < H.Num(); ++I)
			if (H[I].bFocusable && H[I].FocusGroup == Grp && !H[I].Action.IsEmpty() && !Seen.Contains(I))
				AddError(FString::Printf(TEXT("%s: focusable button unreachable: '%s'"), File, *H[I].Action));
	};
	CheckScreen(TEXT("title.json"),  { {"touch", 0.0} });
	CheckScreen(TEXT("menu.json"),   { {"touch", 0.0} });
	CheckScreen(TEXT("save.json"),   { {"touch", 0.0} });
	CheckScreen(TEXT("load.json"),   { {"touch", 0.0} });
	CheckScreen(TEXT("toc.json"),    { {"touch", 0.0} });
	CheckScreen(TEXT("config.json"), { {"touch", 0.0}, {"tab", 0.0} });
	return true;
}

// Component Standard Phase 1（Codex 07/12-12 指示書）: pc98-*/atelier-* variant の描画契約と
// 既存 variant の非破壊、tabbar/gather の action 維持を検証する。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiComponentStandardTest, "Kaede.UI.ComponentStandard",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiComponentStandardTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;

	// 絶対座標で各 variant を1つずつ並べた検証ツリー。
	const char* kJson = R"JSON(
{ "type":"Panel","x":0,"y":0,"w":1280,"h":720,"children":[
  {"type":"HorizontalLayout","variant":"pc98-row","x":10,"y":10,"w":300,"h":100},
  {"type":"Panel","variant":"pc98-tile","x":10,"y":120,"w":80,"h":80},
  {"type":"VerticalLayout","variant":"atelier-card","x":10,"y":210,"w":300,"h":100},
  {"type":"HorizontalLayout","variant":"atelier-icon-tile","x":320,"y":210,"w":80,"h":80},
  {"type":"Button","variant":"pc98-primary","text":"GO","x":10,"y":320,"w":190,"h":60,"action":"a1"},
  {"type":"Button","variant":"pc98-ghost","text":"BK","x":210,"y":320,"w":120,"h":60,"action":"a2"},
  {"type":"Button","variant":"atelier-primary","text":"GO","x":340,"y":320,"w":190,"h":60,"action":"a3"},
  {"type":"Button","variant":"atelier-ghost","text":"BK","x":540,"y":320,"w":120,"h":60,"action":"a4"},
  {"type":"Button","variant":"ghost","text":"C","x":670,"y":320,"w":120,"h":60,"action":"a5"},
  {"type":"Button","variant":"primary","text":"D","x":800,"y":320,"w":120,"h":60,"action":"a6"}
]}
)JSON";

	kaedevn::ui::UiNode Tree = KaedeCore::LoadScreenTree(kJson);
	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;
	TArray<FKaedeHit> Hits;
	const TArray<FKaedeDrawCmd> Cmds = ComputeDrawList(Tree, 1280, 720, Measure, &Hits);

	auto FindCmd = [&Cmds](EKaedeDrawKind Kind, float X, float Y, float W, float H) -> const FKaedeDrawCmd*
	{
		for (const FKaedeDrawCmd& C : Cmds)
			if (C.Kind == Kind && C.X == X && C.Y == Y && C.W == W && C.H == H)
				return &C;
		return nullptr;
	};
	auto TestRadius = [&](const TCHAR* What, const FKaedeDrawCmd* C, float Expected)
	{
		TestTrue(FString::Printf(TEXT("%s exists"), What), C != nullptr);
		if (C) TestEqual(FString::Printf(TEXT("%s radius"), What), C->Radius, Expected);
	};

	// pc98-row: 直角＋二重枠（外=矩形どおり / 内=2pxインセット）。
	TestRadius(TEXT("pc98-row fill"),          FindCmd(EKaedeDrawKind::Rect, 10, 10, 300, 100), 0.f);
	TestRadius(TEXT("pc98-row outer outline"), FindCmd(EKaedeDrawKind::RectOutline, 10, 10, 300, 100), 0.f);
	TestRadius(TEXT("pc98-row inner outline"), FindCmd(EKaedeDrawKind::RectOutline, 12, 12, 296, 96), 0.f);
	// pc98-tile: 二重枠の内側線。
	TestRadius(TEXT("pc98-tile inner outline"), FindCmd(EKaedeDrawKind::RectOutline, 12, 122, 76, 76), 0.f);
	// atelier-card / icon-tile: 角丸6の塗り＋枠。
	TestRadius(TEXT("atelier-card fill"),    FindCmd(EKaedeDrawKind::Rect, 10, 210, 300, 100), 6.f);
	TestRadius(TEXT("atelier-card outline"), FindCmd(EKaedeDrawKind::RectOutline, 10, 210, 300, 100), 6.f);
	TestRadius(TEXT("atelier-icon-tile fill"), FindCmd(EKaedeDrawKind::Rect, 320, 210, 80, 80), 6.f);
	// ボタン: pc98=直角二重枠 / atelier=角丸6 / 既存 ghost・primary は従来半径10（非破壊）。
	TestRadius(TEXT("pc98-primary fill"),          FindCmd(EKaedeDrawKind::Rect, 10, 320, 190, 60), 0.f);
	TestRadius(TEXT("pc98-primary inner outline"), FindCmd(EKaedeDrawKind::RectOutline, 12, 322, 186, 56), 0.f);
	TestRadius(TEXT("pc98-ghost fill"),        FindCmd(EKaedeDrawKind::Rect, 210, 320, 120, 60), 0.f);
	TestRadius(TEXT("atelier-primary fill"),   FindCmd(EKaedeDrawKind::Rect, 340, 320, 190, 60), 6.f);
	TestRadius(TEXT("atelier-ghost fill"),     FindCmd(EKaedeDrawKind::Rect, 540, 320, 120, 60), 6.f);
	TestRadius(TEXT("legacy ghost fill (rad10)"),   FindCmd(EKaedeDrawKind::Rect, 670, 320, 120, 60), 10.f);
	TestRadius(TEXT("legacy primary fill (rad10)"), FindCmd(EKaedeDrawKind::Rect, 800, 320, 120, 60), 10.f);
	// ヒット: 新 variant でもタップ領域はノード矩形どおり。
	for (const TCHAR* A : { TEXT("a1"), TEXT("a2"), TEXT("a3"), TEXT("a4"), TEXT("a5"), TEXT("a6") })
	{
		bool bFound = false;
		for (const FKaedeHit& H : Hits) if (H.Action == A) bFound = true;
		TestTrue(*FString::Printf(TEXT("hit %s"), A), bFound);
	}

	// （旧: hud.json のナビタブ・gather.json 解析の実データ検証はここにあったが、
	//   エンジン=プラグインをゲーム(アルケミスト)データから分離するため削除した。07/23。
	//   variant 化後のヒット保持は上の a1〜a6 で、アルケミスト固有のタブ/画面遷移は
	//   Source/kaedevn/Alchemist/AlchemistUiTests.cpp（実ウィジェット経由）でカバー）。

	// スキン切替（Phase 2）: pc98 スキンでは同一JSONが全直角＋二重枠へ自動変換される。
	{
		FKaedeUiSkin Skin;
		Skin.Family = EKaedeUiSkinFamily::Pc98;
		Skin.Theme = KaedeCore::SkinTheme(1, 0);

		kaedevn::ui::UiNode T2 = KaedeCore::LoadScreenTree(kJson);
		TArray<FKaedeHit> H2;
		const TArray<FKaedeDrawCmd> C2 = ComputeDrawList(T2, 1280, 720, Measure, &H2, Skin);
		auto Find2 = [&C2](EKaedeDrawKind Kind, float X, float Y, float W, float H) -> const FKaedeDrawCmd*
		{
			for (const FKaedeDrawCmd& C : C2)
				if (C.Kind == Kind && C.X == X && C.Y == Y && C.W == W && C.H == H)
					return &C;
			return nullptr;
		};
		// atelier-card → pc98 の card ロール（直角＋内側2pxインセット枠）に変換される。
		const FKaedeDrawCmd* CardFill = Find2(EKaedeDrawKind::Rect, 10, 210, 300, 100);
		TestTrue(TEXT("skin: card fill exists"), CardFill != nullptr);
		if (CardFill) TestEqual(TEXT("skin: card square"), CardFill->Radius, 0.f);
		TestTrue(TEXT("skin: card inner outline"),
			Find2(EKaedeDrawKind::RectOutline, 12, 212, 296, 96) != nullptr);
		// 旧 ghost / primary ボタンも pc98 ロールへ（半径10 → 0）。
		const FKaedeDrawCmd* LegacyGhost = Find2(EKaedeDrawKind::Rect, 670, 320, 120, 60);
		TestTrue(TEXT("skin: legacy ghost exists"), LegacyGhost != nullptr);
		if (LegacyGhost) TestEqual(TEXT("skin: legacy ghost square"), LegacyGhost->Radius, 0.f);
		const FKaedeDrawCmd* LegacyPrimary = Find2(EKaedeDrawKind::Rect, 800, 320, 120, 60);
		TestTrue(TEXT("skin: legacy primary exists"), LegacyPrimary != nullptr);
		if (LegacyPrimary) TestEqual(TEXT("skin: legacy primary square"), LegacyPrimary->Radius, 0.f);
		// ヒットはスキンに依存しない。
		bool bHit = false;
		for (const FKaedeHit& H : H2) if (H.Action == TEXT("a5")) bHit = true;
		TestTrue(TEXT("skin: hits preserved"), bHit);
	}

	return true;
}

// HUD の countUp を「実プレイと同じ経路」で検証する（設計 07/21/04 §A1/E1・バグ#9）。
// UiMotionState 単体テスト（MomijiUI.Core.Motion.*）は状態機械だけを見るため、painter が
// 実際の hud.json からキーを振れているか／画面（タブ）切替を跨いで前回値が生き残るかは
// 捕まえられない。ここは JSON ロード → BindScreenTree → ComputeDrawList(Motion付き)
// → sample までを通し、所持金の増加が補間表示になることを assert する。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiHudCountUpTest, "Kaede.UI.HudCountUp",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiHudCountUpTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;

	// countUp（数値が滑らかに増える）はエンジン機能。特定ゲームのデータに依存せず、
	// 最小の自己完結フィクスチャで検証する（プラグインをゲームデータから分離・07/23）。
	const char* kJson = R"JSON(
{ "type":"Panel","x":0,"y":0,"w":1280,"h":720,"children":[
  { "type":"Label","id":"counter","text":"{value}","x":10,"y":10,"w":200,"h":30,
    "anim":{ "countUp":{ "durationMs":400,"easing":"easeOutQuad" } } }
]}
)JSON";

	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;
	FKaedeUiSkin Skin;
	kaedevn::ui::UiMotionState Motion;

	// ホスト（埋め込み先ウィジェット）の Rebuild 1回ぶんの同期を再現する。
	// scope は固定 "hud"、beginSync に渡す ScreenId が「現在の画面」。
	auto Sync = [&](const TCHAR* ScreenId, const TCHAR* ValueText) -> TArray<FKaedeDrawCmd>
	{
		kaedevn::ui::UiNode Tree = KaedeCore::LoadScreenTree(kJson);
		KaedeCore::BindScreenTree(Tree,
			{ { "value", TCHAR_TO_UTF8(ValueText) } }, {}, {});
		FKaedeMotionCtx Ctx;
		Ctx.State = &Motion;
		Ctx.ScreenId = TEXT("hud");
		Ctx.EvalCond = [](const std::string&) { return false; };
		Motion.beginSync(TCHAR_TO_UTF8(ScreenId));
		TArray<FKaedeHit> Hits;
		TArray<FKaedeDrawCmd> Cmds = ComputeDrawList(Tree, 1280, 720, Measure, &Hits, Skin, &Ctx);
		Motion.endSync();
		return Cmds;
	};

	// 1回目（home 画面）: counter の Text コマンドに安定キーが載る。
	{
		const TArray<FKaedeDrawCmd> Cmds = Sync(TEXT("home"), TEXT("1,000"));
		const FKaedeDrawCmd* Val = Cmds.FindByPredicate([](const FKaedeDrawCmd& C)
			{ return C.Kind == EKaedeDrawKind::Text && C.MotionKey == TEXT("hud/counter"); });
		TestTrue(TEXT("counter の Text コマンドに MotionKey=hud/counter が載る"), Val != nullptr);
		if (Val) TestEqual(TEXT("初回は素の値"), Val->Text, FString(TEXT("1,000")));
	}

	// 検証エラー（key-missing / key-dup）が出ていないこと。
	int32 Errors = 0;
	for (const std::string& L : Motion.drainLogs()) if (L.rfind("ERROR ", 0) == 0) ++Errors;
	TestEqual(TEXT("キー検証エラーなし"), Errors, 0);

	// 2回目: 画面切替（home→craft）を挟んで値が増える＝実プレイの数値更新と同じ形。
	// scope 固定なので前回値が生き残り、countUp が始まる（旧 "<画面名>!hud" では破棄されていた）。
	Sync(TEXT("craft"), TEXT("2,000"));
	Motion.update(200.0);   // 400ms の半分（easing 既定は easeOutQuad ではなく spec 準拠）

	kaedevn::ui::UiMotionSample S;
	TestTrue(TEXT("画面切替を跨いでも countUp が動く"), Motion.sample("hud/counter", S));
	TestTrue(TEXT("countUp が表示テキストを上書きする"), S.hasText);
	if (S.hasText)
	{
		const FString Shown = FString(UTF8_TO_TCHAR(S.text.c_str()));
		TestTrue(FString::Printf(TEXT("中間値が 1,000 と 2,000 の間（実際: %s）"), *Shown),
			Shown != TEXT("1,000") && Shown != TEXT("2,000"));
		TestTrue(TEXT("桁区切りを保つ"), Shown.Contains(TEXT(",")));
	}

	// 完了後は素通し（＝最終値がそのまま描かれる）。
	Motion.update(400.0);
	TestFalse(TEXT("countUp 完了後はサンプルなし"), Motion.sample("hud/counter", S));
	return true;
}

// 手帳の札の「新着」線（設計 adv-ue-completion-design §7-7）: HorizontalLayout の中の
// 色だけの Image（w=3 h=18・sprite 無し）が、色つきの Rect として出ること。
// 2026-09-12 の絵で「新着」の字は出るのに線が出なかった。painter が出しているかを先に数える。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiUnreadBarTest, "Kaede.UI.UnreadBar",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiUnreadBarTest::RunTest(const FString& Parameters)
{
	using namespace KaedeUI;
	FKaedeMeasureFn Measure = KaedeVnUITests::StubMeasure;

	const char* kJson = R"JSON(
{ "type":"Panel","x":0,"y":0,"w":1280,"h":720,"children":[
  {"type":"VerticalLayout","id":"card_n1","x":320,"y":100,"w":700,"h":104,"pad":14,"gap":6,"variant":"light",
   "action":"caseui:select:n1","children":[
    {"type":"HorizontalLayout","h":24,"pad":0,"gap":8,"children":[
      {"type":"Image","w":3,"h":18,"color":"#5ab0ff","showIf":"1"},
      {"type":"Label","text":"岬","align":"left","flex":1,"h":24,"font":"bold","fontSize":15,"ellipsis":true},
      {"type":"Label","text":"新着","align":"right","w":34,"h":24,"fontSize":11,"textColor":"#5ab0ff","showIf":"1"}
    ]},
    {"type":"Label","text":"本文","align":"left","h":22,"fontSize":14,"ellipsis":true}
  ]}
]}
)JSON";

	kaedevn::ui::UiNode Tree = KaedeCore::LoadScreenTree(kJson);
	TArray<FKaedeDrawCmd> Cmds = ComputeDrawList(Tree, 1280, 720, Measure);

	const FKaedeDrawCmd* Bar = nullptr;
	for (const FKaedeDrawCmd& C : Cmds)
		if (C.Kind == EKaedeDrawKind::Rect && C.W == 3.f && C.H == 18.f) { Bar = &C; break; }
	TestTrue(TEXT("新着線: 3x18 の Rect が出る"), Bar != nullptr);
	if (!Bar) return false;
	TestEqual(TEXT("新着線: 色"), Bar->Color, FColor(0x5a, 0xb0, 0xff, 0xff));
	TestEqual(TEXT("新着線: X は札の pad の内側"), Bar->X, 334.f);   // 320 + pad14
	TestEqual(TEXT("新着線: Y は札の pad の内側"), Bar->Y, 114.f);   // 100 + pad14
	// 題は線の右（3 + gap8）。
	const FKaedeDrawCmd* Title = nullptr;
	for (const FKaedeDrawCmd& C : Cmds)
		if (C.Kind == EKaedeDrawKind::Text && C.Text == TEXT("岬")) { Title = &C; break; }
	TestTrue(TEXT("題が出る"), Title != nullptr);
	if (Title) TestTrue(TEXT("題は線の右"), Title->X >= 345.f);
	return true;
}
