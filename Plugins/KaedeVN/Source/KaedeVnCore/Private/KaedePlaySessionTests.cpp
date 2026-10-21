// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "Misc/AutomationTest.h"
#include "KaedePlaySession.h"
#include "DispatchDisplayOp.hpp"   // kaedevn::DispatchDisplayOp（KSC の @行 経路の直接テスト用）

// A2 契約テスト: シナリオが「テキスト→クリック送り→選択肢→分岐」で正しく進むか、
// GUI 無し(ヘッドレス)で検証する。文字列内容ではなく状態遷移で確かめる（文字コード非依存）。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedePlaySessionTest, "Kaede.Runtime.PlaySession",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedePlaySessionTest::RunTest(const FString& Parameters)
{
	FKaedePlaySession S;
	S.StartDemo();

	// 開始直後: テキストはあるが displayedChars=0（タイプライターは未表示から開始）。
	TestTrue(TEXT("text present after start"), S.State().text.has_value() && !S.State().text->content.empty());
	TestTrue(TEXT("waiting for click after start"), S.State().waitingForClick);
	TestEqual(TEXT("typewriter starts hidden"), S.State().text->displayedChars, 0.0f);

	// シーン: BG_SET / CH_SET が state に反映されている（A3 のシーン層）。
	TestEqual(TEXT("bg starts bg1"), FString(UTF8_TO_TCHAR(S.State().bgId.c_str())), FString(TEXT("bg1")));
	TestEqual(TEXT("one character on stage"), (int32)S.State().characters.size(), 1);
	// 立ち絵フェードイン: 開始は alpha<1（fadeMs=600 で 0 から）。
	TestTrue(TEXT("character starts faded-in (alpha<1)"), S.State().characters.at("ch1").alpha < 1.0f);

	// 時間経過で displayedChars が増え、やがて全文表示になる（タイプライター）。
	S.Tick(3000.0f);
	TestTrue(TEXT("typewriter fully revealed after time"),
		S.State().text->displayedChars >= (float)S.State().text->content.size());
	// 立ち絵フェードイン完了。
	TestTrue(TEXT("character fully faded in (alpha==1)"), S.State().characters.at("ch1").alpha >= 1.0f);

	// 選択肢に到達するまで「全文表示 → 送り」を繰り返す（クリック数に依存しない）。
	for (int32 i = 0; i < 30 && !S.IsWaitingForChoice() && !S.IsFinished(); ++i)
	{
		S.Tick(3000.0f);            // タイプライター全文表示 + BG クロスフェード進行
		if (!S.IsWaitingForChoice()) S.HandleClick();
	}
	TestTrue(TEXT("waiting for choice"), S.State().waitingForChoice);
	TestEqual(TEXT("two choices available"), S.NumChoices(), 2);
	TestEqual(TEXT("focus starts at 0"), S.GetFocusedChoice(), 0);

	// 途中の BG_SET(fadeMs) で背景が bg2 へクロスフェード完了している。
	TestEqual(TEXT("bg crossfaded to bg2"), FString(UTF8_TO_TCHAR(S.State().bgId.c_str())), FString(TEXT("bg2")));

	// フォーカス移動（キーボード/ゲームパッドの上下に相当）。
	S.FocusNext();
	TestEqual(TEXT("focus moved to 1"), S.GetFocusedChoice(), 1);
	S.FocusPrev();
	TestEqual(TEXT("focus back to 0"), S.GetFocusedChoice(), 0);

	const FString BeforeBranch = S.State().text.has_value()
		? FString(UTF8_TO_TCHAR(S.State().text->content.c_str())) : FString();

	// フォーカス 1（影の道）にして Confirm（決定）→ 分岐。
	S.FocusNext();
	S.Confirm();
	TestFalse(TEXT("choice cleared after confirm"), S.State().waitingForChoice);
	TestTrue(TEXT("branched text present"), S.State().text.has_value() && !S.State().text->content.empty());

	const FString AfterBranch = S.State().text.has_value()
		? FString(UTF8_TO_TCHAR(S.State().text->content.c_str())) : FString();
	TestNotEqual(TEXT("text changed after branch"), AfterBranch, BeforeBranch);
	TestTrue(TEXT("waiting click on branch text"), S.State().waitingForClick);

	// 影の道（FocusedChoice=1）を選んだので SCREEN_FILTER cool が設定されている。
	TestEqual(TEXT("screen filter set on branch"), S.FilterName(), FString(TEXT("cool")));

	return true;
}

// A5 契約テスト: バックログ記録 と セーブ→ロード往復で実行位置・本文・背景が復元されるか。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeSaveLoadTest, "Kaede.Runtime.SaveLoad",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeSaveLoadTest::RunTest(const FString& Parameters)
{
	FKaedePlaySession S;
	S.StartDemo();

	// 開始直後: 1 行目が確定しバックログに 1 件積まれている。
	TestEqual(TEXT("backlog has 1 line after start"), (int32)S.History().size(), 1);

	// 2 行目（pc=WAIT_CLICK）まで進める。ここを安定したセーブ地点にする。
	S.Tick(3000.0f);     // 1 行目を全文表示
	S.HandleClick();     // → 2 行目へ
	S.Tick(3000.0f);     // 2 行目を全文表示

	TestTrue(TEXT("can save at a click wait"), S.CanSave());
	TestEqual(TEXT("backlog has 2 lines"), (int32)S.History().size(), 2);

	const FString SavedText = S.State().text.has_value()
		? FString(UTF8_TO_TCHAR(S.State().text->content.c_str())) : FString();
	const FString SavedBg = FString(UTF8_TO_TCHAR(S.State().bgId.c_str()));
	TestEqual(TEXT("bg at save point is bg1"), SavedBg, FString(TEXT("bg1")));

	const std::string Snap = S.SaveToJson();
	TestTrue(TEXT("save json non-empty"), Snap.size() > 2);

	// セーブ後さらに読み進める（背景が bg2 へ、本文も変わる）。
	S.HandleClick();
	S.Tick(3000.0f);
	const FString AfterText = S.State().text.has_value()
		? FString(UTF8_TO_TCHAR(S.State().text->content.c_str())) : FString();
	TestNotEqual(TEXT("text advanced past save point"), AfterText, SavedText);

	// ===== 別セッションへロード（コールドロード相当: シナリオは Start 済み） =====
	FKaedePlaySession S2;
	S2.StartDemo();
	TestTrue(TEXT("load succeeds"), S2.LoadFromJson(Snap));

	// 実行位置・本文・背景・待ち状態・バックログが保存地点に戻っている。
	TestTrue(TEXT("loaded: waiting for click"), S2.State().waitingForClick);
	const FString LoadedText = S2.State().text.has_value()
		? FString(UTF8_TO_TCHAR(S2.State().text->content.c_str())) : FString();
	TestEqual(TEXT("loaded text == saved text"), LoadedText, SavedText);
	TestEqual(TEXT("loaded text fully revealed"),
		S2.State().text->displayedChars, (float)S2.State().text->content.size());
	TestEqual(TEXT("loaded bg == saved bg"),
		FString(UTF8_TO_TCHAR(S2.State().bgId.c_str())), SavedBg);
	TestEqual(TEXT("loaded backlog has 2 lines"), (int32)S2.History().size(), 2);

	// ロード後も継続再生できる（クリックで次の本文へ進み、背景が bg2 へクロスフェード）。
	S2.HandleClick();
	S2.Tick(3000.0f);
	const FString S2Next = S2.State().text.has_value()
		? FString(UTF8_TO_TCHAR(S2.State().text->content.c_str())) : FString();
	TestNotEqual(TEXT("can continue after load"), S2Next, SavedText);
	TestEqual(TEXT("bg crossfaded to bg2 after load+advance"),
		FString(UTF8_TO_TCHAR(S2.State().bgId.c_str())), FString(TEXT("bg2")));

	// セーブできない地点では CanSave=false（finished など）。終端まで進めて確認。
	for (int32 i = 0; i < 40 && !S2.IsFinished(); ++i)
	{
		S2.Tick(3000.0f);
		if (S2.IsWaitingForChoice()) S2.SelectChoice(0);
		else S2.HandleClick();
	}
	TestTrue(TEXT("scenario finished"), S2.IsFinished());
	TestFalse(TEXT("cannot save when finished"), S2.CanSave());

	return true;
}

// ===== Phase 1: SPRITE_* / TEXT_CLEAR / CH_EXPR =====
// 実測（Docs/Reports/2026/07/29/01）で最優先と判明した3系統の契約テスト。
// 「enum を足しただけ」「OpRunner だけ直した」を検出するため、
// 語彙テーブル・DispatchDisplayOp・OpRunner の3経路をそれぞれ直接叩く。

// 語彙テーブル漏れの検出。enum に足しても opTypeFromString に足し忘れると
// UNKNOWN 扱いで無言スキップになる（実際に起きやすい事故）。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeOpVocabularyTest, "Kaede.Runtime.OpVocabulary",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeOpVocabularyTest::RunTest(const FString& Parameters)
{
	using kaedevn::OpType;
	using kaedevn::opTypeFromString;

	TestTrue(TEXT("SPRITE_SET in table"),   opTypeFromString("SPRITE_SET")   == OpType::SPRITE_SET);
	TestTrue(TEXT("SPRITE_MOVE in table"),  opTypeFromString("SPRITE_MOVE")  == OpType::SPRITE_MOVE);
	TestTrue(TEXT("SPRITE_HIDE in table"),  opTypeFromString("SPRITE_HIDE")  == OpType::SPRITE_HIDE);
	TestTrue(TEXT("SPRITE_CLEAR in table"), opTypeFromString("SPRITE_CLEAR") == OpType::SPRITE_CLEAR);
	TestTrue(TEXT("TEXT_CLEAR in table"),   opTypeFromString("TEXT_CLEAR")   == OpType::TEXT_CLEAR);
	TestTrue(TEXT("CH_EXPR in table"),      opTypeFromString("CH_EXPR")      == OpType::CH_EXPR);

	TestTrue(TEXT("TEXT_STYLE in table"),   opTypeFromString("TEXT_STYLE")   == OpType::TEXT_STYLE);

	// 未定義の綴りは UNKNOWN のまま（テーブルが緩くなっていないことの確認）。
	TestTrue(TEXT("unknown stays unknown"), opTypeFromString("SPRITE_NOPE") == OpType::UNKNOWN);
	return true;
}

// KSC の @行 経路（DispatchDisplayOp）が新 Op を処理するか。
// OpRunner だけ直して DispatchDisplayOp を忘れると、
// 「エディタでは動くがビルドしたシナリオで動かない」形のバグになる。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeDispatchSpriteTest, "Kaede.Runtime.DispatchSprite",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeDispatchSpriteTest::RunTest(const FString& Parameters)
{
	FKaedeOpHandler H;
	int32 Completed = 0;
	auto OnDone = [&Completed]() { ++Completed; };

	auto MakeOp = [](const char* Type, const nlohmann::json& Data)
	{
		kaedevn::Op Op;
		Op.type = kaedevn::opTypeFromString(Type);
		Op.data = Data;
		return Op;
	};

	TestTrue(TEXT("dispatch handles SPRITE_SET"),
		kaedevn::DispatchDisplayOp(
			MakeOp("SPRITE_SET", {{"id", "s1"}, {"storage", "bg1"}, {"x", 10.0}, {"y", 20.0}}),
			H, OnDone));
	TestEqual(TEXT("sprite registered via dispatch"), (int32)H.Sprites().size(), 1);
	TestEqual(TEXT("dispatch fired onComplete"), Completed, 1);

	TestTrue(TEXT("dispatch handles TEXT_CLEAR"),
		kaedevn::DispatchDisplayOp(MakeOp("TEXT_CLEAR", {{"target", "all"}}), H, OnDone));
	TestTrue(TEXT("dispatch handles CH_EXPR"),
		kaedevn::DispatchDisplayOp(MakeOp("CH_EXPR", {{"name", "ch1"}, {"expression", "happy"}}), H, OnDone));
	TestTrue(TEXT("dispatch handles SPRITE_MOVE"),
		kaedevn::DispatchDisplayOp(MakeOp("SPRITE_MOVE", {{"id", "s1"}, {"x", 99.0}}), H, OnDone));
	TestTrue(TEXT("dispatch handles SPRITE_HIDE"),
		kaedevn::DispatchDisplayOp(MakeOp("SPRITE_HIDE", {{"id", "s1"}}), H, OnDone));
	// 引数なしの SPRITE_CLEAR（実作品での最頻形。298回中の大半がこれ）。
	// null ではなく空オブジェクトを渡す＝nlohmann の value() が型エラーを投げない形。
	TestTrue(TEXT("dispatch handles SPRITE_CLEAR"),
		kaedevn::DispatchDisplayOp(MakeOp("SPRITE_CLEAR", nlohmann::json::object()), H, OnDone));
	TestEqual(TEXT("all six dispatched ops completed"), Completed, 6);

	return true;
}

// OpRunner（KS 経路）＋ 状態遷移・トゥイーンの契約。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeSpriteOpsTest, "Kaede.Runtime.SpriteOps",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeSpriteOpsTest::RunTest(const FString& Parameters)
{
	// front に s1、back に s2 を出し、s1 を 200ms かけて x=300 へ動かす。
	// 末尾の WAIT_CLICK で停止させ、状態を観察する。
	const std::string Json = R"({
		"id": "sprite-test",
		"ops": [
			{"op": "CH_SET", "name": "ch1", "pose": "normal", "pos": "center"},
			{"op": "SPRITE_SET", "id": "s1", "storage": "spr_a", "layer": "front", "x": 100, "y": 50},
			{"op": "SPRITE_SET", "id": "s2", "storage": "spr_b", "layer": "back", "x": 0, "y": 0},
			{"op": "SPRITE_MOVE", "id": "s1", "x": 300, "durationMs": 200},
			{"op": "TEXT_APPEND", "text": "hello"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));

	TestEqual(TEXT("two sprites on stage"), (int32)S.Sprites().size(), 2);

	// 登録内容: id / storage / layer / 座標。
	const FKaedeSpriteItem* S1 = nullptr;
	const FKaedeSpriteItem* S2 = nullptr;
	for (const FKaedeSpriteItem& It : S.Sprites())
	{
		if (It.id == "s1") S1 = &It;
		if (It.id == "s2") S2 = &It;
	}
	TestNotNull(TEXT("s1 registered"), S1);
	TestNotNull(TEXT("s2 registered"), S2);
	if (!S1 || !S2) return false;

	TestEqual(TEXT("s1 storage"), FString(UTF8_TO_TCHAR(S1->storage.c_str())), FString(TEXT("spr_a")));
	TestEqual(TEXT("s1 layer=front(1)"), S1->order, 1);
	TestEqual(TEXT("s2 layer=back(0)"), S2->order, 0);
	TestEqual(TEXT("s1 y kept at 50"), S1->y, 50.0f);
	// fadeMs 指定なし → 即表示。
	TestEqual(TEXT("s1 opaque immediately"), S1->alpha, 1.0f);

	// SPRITE_MOVE は同期扱い＝呼んだ時点では動いていない（update が進める）。
	TestEqual(TEXT("s1 x still 100 before tick"), S1->x, 100.0f);

	// 半分だけ進める → 中間位置。y は省略したので 50 のまま。
	S.Tick(100.0f);
	const FKaedeSpriteItem& S1a = S.Sprites()[0].id == "s1" ? S.Sprites()[0] : S.Sprites()[1];
	TestTrue(TEXT("s1 moving (100 < x < 300)"), S1a.x > 100.0f && S1a.x < 300.0f);
	TestEqual(TEXT("s1 y unchanged by partial move"), S1a.y, 50.0f);

	// 残りを進める → 目標へ吸着。
	S.Tick(150.0f);
	const FKaedeSpriteItem& S1b = S.Sprites()[0].id == "s1" ? S.Sprites()[0] : S.Sprites()[1];
	TestEqual(TEXT("s1 snapped to target x"), S1b.x, 300.0f);

	// CH_EXPR: 表示中キャラの pose が差し替わる。
	TestEqual(TEXT("pose starts normal"),
		FString(UTF8_TO_TCHAR(S.State().characters.at("ch1").pose.c_str())), FString(TEXT("normal")));

	return true;
}

// TEXT_CLEAR / CH_EXPR / SPRITE_HIDE / SPRITE_CLEAR の消去系契約。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeTextClearExprTest, "Kaede.Runtime.TextClearExpr",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeTextClearExprTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "clear-test",
		"ops": [
			{"op": "CH_SET", "name": "ch1", "pose": "normal", "pos": "center"},
			{"op": "SPRITE_SET", "id": "s1", "storage": "spr_a", "layer": "front"},
			{"op": "SPRITE_SET", "id": "s2", "storage": "spr_b", "layer": "back"},
			{"op": "TEXT_APPEND", "text": "hello"},
			{"op": "WAIT_CLICK"},
			{"op": "CH_EXPR", "name": "ch1", "expression": "happy"},
			{"op": "SPRITE_CLEAR", "layer": "back"},
			{"op": "TEXT_CLEAR", "target": "all"},
			{"op": "TEXT_APPEND", "text": "next"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));
	TestTrue(TEXT("text present before clear"), S.State().text.has_value());
	TestEqual(TEXT("two sprites before clear"), (int32)S.Sprites().size(), 2);

	// 送って CH_EXPR / SPRITE_CLEAR / TEXT_CLEAR を通す。
	S.Tick(3000.0f);
	S.HandleClick();
	S.Tick(16.0f);

	// CH_EXPR: pose が happy へ。
	TestEqual(TEXT("pose switched to happy"),
		FString(UTF8_TO_TCHAR(S.State().characters.at("ch1").pose.c_str())), FString(TEXT("happy")));

	// SPRITE_CLEAR layer=back: back のみ消え、front は残る。
	TestEqual(TEXT("only front sprite remains"), (int32)S.Sprites().size(), 1);
	if (S.Sprites().size() == 1)
	{
		TestEqual(TEXT("remaining sprite is s1(front)"),
			FString(UTF8_TO_TCHAR(S.Sprites()[0].id.c_str())), FString(TEXT("s1")));
	}

	// TEXT_CLEAR の直後に TEXT_APPEND+WAIT_CLICK があるので、本文は "next" だけになる
	// （クリアが効いていなければ "hellonext" になる）。
	TestTrue(TEXT("text present after clear+append"), S.State().text.has_value());
	if (S.State().text.has_value())
	{
		TestEqual(TEXT("cleared text does not accumulate"),
			FString(UTF8_TO_TCHAR(S.State().text->content.c_str())), FString(TEXT("next")));
	}

	return true;
}

// ===== Phase 2: TEXT_SPRITE_SET / MASK_* / LAYER_SET / TRANSITION =====

// 語彙テーブル漏れ（Phase 2 分）。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeOpVocabularyPhase2Test, "Kaede.Runtime.OpVocabularyPhase2",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeOpVocabularyPhase2Test::RunTest(const FString& Parameters)
{
	using kaedevn::OpType;
	using kaedevn::opTypeFromString;
	TestTrue(TEXT("TEXT_SPRITE_SET in table"), opTypeFromString("TEXT_SPRITE_SET") == OpType::TEXT_SPRITE_SET);
	TestTrue(TEXT("LAYER_SET in table"),       opTypeFromString("LAYER_SET")       == OpType::LAYER_SET);
	TestTrue(TEXT("TRANSITION in table"),      opTypeFromString("TRANSITION")      == OpType::TRANSITION);
	TestTrue(TEXT("WAIT_TRANSITION in table"), opTypeFromString("WAIT_TRANSITION") == OpType::WAIT_TRANSITION);
	TestTrue(TEXT("MASK_SET in table"),        opTypeFromString("MASK_SET")        == OpType::MASK_SET);
	TestTrue(TEXT("MASK_CLEAR in table"),      opTypeFromString("MASK_CLEAR")      == OpType::MASK_CLEAR);
	return true;
}

// テキストスプライトが画像スプライトと同一キー空間に載り、SPRITE_MOVE/HIDE が効くこと。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeTextSpriteTest, "Kaede.Runtime.TextSprite",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeTextSpriteTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "textsprite-test",
		"ops": [
			{"op": "TEXT_SPRITE_SET", "id": "t1", "text": "hello", "x": 10, "y": 345, "size": 24, "color": "#ff0000"},
			{"op": "SPRITE_SET", "id": "img1", "storage": "spr_a", "x": 0, "y": 0},
			{"op": "SPRITE_MOVE", "id": "t1", "x": 200, "durationMs": 100},
			{"op": "TEXT_APPEND", "text": "x"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));
	TestEqual(TEXT("text sprite + image sprite share the space"), (int32)S.Sprites().size(), 2);

	const FKaedeSpriteItem* T1 = nullptr;
	for (const FKaedeSpriteItem& It : S.Sprites()) if (It.id == "t1") T1 = &It;
	TestNotNull(TEXT("t1 registered"), T1);
	if (!T1) return false;

	TestTrue(TEXT("t1 is a text sprite"), T1->bIsText);
	TestEqual(TEXT("t1 body"), FString(UTF8_TO_TCHAR(T1->text.c_str())), FString(TEXT("hello")));
	TestEqual(TEXT("t1 size"), T1->fontSize, 24.0f);
	TestEqual(TEXT("t1 color"), FString(UTF8_TO_TCHAR(T1->color.c_str())), FString(TEXT("#ff0000")));
	TestTrue(TEXT("t1 has no storage (not an image)"), T1->storage.empty());

	// SPRITE_MOVE がテキストにも効く（同一キー空間である証拠）。
	S.Tick(150.0f);
	const FKaedeSpriteItem* T1b = nullptr;
	for (const FKaedeSpriteItem& It : S.Sprites()) if (It.id == "t1") T1b = &It;
	if (T1b) TestEqual(TEXT("text sprite moved by SPRITE_MOVE"), T1b->x, 200.0f);

	return true;
}

// MASK_SET は MASK_CLEAR まで維持される（FADE_BLACK と違い自然に消えない）。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeMaskTest, "Kaede.Runtime.Mask",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeMaskTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "mask-test",
		"ops": [
			{"op": "MASK_SET", "color": "#112233", "opacity": 1.0, "durationMs": 100},
			{"op": "TEXT_APPEND", "text": "a"},
			{"op": "WAIT_CLICK"},
			{"op": "MASK_CLEAR", "durationMs": 100},
			{"op": "TEXT_APPEND", "text": "b"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));

	// フェード中は 0<alpha<1。
	S.Tick(50.0f);
	TestTrue(TEXT("mask fading in"), S.MaskAlpha() > 0.f && S.MaskAlpha() < 1.f);

	// 完了後は 1 のまま維持される（長く回しても消えない）。
	S.Tick(100.0f);
	TestEqual(TEXT("mask fully applied"), S.MaskAlpha(), 1.0f);
	S.Tick(5000.0f);
	TestEqual(TEXT("mask persists (not a transient effect)"), S.MaskAlpha(), 1.0f);
	TestEqual(TEXT("mask color kept"), S.MaskColor(), FString(TEXT("#112233")));

	// MASK_CLEAR で消える。
	S.HandleClick();
	S.Tick(150.0f);
	TestEqual(TEXT("mask cleared"), S.MaskAlpha(), 0.0f);
	return true;
}

// LAYER_SET と TRANSITION/WAIT_TRANSITION。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeLayerTransitionTest, "Kaede.Runtime.LayerTransition",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeLayerTransitionTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "layer-test",
		"ops": [
			{"op": "LAYER_SET", "name": "character", "opacity": 0.5},
			{"op": "LAYER_SET", "name": "message0", "visible": false},
			{"op": "TRANSITION", "target": "overlay", "durationMs": 100},
			{"op": "WAIT_TRANSITION"},
			{"op": "TEXT_APPEND", "text": "done"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));

	TestEqual(TEXT("character layer opacity set"), S.LayerOpacity("character"), 0.5f);
	// 未知レイヤ（Tyrano の message0 等）は黙って無視され、既定に影響しない。
	TestTrue(TEXT("unknown layer ignored, others stay visible"), S.LayerVisible("background"));

	// WAIT_TRANSITION で止まっている＝本文はまだ来ていない。
	TestFalse(TEXT("blocked on WAIT_TRANSITION"), S.State().text.has_value());
	TestTrue(TEXT("overlay starts transparent"), S.LayerOpacity("overlay") < 1.f);

	// 完了すると解放されて本文へ進む。
	S.Tick(150.0f);
	TestEqual(TEXT("overlay faded in"), S.LayerOpacity("overlay"), 1.0f);
	TestTrue(TEXT("resumed after transition"), S.State().text.has_value());
	return true;
}

// ===== Phase 3: TIMELINE_PLAY =====
// 評価器（engine/TimelineEvaluator.hpp）は TS Tools/kaedevn-compiler/packages/core/src/timeline の移植。
// 実作品 tyrano-tech-sample1 の 57 本は全て kind=entity・targetId="spr_*"・
// property=opacity/x/y/scale なので、そこを厚く確かめる。

// 評価器そのもの（状態を持たない純関数）。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeTimelineEvalTest, "Kaede.Runtime.TimelineEval",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeTimelineEvalTest::RunTest(const FString& Parameters)
{
	// 実作品の 'mtext_mtext_1__bounce__500' と同じ形（opacity 0→1 / 500ms）。
	const nlohmann::json TL = nlohmann::json::parse(R"({
		"schemaVersion": 1, "durationMs": 500,
		"tracks": [{
			"id": "track_spr_a", "kind": "entity", "order": 0, "enabled": true,
			"targetId": "spr_a",
			"clips": [{
				"id": "clip_0", "startMs": 0, "endMs": 500,
				"channels": [{
					"property": "opacity", "defaultValue": 1,
					"keyframes": [{"clipOffsetMs": 0, "value": 0}, {"clipOffsetMs": 500, "value": 1}]
				}]
			}]
		}]
	})");

	auto OpacityAt = [&](float T) -> float
	{
		const auto R = kaedevn::EvaluateTimeline(TL, T);
		if (R.empty()) return -1.0f;
		auto F = R[0].properties.find("opacity");
		return (F != R[0].properties.end()) ? F->second : -1.0f;
	};

	TestEqual(TEXT("t=0 → 0"), OpacityAt(0.0f), 0.0f);
	TestEqual(TEXT("t=250 → 0.5 (linear)"), OpacityAt(250.0f), 0.5f);
	// clip は [start, end) の半開区間。t=500 は clip 外なので fillMode=hold（既定）で最終値。
	TestEqual(TEXT("t=500 → 1 (fillMode hold)"), OpacityAt(500.0f), 1.0f);
	TestEqual(TEXT("t=9999 → 1 (hold 継続)"), OpacityAt(9999.0f), 1.0f);
	TestEqual(TEXT("targetId 保持"), FString(UTF8_TO_TCHAR(
		kaedevn::EvaluateTimeline(TL, 100.0f)[0].targetId.c_str())), FString(TEXT("spr_a")));

	// easing: step は次の keyframe に達するまで手前の値を保持する。
	const nlohmann::json StepTL = nlohmann::json::parse(R"({
		"schemaVersion": 1, "durationMs": 100,
		"tracks": [{
			"id": "t", "kind": "entity", "order": 0, "enabled": true, "targetId": "spr_a",
			"clips": [{"id": "c", "startMs": 0, "endMs": 100, "channels": [{
				"property": "x", "defaultValue": 0,
				"keyframes": [{"clipOffsetMs": 0, "value": 0, "easing": "step"},
				              {"clipOffsetMs": 100, "value": 10}]
			}]}]
		}]
	})");
	const auto Mid = kaedevn::EvaluateTimeline(StepTL, 50.0f);
	TestEqual(TEXT("step easing holds previous value"), Mid[0].properties.at("x"), 0.0f);

	// fillMode=none は clip 外で結果を返さない。
	const nlohmann::json NoneTL = nlohmann::json::parse(R"({
		"schemaVersion": 1, "durationMs": 100,
		"tracks": [{
			"id": "t", "kind": "entity", "order": 0, "enabled": true, "targetId": "spr_a",
			"clips": [{"id": "c", "startMs": 0, "endMs": 100, "fillMode": "none", "channels": [{
				"property": "x", "defaultValue": 0,
				"keyframes": [{"clipOffsetMs": 0, "value": 0}, {"clipOffsetMs": 100, "value": 10}]
			}]}]
		}]
	})");
	TestEqual(TEXT("fillMode none → clip外は結果なし"),
		(int32)kaedevn::EvaluateTimeline(NoneTL, 200.0f).size(), 0);

	// enabled=false のトラックは評価しない。
	nlohmann::json Disabled = TL;
	Disabled["tracks"][0]["enabled"] = false;
	TestEqual(TEXT("disabled track skipped"),
		(int32)kaedevn::EvaluateTimeline(Disabled, 100.0f).size(), 0);

	return true;
}

// TIMELINE_PLAY が非同期（durationMs 経過まで次の Op へ進まない）で、
// 評価結果が実際にスプライトへ適用されること。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeTimelinePlayTest, "Kaede.Runtime.TimelinePlay",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeTimelinePlayTest::RunTest(const FString& Parameters)
{
	const std::string Timelines = R"({
		"fadeIn": {
			"schemaVersion": 1, "durationMs": 400,
			"tracks": [{
				"id": "track_spr_a", "kind": "entity", "order": 0, "enabled": true,
				"targetId": "spr_a",
				"clips": [{"id": "c", "startMs": 0, "endMs": 400, "channels": [
					{"property": "opacity", "defaultValue": 1,
					 "keyframes": [{"clipOffsetMs": 0, "value": 0}, {"clipOffsetMs": 400, "value": 1}]},
					{"property": "x", "defaultValue": 0,
					 "keyframes": [{"clipOffsetMs": 0, "value": 0}, {"clipOffsetMs": 400, "value": 400}]}
				]}]
			}]
		}
	})";

	const std::string Json = R"({
		"id": "timeline-test",
		"ops": [
			{"op": "SPRITE_SET", "id": "a", "storage": "spr_img", "x": 0, "y": 0},
			{"op": "TIMELINE_PLAY", "timelineId": "fadeIn"},
			{"op": "TEXT_APPEND", "text": "after"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("timelines injected"), S.SetTimelinesFromJson(Timelines));
	TestEqual(TEXT("one timeline registered"), S.NumTimelines(), 1);
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));

	// 開始フレームで t=0 の値が入る（元の位置で1フレーム見えない）。
	TestEqual(TEXT("one sprite"), (int32)S.Sprites().size(), 1);
	if (S.Sprites().size() != 1) return false;
	TestEqual(TEXT("t=0: opacity 0"), S.Sprites()[0].alpha, 0.0f);

	// **非同期**: 再生中は次の Op（TEXT_APPEND + WAIT_CLICK）へ進んでいない。
	TestFalse(TEXT("blocked while timeline plays"), S.State().text.has_value());

	// 半分進めると中間値。
	S.Tick(200.0f);
	TestTrue(TEXT("t=200: opacity ~0.5"),
		S.Sprites()[0].alpha > 0.4f && S.Sprites()[0].alpha < 0.6f);
	TestTrue(TEXT("t=200: x ~200"),
		S.Sprites()[0].x > 180.0f && S.Sprites()[0].x < 220.0f);
	TestFalse(TEXT("still blocked at t=200"), S.State().text.has_value());

	// 完走すると最終値になり、シナリオが再開する。
	S.Tick(250.0f);
	TestEqual(TEXT("t=end: opacity 1"), S.Sprites()[0].alpha, 1.0f);
	TestEqual(TEXT("t=end: x 400"), S.Sprites()[0].x, 400.0f);
	TestTrue(TEXT("resumed after timeline"), S.State().text.has_value());

	return true;
}

// 未登録の timelineId でシナリオが止まらないこと（TS も warn して素通り）。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeTimelineMissingTest, "Kaede.Runtime.TimelineMissing",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeTimelineMissingTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "timeline-missing",
		"ops": [
			{"op": "TIMELINE_PLAY", "timelineId": "does_not_exist"},
			{"op": "TEXT_APPEND", "text": "after"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));
	// timelines を一切注入していなくても素通りして本文へ進む。
	TestTrue(TEXT("missing timeline does not block"), S.State().text.has_value());
	return true;
}

// スプライト・マスク・レイヤがセーブ/ロードで往復すること（セーブ version 2）。
// これが無いと、ロード直後に画面上の絵（実作品では大半がスプライト）が全部消える。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeSpriteSaveLoadTest, "Kaede.Runtime.SpriteSaveLoad",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeSpriteSaveLoadTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "sprite-save-test",
		"ops": [
			{"op": "SPRITE_SET", "id": "img", "storage": "spr_a", "layer": "back", "x": 120, "y": 34},
			{"op": "TEXT_SPRITE_SET", "id": "cap", "text": "キャプション", "x": 10, "y": 345, "size": 30, "color": "#00ff00"},
			{"op": "MASK_SET", "color": "#123456", "opacity": 0.5},
			{"op": "LAYER_SET", "name": "character", "opacity": 0.25},
			{"op": "TEXT_APPEND", "text": "save here"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));
	S.Tick(16.0f);
	TestTrue(TEXT("can save"), S.CanSave());
	TestEqual(TEXT("two sprites before save"), (int32)S.Sprites().size(), 2);

	const std::string Snap = S.SaveToJson();

	// 別セッションへロード。
	FKaedePlaySession S2;
	TestTrue(TEXT("scenario loaded (2)"), S2.StartFromJson(Json));
	TestTrue(TEXT("load succeeds"), S2.LoadFromJson(Snap));

	TestEqual(TEXT("sprites restored"), (int32)S2.Sprites().size(), 2);

	const FKaedeSpriteItem* Img = nullptr;
	const FKaedeSpriteItem* Cap = nullptr;
	for (const FKaedeSpriteItem& It : S2.Sprites())
	{
		if (It.id == "img") Img = &It;
		if (It.id == "cap") Cap = &It;
	}
	TestNotNull(TEXT("image sprite restored"), Img);
	TestNotNull(TEXT("text sprite restored"), Cap);
	if (!Img || !Cap) return false;

	TestEqual(TEXT("image storage"), FString(UTF8_TO_TCHAR(Img->storage.c_str())), FString(TEXT("spr_a")));
	TestEqual(TEXT("image layer(back)"), Img->order, 0);
	TestEqual(TEXT("image x"), Img->x, 120.0f);
	TestEqual(TEXT("image y"), Img->y, 34.0f);
	TestEqual(TEXT("image opaque after load"), Img->alpha, 1.0f);

	TestTrue(TEXT("caption is text"), Cap->bIsText);
	TestEqual(TEXT("caption body"), FString(UTF8_TO_TCHAR(Cap->text.c_str())), FString(TEXT("キャプション")));
	TestEqual(TEXT("caption size"), Cap->fontSize, 30.0f);
	TestEqual(TEXT("caption color"), FString(UTF8_TO_TCHAR(Cap->color.c_str())), FString(TEXT("#00ff00")));

	// マスクとレイヤも復元される。
	TestEqual(TEXT("mask alpha restored"), S2.MaskAlpha(), 0.5f);
	TestEqual(TEXT("mask color restored"), S2.MaskColor(), FString(TEXT("#123456")));
	TestEqual(TEXT("character layer opacity restored"), S2.LayerOpacity("character"), 0.25f);

	// ロード後も継続再生できる。
	S2.Tick(16.0f);
	S2.HandleClick();
	TestTrue(TEXT("scenario continues after load"), S2.IsFinished() || S2.State().text.has_value());
	return true;
}

// ===== Phase 4: UI_SHOW / UI_HIDE / CAMERA_SET =====

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiCameraVocabularyTest, "Kaede.Runtime.OpVocabularyPhase4",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiCameraVocabularyTest::RunTest(const FString& Parameters)
{
	using kaedevn::OpType;
	using kaedevn::opTypeFromString;
	TestTrue(TEXT("UI_SHOW in table"),    opTypeFromString("UI_SHOW")    == OpType::UI_SHOW);
	TestTrue(TEXT("UI_HIDE in table"),    opTypeFromString("UI_HIDE")    == OpType::UI_HIDE);
	TestTrue(TEXT("CAMERA_SET in table"), opTypeFromString("CAMERA_SET") == OpType::CAMERA_SET);
	return true;
}

// UI_SHOW は wait=true で停止し、NotifyUiAction("close") で再開すること。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiShowTest, "Kaede.Runtime.UiShow",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiShowTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "uishow-test",
		"ops": [
			{"op": "UI_SHOW", "screenId": "codex", "wait": true},
			{"op": "TEXT_APPEND", "text": "after"},
			{"op": "WAIT_CLICK"}
		],
		"labels": {}
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));

	// 描画側が拾うべき画面名が立ち、シナリオは止まっている。
	TestEqual(TEXT("pending screen exposed"), S.PendingUiScreen(), FString(TEXT("codex")));
	TestFalse(TEXT("blocked while ui is open"), S.State().text.has_value());

	// 画面を閉じたと通知すると再開する。
	S.NotifyUiAction(TEXT("close"));
	TestTrue(TEXT("resumed after close"), S.State().text.has_value());
	TestTrue(TEXT("pending cleared"), S.PendingUiScreen().IsEmpty());
	return true;
}

// wait=false は止めない。screenId 未指定でも止めない。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiShowNoWaitTest, "Kaede.Runtime.UiShowNoWait",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiShowNoWaitTest::RunTest(const FString& Parameters)
{
	{
		const std::string Json = R"({
			"id": "nowait", "labels": {},
			"ops": [
				{"op": "UI_SHOW", "screenId": "codex"},
				{"op": "TEXT_APPEND", "text": "after"},
				{"op": "WAIT_CLICK"}
			]
		})";
		FKaedePlaySession S;
		TestTrue(TEXT("loaded"), S.StartFromJson(Json));
		TestTrue(TEXT("wait=false does not block"), S.State().text.has_value());
		TestEqual(TEXT("screen still requested"), S.PendingUiScreen(), FString(TEXT("codex")));
	}
	{
		// screenId 無しは空振り（シナリオを止めない）。
		const std::string Json = R"({
			"id": "noscreen", "labels": {},
			"ops": [
				{"op": "UI_SHOW", "wait": true},
				{"op": "TEXT_APPEND", "text": "after"},
				{"op": "WAIT_CLICK"}
			]
		})";
		FKaedePlaySession S;
		TestTrue(TEXT("loaded"), S.StartFromJson(Json));
		TestTrue(TEXT("empty screenId does not block"), S.State().text.has_value());
	}
	return true;
}

// UI_SHOW の終了アクション jump:<label> がラベルへ飛ぶこと。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeUiShowJumpTest, "Kaede.Runtime.UiShowJump",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeUiShowJumpTest::RunTest(const FString& Parameters)
{
	// ops[3] を "far" ラベルにしておき、jump:far でそこへ飛ぶ。
	const std::string Json = R"({
		"id": "uijump",
		"labels": { "far": 3 },
		"ops": [
			{"op": "UI_SHOW", "screenId": "codex", "wait": true},
			{"op": "TEXT_APPEND", "text": "skipped"},
			{"op": "WAIT_CLICK"},
			{"op": "TEXT_APPEND", "text": "jumped"},
			{"op": "WAIT_CLICK"}
		]
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));
	S.NotifyUiAction(TEXT("jump:far"));
	TestTrue(TEXT("text present"), S.State().text.has_value());
	if (S.State().text.has_value())
	{
		TestEqual(TEXT("jumped past the skipped line"),
			FString(UTF8_TO_TCHAR(S.State().text->content.c_str())), FString(TEXT("jumped")));
	}

	// 未定義ラベルでも止まらず次の op へ進む。
	FKaedePlaySession S2;
	TestTrue(TEXT("scenario loaded (2)"), S2.StartFromJson(Json));
	S2.NotifyUiAction(TEXT("jump:nowhere"));
	TestTrue(TEXT("unknown label does not stall"), S2.State().text.has_value());
	if (S2.State().text.has_value())
	{
		TestEqual(TEXT("falls through to next op"),
			FString(UTF8_TO_TCHAR(S2.State().text->content.c_str())), FString(TEXT("skipped")));
	}
	return true;
}

// CAMERA_SET のパン/ズームと reset、時間補間。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeCameraTest, "Kaede.Runtime.Camera",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeCameraTest::RunTest(const FString& Parameters)
{
	const std::string Json = R"({
		"id": "camera-test", "labels": {},
		"ops": [
			{"op": "CAMERA_SET", "x": 100, "zoom": 2.0},
			{"op": "TEXT_APPEND", "text": "a"},
			{"op": "WAIT_CLICK"},
			{"op": "CAMERA_SET", "x": 300, "time": 200},
			{"op": "TEXT_APPEND", "text": "b"},
			{"op": "WAIT_CLICK"},
			{"op": "CAMERA_SET", "reset": true},
			{"op": "TEXT_APPEND", "text": "c"},
			{"op": "WAIT_CLICK"}
		]
	})";

	FKaedePlaySession S;
	TestTrue(TEXT("scenario loaded"), S.StartFromJson(Json));

	float X = 0.f, Y = 0.f;
	S.CameraOffset(X, Y);
	TestEqual(TEXT("pan applied immediately"), X, 100.0f);
	TestEqual(TEXT("y untouched"), Y, 0.0f);
	TestEqual(TEXT("zoom applied"), S.CameraZoom(), 2.0f);

    // time 付きは update が補間する。zoom は省略したので維持される。
	S.Tick(3000.0f);
	S.HandleClick();
	S.Tick(100.0f);
	S.CameraOffset(X, Y);
	TestTrue(TEXT("panning in progress"), X > 100.0f && X < 300.0f);
	TestEqual(TEXT("zoom kept while panning"), S.CameraZoom(), 2.0f);

	S.Tick(150.0f);
	S.CameraOffset(X, Y);
	TestEqual(TEXT("snapped to target"), X, 300.0f);

	// reset は他の引数より優先して初期状態へ戻す。
	S.Tick(3000.0f);
	S.HandleClick();
	S.Tick(16.0f);
	S.CameraOffset(X, Y);
	TestEqual(TEXT("reset pan"), X, 0.0f);
	TestEqual(TEXT("reset zoom"), S.CameraZoom(), 1.0f);
	return true;
}

// TEXT_STYLE（窓の色・名前の色。2026-10-11）: KSC の経路（DispatchDisplayOp）と JSON の経路（OpRunner）の両方で状態に入る。
// "default" で既定（空）に戻る。今の Game/scenario.json の 266 件はすべて "default"。
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FKaedeTextStyleTest, "Kaede.Runtime.TextStyle",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FKaedeTextStyleTest::RunTest(const FString& Parameters)
{
	FKaedeOpHandler H;
	int32 Completed = 0;
	kaedevn::Op Op;
	Op.type = kaedevn::opTypeFromString("TEXT_STYLE");
	Op.data = {{"op", "TEXT_STYLE"}, {"bgColor", "#203040"}, {"nameColor", "#ffcc00"}};
	TestTrue(TEXT("dispatch handles TEXT_STYLE"), kaedevn::DispatchDisplayOp(Op, H, [&Completed]() { ++Completed; }));
	TestEqual(TEXT("dispatch: bgColor"), FString(H.State().textBgColor.c_str()), FString(TEXT("#203040")));
	TestEqual(TEXT("dispatch: nameColor"), FString(H.State().nameColor.c_str()), FString(TEXT("#ffcc00")));
	TestEqual(TEXT("dispatch: completed"), Completed, 1);

	FKaedeOpHandler H2;
	kaedevn::OpRunner Runner;
	const kaedevn::CompiledScenario Sc = kaedevn::loadScenario(nlohmann::json{{"ops", {
		{{"op", "TEXT_STYLE"}, {"bgColor", "#112233"}, {"nameColor", "default"}},
		{{"op", "TEXT_STYLE"}, {"bgColor", "default"}, {"nameColor", "#445566"}}}}});
	Runner.start(Sc, &H2);
	Runner.tick();
	TestTrue(TEXT("runner: finished"), Runner.isFinished());
	TestTrue(TEXT("runner: default で既定（空）に戻る"), H2.State().textBgColor.empty());
	TestEqual(TEXT("runner: nameColor"), FString(H2.State().nameColor.c_str()), FString(TEXT("#445566")));
	return true;
}
