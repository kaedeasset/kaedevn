// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedePlaySession.cpp — OpRunner と FKaedeOpHandler を束ねた再生コントローラ。
//
// widget が触るのはこのクラスだけで済むようにするための薄い層。開始（デモ/JSON）・
// クリック等の入力転送・セーブ/ロード・状態の read-only アクセサを提供する。
//
// 開始直後に一度 tick() するのは、最初の待機 Op（WAIT_CLICK 等）まで同期 Op を
// 消化して「1フレーム目から本文が出ている」状態にするため。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "KaedePlaySession.h"
#include "KaedeVnLog.h"
#include "KaedeVnCore.h"   // KaedeCore::BuildDemoScenario / BuildPlayTree

void FKaedePlaySession::StartDemo()
{
	Scenario = KaedeCore::BuildDemoScenario();
	Runner.start(Scenario, &Handler);
	bStarted = true;
	Runner.tick();  // 最初の待機（WAIT_CLICK 等）まで同期 Op を消化する。
}

bool FKaedePlaySession::StartFromJson(const std::string& Json)
{
	try
	{
		Scenario = kaedevn::loadScenario(nlohmann::json::parse(Json));
	}
	catch (const nlohmann::json::exception& E)
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] シナリオの JSON を読めない: %s"), UTF8_TO_TCHAR(E.what()));
		return false;
	}
	if (Scenario.ops.empty()) return false;
	Runner.start(Scenario, &Handler);
	bStarted = true;
	Runner.tick();
	return true;
}

bool FKaedePlaySession::SetTimelinesFromJson(const std::string& Json)
{
	// 作品に timelines.json が無いのは正常（多くの作品はタイムラインを使わない）。
	// 壊れた JSON でもシナリオは止めず、TIMELINE_PLAY が空振りするだけにする。
	try
	{
		const nlohmann::json J = nlohmann::json::parse(Json);
		if (!J.is_object()) return false;
		Handler.SetTimelines(J);
		return true;
	}
	catch (const nlohmann::json::exception& E)
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] timelines.json を読めない（タイムラインなしで続ける）: %s"), UTF8_TO_TCHAR(E.what()));
		return false;
	}
}

void FKaedePlaySession::Tick(float DeltaMs)
{
	if (!bStarted) return;
	Handler.update(DeltaMs);
	Runner.tick();  // タイマー完了等で Executing に戻った場合に継続する。

	// フォーカスを有効範囲に保つ（選択肢が無ければ 0）。
	const int32 N = NumChoices();
	if (!IsWaitingForChoice() || N <= 0) FocusedChoice = 0;
	else FocusedChoice = FMath::Clamp(FocusedChoice, 0, N - 1);
}

void FKaedePlaySession::HandleClick()
{
	if (!bStarted) return;
	Handler.handleClick();  // 待機中の callback を発火し OpRunner を Executing に戻す。
	Runner.tick();          // 次の待機まで進める。
}

void FKaedePlaySession::SelectChoice(int32 Index)
{
	if (!bStarted) return;
	Handler.selectChoice(Index);  // CHOICE callback を発火（pc=jump）。
	FocusedChoice = 0;
	Runner.tick();
}

void FKaedePlaySession::FocusNext()
{
	const int32 N = NumChoices();
	if (IsWaitingForChoice() && N > 0) FocusedChoice = (FocusedChoice + 1) % N;
}

void FKaedePlaySession::FocusPrev()
{
	const int32 N = NumChoices();
	if (IsWaitingForChoice() && N > 0) FocusedChoice = (FocusedChoice - 1 + N) % N;
}

void FKaedePlaySession::SetFocus(int32 Index)
{
	const int32 N = NumChoices();
	if (IsWaitingForChoice() && N > 0) FocusedChoice = FMath::Clamp(Index, 0, N - 1);
}

void FKaedePlaySession::Confirm()
{
	if (!bStarted) return;
	if (IsWaitingForChoice()) SelectChoice(FocusedChoice);
	else HandleClick();
}

kaedevn::ui::UiNode FKaedePlaySession::CurrentTree() const
{
	return KaedeCore::BuildPlayTree(Handler.State(), bCompactLayout, LogicalW, LogicalH);
}

bool FKaedePlaySession::CanSave() const
{
	if (!bStarted) return false;
	const kaedevn::GameScreenState& St = Handler.State();
	// 安定した待ち（読んでいる最中／選択肢提示中）でのみセーブ可。
	return St.waitingForClick || St.waitingForChoice || St.waitingForPage;
}

std::string FKaedePlaySession::SaveToJson() const
{
	nlohmann::json J;
	// version 2: scene に sprites / mask / layers を追加（v1 のセーブも読める＝欠けは空扱い）。
	J["version"] = 2;
	J["pc"] = Runner.pc();
	J["vars"] = Runner.vars();
	J["read"] = Runner.readFlags();

	const kaedevn::GameScreenState& St = Handler.State();
	nlohmann::json Scene;
	Scene["bg"] = St.bgId;
	Scene["bgm"] = St.bgmId;
	Scene["bgmVol"] = St.bgmVol;
	Scene["filter"] = Handler.FilterName();
	Scene["filterIntensity"] = Handler.FilterIntensity();
	if (!St.textBgColor.empty() || !St.nameColor.empty())
		Scene["textStyle"] = { {"bgColor", St.textBgColor}, {"nameColor", St.nameColor} };

	nlohmann::json Chars = nlohmann::json::array();
	for (const auto& Kv : St.characters)
	{
		const kaedevn::ScreenCharacterState& C = Kv.second;
		Chars.push_back({ {"name", C.name}, {"pose", C.pose}, {"pos", C.pos} });
	}
	Scene["characters"] = Chars;

	if (St.text.has_value())
	{
		Scene["text"] = { {"speaker", St.text->speaker}, {"content", St.text->content} };
	}

	// スプライト（画像・テキストとも）。実作品では画面上の絵の大半がこれなので、
	// 保存しないとロード直後に画面から消える。version 2 で追加。
	nlohmann::json Sprites = nlohmann::json::array();
	for (const FKaedeSpriteItem& Sp : Handler.Sprites())
	{
		if (Sp.targetAlpha <= 0.0f) continue;   // 消去中のものは復元しない
		nlohmann::json S2;
		S2["id"] = Sp.id;
		S2["order"] = Sp.order;
		S2["x"] = Sp.x;
		S2["y"] = Sp.y;
		S2["scale"] = Sp.scale;
		S2["alpha"] = Sp.targetAlpha;
		if (Sp.bIsText)
		{
			S2["isText"] = true;
			S2["text"] = Sp.text;
			S2["fontSize"] = Sp.fontSize;
			S2["color"] = Sp.color;
			S2["bold"] = Sp.bBold;
		}
		else
		{
			S2["storage"] = Sp.storage;
		}
		Sprites.push_back(std::move(S2));
	}
	Scene["sprites"] = Sprites;

	// マスク（MASK_CLEAR まで維持する状態なので保存対象）。
	if (Handler.MaskAlpha() > 0.0f)
	{
		Scene["mask"] = { {"color", Handler.MaskColor()}, {"alpha", Handler.MaskAlpha()} };
	}

	// レイヤ（既定から変わっているものだけ）。
	nlohmann::json Layers = nlohmann::json::array();
	for (const auto& L : Handler.LayerSnapshots())
	{
		Layers.push_back({ {"name", L.name}, {"visible", L.bVisible}, {"opacity", L.opacity} });
	}
	if (!Layers.empty()) Scene["layers"] = Layers;

	J["scene"] = Scene;

	nlohmann::json Backlog = nlohmann::json::array();
	for (const FKaedeHistoryLine& H : Handler.History())
	{
		Backlog.push_back({ {"speaker", H.speaker}, {"text", H.text} });
	}
	J["backlog"] = Backlog;

	return J.dump(2);
}

bool FKaedePlaySession::LoadFromJson(const std::string& Json)
{
	if (Scenario.ops.empty()) return false;  // シナリオ未ロードでは復元不可

	nlohmann::json J;
	try { J = nlohmann::json::parse(Json); }
	catch (const nlohmann::json::exception& E)
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] セーブの JSON を読めない: %s"), UTF8_TO_TCHAR(E.what()));
		return false;
	}

	const int Pc = J.value("pc", -1);
	if (Pc < 0 || Pc >= (int)Scenario.ops.size()) return false;

	const nlohmann::json Vars = J.value("vars", nlohmann::json::object());
	const nlohmann::json Read = J.value("read", nlohmann::json::object());

	// 1) ハンドラを白紙化し、ランナーを保存位置へ resume。
	Handler.PrepareForLoad();
	Runner.resume(Scenario, &Handler, Pc, Vars, Read);
	bStarted = true;
	// 保存位置の待ち Op（WAIT_CLICK/CHOICE/PAGE）を再実行し、待ち状態＋コールバックを再装填する。
	// 同期 Op 上で保存されることは CanSave で禁じているため、ここでは 1 つの待ちで停止する。
	Runner.tick();

	// 2) 見た目（背景/立ち絵/本文/BGM/フィルター/履歴）を保存内容で上書き。
	kaedevn::GameScreenState Snap;
	std::vector<FKaedeHistoryLine> Hist;
	std::string Filter;
	float FilterIntensity = 0.0f;

	if (J.contains("scene") && J["scene"].is_object())
	{
		const nlohmann::json& Sc = J["scene"];
		Snap.bgId = Sc.value("bg", std::string());
		Snap.bgmId = Sc.value("bgm", std::string());
		Snap.bgmVol = Sc.value("bgmVol", 1.0f);
		if (Sc.contains("textStyle") && Sc["textStyle"].is_object())
		{
			Snap.textBgColor = Sc["textStyle"].value("bgColor", std::string());
			Snap.nameColor = Sc["textStyle"].value("nameColor", std::string());
		}
		Filter = Sc.value("filter", std::string());
		FilterIntensity = Sc.value("filterIntensity", 0.0f);

		if (Sc.contains("characters") && Sc["characters"].is_array())
		{
			for (const auto& C : Sc["characters"])
			{
				const std::string Name = C.value("name", std::string());
				if (Name.empty()) continue;
				kaedevn::ScreenCharacterState Cs;
				Cs.name = Name;
				Cs.pose = C.value("pose", std::string());
				Cs.pos = C.value("pos", std::string("center"));
				Cs.alpha = 1.0f;
				Cs.focused = false;
				Snap.characters[Name] = Cs;
			}
		}
		if (Sc.contains("text") && Sc["text"].is_object())
		{
			kaedevn::ScreenTextState Ts;
			Ts.content = Sc["text"].value("content", std::string());
			Ts.speaker = Sc["text"].value("speaker", std::string());
			Ts.displayedChars = (float)Ts.content.size();  // 全文表示で復元
			Ts.speed = 60.0f;
			Snap.text = Ts;
		}
	}
	if (J.contains("backlog") && J["backlog"].is_array())
	{
		for (const auto& H : J["backlog"])
		{
			Hist.push_back({ H.value("speaker", std::string()), H.value("text", std::string()) });
		}
	}

	Handler.RestoreScene(Snap, Filter, FilterIntensity, Hist);

	// 3) スプライト・マスク・レイヤ（version 2 以降。v1 のセーブでは空になるだけ）。
	std::vector<FKaedeSpriteItem> Sprites;
	std::string MaskColor;
	float MaskAlpha = 0.0f;
	std::vector<FKaedeOpHandler::FKaedeLayerSnapshot> Layers;

	if (J.contains("scene") && J["scene"].is_object())
	{
		const nlohmann::json& Sc = J["scene"];
		if (Sc.contains("sprites") && Sc["sprites"].is_array())
		{
			for (const auto& S2 : Sc["sprites"])
			{
				const std::string Id = S2.value("id", std::string());
				if (Id.empty()) continue;
				FKaedeSpriteItem Sp;
				Sp.id = Id;
				Sp.order = S2.value("order", 1);
				Sp.x = S2.value("x", 0.0f);
				Sp.y = S2.value("y", 0.0f);
				Sp.scale = S2.value("scale", 1.0f);
				Sp.targetAlpha = S2.value("alpha", 1.0f);
				Sp.bIsText = S2.value("isText", false);
				if (Sp.bIsText)
				{
					Sp.text = S2.value("text", std::string());
					Sp.fontSize = S2.value("fontSize", 24.0f);
					Sp.color = S2.value("color", std::string());
					Sp.bBold = S2.value("bold", false);
				}
				else
				{
					Sp.storage = S2.value("storage", std::string());
				}
				Sprites.push_back(std::move(Sp));
			}
		}
		if (Sc.contains("mask") && Sc["mask"].is_object())
		{
			MaskColor = Sc["mask"].value("color", std::string("#000000"));
			MaskAlpha = Sc["mask"].value("alpha", 0.0f);
		}
		if (Sc.contains("layers") && Sc["layers"].is_array())
		{
			for (const auto& L : Sc["layers"])
			{
				Layers.push_back({ L.value("name", std::string()),
				                   L.value("visible", true),
				                   L.value("opacity", 1.0f) });
			}
		}
	}
	Handler.RestoreExtras(Sprites, MaskColor, MaskAlpha, Layers);

	FocusedChoice = 0;
	return true;
}
