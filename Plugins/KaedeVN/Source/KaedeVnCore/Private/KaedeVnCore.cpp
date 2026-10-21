// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "Modules/ModuleManager.h"
#include "KaedeCoreSmoke.h"
#include "KaedeVnCore.h"
#include "KaedeVnLog.h"

// 純 C++ Core(nlohmann を引く)。例外有効・Unity 無効・IWYU None でこの .cpp 内に閉じる。
// UiNode の解析・prune・repeat・補間は MomijiUICore（MOMIJIUICORE_API で公開）を使う。
#include "core/UiNode.hpp"
#include "ui/Interp.hpp"
#include "Op.hpp"

#include <cmath>    // std::lround（論理解像度スケールの丸め）
#include <string>

IMPLEMENT_MODULE(FDefaultModuleImpl, KaedeVnCore);
DEFINE_LOG_CATEGORY(LogKaedeVn);

namespace
{
	// Play 画面テンプレート（Component Standard Phase 4）。
	// 幾何は native PlayScreenView.cpp と同一（PlayLayout 契約テストが座標を検証）だが、
	// 見た目はテーマ追従の Component Standard ロールへ移行:
	//   namebox   = nameplate（accent 金枠帯／文字 textOnAccent）
	//   textwindow= message-window（panel 面＋金枠／本文 textPrimary）
	//   choices   = choice-button（atelier-ghost、フォーカスは widget が accent リングで描く）
	// hex 直書き（青）を廃しテーマ11ロールに寄せたため、uiTheme（atelier/midnight/sakura）へ追従する。
	// ※ native テンプレートからは見た目が乖離（パリティ負債。geometry は不変）。
	const char* kPlayJson = R"JSON(
{
  "type": "Image", "anchor": "fill", "color": "#00000000",
  "children": [
    { "type": "Panel", "id": "namebox", "variant": "dark", "highlight": true, "x": 84, "y": 450, "w": 200, "h": 35,
      "showIf": "hasSpeaker", "children": [
      { "type": "Label", "text": "{speaker}", "x": 94, "y": 450, "w": 180, "h": 35,
        "font": "bold", "align": "left" } ] },
    { "type": "Panel", "id": "textwindow", "variant": "atelier-surface", "highlight": true,
      "x": 64, "y": 480, "w": 1152, "h": 200, "children": [
      { "type": "Label", "id": "body", "text": "{text}", "x": 84, "y": 500,
        "w": 1112, "h": 160, "wrapW": 1112, "font": "main",
        "align": "left" } ] },
    { "type": "VerticalLayout", "id": "choices", "x": 440, "y": 250, "w": 400, "h": 420,
      "gap": 10, "showIf": "waitingChoice", "repeat": "choices", "template": {
      "type": "Button", "h": 50, "variant": "atelier-ghost",
      "text": "{item.index}: {item.label}", "action": "play.choice:{item.index}" } },
    { "type": "Label", "id": "skip", "text": ">> SKIP MODE", "x": 1036, "y": 30,
      "w": 200, "h": 26, "font": "bold", "textColor": "#ff6464ff", "align": "left",
      "showIf": "skip" }
  ]
}
)JSON";

	// kPlayJson（1280x720 基準）を任意の論理サイズへ相似変換して返す（2解像度対応。
	// 設計 Docs/Reports/2026/07/25/02）。
	//
	// W==1280 && H==720 のときは kPlayJson をそのまま返す。つまり native/web との
	// パリティ契約（Kaede.UI.PlayLayout が固定する (64,480,1152,200) 等）は
	// **1文字も変わらない**。丸め誤差が混入する余地もない。
	//
	// 1920x1080 は厳密に 1.5 倍なので、全座標が整数のまま (96,720,1728,300) になる。
	// 16:9 以外を渡した場合も画面外へ出ないよう x/w は Kx、y/h は Ky で個別にスケールする
	// （この場合だけ本文枠の縦横比が崩れるが、運用は 16:9 の 2 段のみを想定）。
	//
	// 本文の基準フォントpx（SKaedeMomijiUIWidget の LogicalFontSizeBase と同じ 22）。
	// kPlayJson は fontSize を書かない＝「ホスト既定」で、painter は既定 px を知らないため
	// 行送りにハードコードの kLineH=30 を使う（KaedeUiPainter.cpp）。720p では
	// フォント22 に対し送り30 で成立するが、1080p ではフォントが 33 に太るのに送りが 30 の
	// ままで **行が重なる**。そこでスケール版だけ fontSize を明示して LineHFor に正しい
	// 送り（33 → 45）を計算させる。720p は kPlayJson をそのまま返すので契約は不変。
	//
	// ここを直さず painter 側の LineHFor を直すと、fontSize 無指定で wrapW を使っている
	// Game/ui/alchemist/*.json（23箇所）の行送りまで動くので採らない。
	constexpr int kVnBaseFontPt = 22;
	// 本文の行送り（論理px・1280x720 基準）。フォント22 × 1.7 = 37.4 → 37。
	// 既定の比 kLineHRatio(30/22 ≒ 1.36) は日本語には詰まりすぎで、1080p では
	// 「ぎりぎり重ならない」程度にしかならなかった（2026-07-28 実機確認）。
	// 日本語の本文は 1.5〜1.9 倍が読みやすいので 1.7 を採る。
	// 比を painter 側（kLineHRatio）で変えると Game/ui/alchemist/*.json の wrapW ノード
	// （fontSize 16/21 指定が10箇所以上）まで動くので、ノード単位の "lineH" で指定する。
	constexpr int kVnBaseLineHPx = 37;

	std::string MakePlayJson(int W, int H)
	{
		if (W == 1280 && H == 720) return std::string(kPlayJson);

		const double Kx = (double)W / 1280.0;
		const double Ky = (double)H / 720.0;
		const double Kf = Kx < Ky ? Kx : Ky;   // gap 等の等方スケール
		auto SX = [Kx](int V) { return std::to_string((int)std::lround(V * Kx)); };
		auto SY = [Ky](int V) { return std::to_string((int)std::lround(V * Ky)); };
		auto SF = [Kf](int V) { return std::to_string((int)std::lround(V * Kf)); };

		return std::string(R"JSON({
  "type": "Image", "anchor": "fill", "color": "#00000000",
  "children": [
    { "type": "Panel", "id": "namebox", "variant": "dark", "highlight": true, "x": )JSON")
			+ SX(84) + R"JSON(, "y": )JSON" + SY(450) + R"JSON(, "w": )JSON" + SX(200) + R"JSON(, "h": )JSON" + SY(35) + R"JSON(,
      "showIf": "hasSpeaker", "children": [
      { "type": "Label", "text": "{speaker}", "x": )JSON" + SX(94) + R"JSON(, "y": )JSON" + SY(450) + R"JSON(, "w": )JSON" + SX(180) + R"JSON(, "h": )JSON" + SY(35) + R"JSON(,
        "font": "bold", "align": "left" } ] },
    { "type": "Panel", "id": "textwindow", "variant": "atelier-surface", "highlight": true,
      "x": )JSON" + SX(64) + R"JSON(, "y": )JSON" + SY(480) + R"JSON(, "w": )JSON" + SX(1152) + R"JSON(, "h": )JSON" + SY(200) + R"JSON(, "children": [
      { "type": "Label", "id": "body", "text": "{text}", "x": )JSON" + SX(84) + R"JSON(, "y": )JSON" + SY(500) + R"JSON(,
        "w": )JSON" + SX(1112) + R"JSON(, "h": )JSON" + SY(160) + R"JSON(, "wrapW": )JSON" + SX(1112) + R"JSON(, "font": "main",
        "fontSize": )JSON" + SF(kVnBaseFontPt) + R"JSON(, "lineH": )JSON" + SY(kVnBaseLineHPx) + R"JSON(,
        "align": "left" } ] },
    { "type": "VerticalLayout", "id": "choices", "x": )JSON" + SX(440) + R"JSON(, "y": )JSON" + SY(250) + R"JSON(, "w": )JSON" + SX(400) + R"JSON(, "h": )JSON" + SY(420) + R"JSON(,
      "gap": )JSON" + SF(10) + R"JSON(, "showIf": "waitingChoice", "repeat": "choices", "template": {
      "type": "Button", "h": )JSON" + SY(50) + R"JSON(, "variant": "atelier-ghost",
      "text": "{item.index}: {item.label}", "action": "play.choice:{item.index}" } },
    { "type": "Label", "id": "skip", "text": ">> SKIP MODE", "x": )JSON" + SX(1036) + R"JSON(, "y": )JSON" + SY(30) + R"JSON(,
      "w": )JSON" + SX(200) + R"JSON(, "h": )JSON" + SY(26) + R"JSON(, "font": "bold", "textColor": "#ff6464ff", "align": "left",
      "showIf": "skip" }
  ]
})JSON";
	}

	// Play 画面テンプレート（コンパクト版）。「画面下部ストリップ」用（論理サイズは呼び出し側が
	// 渡す。16:9 の帯なら 427x240）。
	// 用途: ノベル画面を横に4枚並べる下部240px構成（Lvl_Sample2D_Quad）。
	//
	// なぜ別テンプレートなのか:
	//   kPlayJson の座標は native PlayScreenView.cpp とのパリティ契約で、Kaede.UI.PlayLayout
	//   契約テストが (64,480,1152,200) 等を固定している。1280x720 前提のこの幾何を 480x240 に
	//   流用すると全て画面外になるが、契約側は動かせない。ゆえに小画面用は別テンプレートを持つ。
	//   ロール/variant は kPlayJson と揃えてあるので uiTheme の切替には同じように追従する。
	//
	// フォントは論理=実画面の等倍で描かれる前提（480x240 スロットに等倍配置）なので、
	// 本文 16px は実測 16px。日本語の下限が 16px（Docs/Reports/2026/07/15/01）なのでこれ以上は下げない。
	//
	// 本文枠の高さは「入る文字数」から逆算している。wrapW=450 / fontSize=16 で 28文字/行、
	// 行送りは LineHFor(16)=22px（KaedeUiPainter.cpp kLineHRatio=30/22）。h=140 で 6行 = 168文字。
	//   実測（Game/scenario.json 174ページ）: 中央値 133 / p90 244 / 最大 523 文字
	//   → 168文字で 124/174 (71%) のページが収まる。h を 78 に切ると 84文字=6% しか収まらず本文が
	//      画面外へ溢れる（wrapW の折り返しは h でクリップされないため）。ゆえに本文枠を最優先で広げ、
	//      背景/立ち絵の見える範囲を上 80px に譲っている。
	// ⚠ 残り 29% のページは 240px 帯には入りきらない。この作品は 1280x720 の本文枠
	//    (1152x200 = 300文字, 95%が収まる) 前提で書かれているため、下部240px構成で全ページを
	//    収めるには「短いページで書かれたシナリオ」か「本文の自動改ページ」が別途必要。
	// 与えられた W x H から座標を組み立てる（480x240 のとき従来と同値）。
	// 固定文字列ではなく生成にしてあるのは、呼び出し側が「実際に割り当てられたスロット実寸」を
	// そのまま渡せるようにするため。こうすると縮尺が常に 1.0 になり、本文 16px が実 16px で出る。
	// 固定サイズにして実スロットとズレると、OnPaint のレターボックスで縮小され文字が潰れる
	//（実測: 480x240 固定のまま 341x192 のスロットへ入れたら縮尺0.71 → 本文が実11pxになった）。
	//
	// ⚠ 既知の制約: W,H でパラメータ化して見えるが、内部の定数は H=240 前提の逆算値。
	//   - TwY = H-160 の 160 は「本文6行(140px)を最優先で確保し、残りを背景に譲る」240 用の配分。
	//     H を増やしても本文枠は増えず、増分は全て上の背景へ行く。
	//   - 本文 fontSize は 16 固定（quad-strip.json の fontSize はここへは配線されていない）。
	//   - ChW=300 / SkipW=104 / namebox 96x18 等も非スケール。
	//   H=240 以外で運用する日が来たら、まずこの関数の配分を見直すこと。
	std::string MakeCompactPlayJson(int W, int H)
	{
		auto S = [](int V) { return std::to_string(V); };
		const int Pad = 6;                  // 本文枠の左右マージン
		const int TwY = H - 160;            // 本文枠の上端（H=240 → 80）
		const int TwW = W - Pad * 2;        // W=480 → 468
		const int TwH = H - TwY - 4;        // H=240 → 156
		const int BodyX = Pad + 9;          // 480 → 15
		const int BodyY = TwY + 8;          // 240 → 88
		const int BodyW = W - BodyX * 2;    // 480 → 450
		const int BodyH = H - BodyY - 12;   // 240 → 140
		const int ChW = 300;
		const int ChX = (W - ChW) / 2;
		const int SkipW = 104;
		const int SkipX = W - SkipW - 4;

		return std::string(R"JSON({
  "type": "Image", "anchor": "fill", "color": "#00000000",
  "children": [
    { "type": "Panel", "id": "namebox", "variant": "dark", "highlight": true, "x": 8, "y": )JSON")
			+ S(TwY - 22) + R"JSON(, "w": 96, "h": 18,
      "showIf": "hasSpeaker", "children": [
      { "type": "Label", "text": "{speaker}", "x": 12, "y": )JSON" + S(TwY - 22) + R"JSON(, "w": 88, "h": 18,
        "font": "bold", "fontSize": 12, "align": "left" } ] },
    { "type": "Panel", "id": "textwindow", "variant": "atelier-surface", "highlight": true,
      "x": )JSON" + S(Pad) + R"JSON(, "y": )JSON" + S(TwY) + R"JSON(, "w": )JSON" + S(TwW) + R"JSON(, "h": )JSON" + S(TwH) + R"JSON(, "children": [
      { "type": "Label", "id": "body", "text": "{text}", "x": )JSON" + S(BodyX) + R"JSON(, "y": )JSON" + S(BodyY) + R"JSON(,
        "w": )JSON" + S(BodyW) + R"JSON(, "h": )JSON" + S(BodyH) + R"JSON(, "wrapW": )JSON" + S(BodyW) + R"JSON(, "font": "main", "fontSize": 16,
        "align": "left" } ] },
    { "type": "VerticalLayout", "id": "choices", "x": )JSON" + S(ChX) + R"JSON(, "y": 4, "w": )JSON" + S(ChW) + R"JSON(, "h": )JSON" + S(TwY - 8) + R"JSON(,
      "gap": 4, "showIf": "waitingChoice", "repeat": "choices", "template": {
      "type": "Button", "h": 22, "variant": "atelier-ghost", "fontSize": 13,
      "text": "{item.index}: {item.label}", "action": "play.choice:{item.index}" } },
    { "type": "Label", "id": "skip", "text": ">> SKIP MODE", "x": )JSON" + S(SkipX) + R"JSON(, "y": 4,
      "w": )JSON" + S(SkipW) + R"JSON(, "h": 14, "font": "bold", "fontSize": 11, "textColor": "#ff6464ff", "align": "left",
      "showIf": "skip" }
  ]
})JSON";
	}

	// state（または固定値）から Play ツリーを組む共通実装。
	// bCompact=true はストリップ用テンプレート、false は全画面テンプレートを、いずれも
	// 論理サイズ W x H で生成する。W=1280,H=720 のとき全画面側は kPlayJson そのもの
	//（native とのパリティ契約）で、1920x1080 ならその 1.5 倍の相似形になる。
	kaedevn::ui::UiNode BuildTreeImpl(bool bHasText, const std::string& Speaker,
	                                  const std::string& Body, bool bWaitingChoice, bool bSkip,
	                                  const std::vector<std::string>* ChoiceLabels,
	                                  bool bCompact = false, int W = 1280, int H = 720)
	{
		using namespace kaedevn::ui;
		UiNode Root = screenFromJsonString(
			bCompact ? MakeCompactPlayJson(W, H) : MakePlayJson(W, H));

		VarEnv Env;
		Env.resolveStr = [&](const std::string& Key, std::string& Out) -> bool
		{
			if (Key == "speaker") { Out = Speaker; return true; }
			if (Key == "text")    { Out = Body;    return true; }
			return false;
		};
		Env.resolveNum = [&](const std::string& Key, double& Out) -> bool
		{
			if (Key == "hasSpeaker")    { Out = (bHasText && !Speaker.empty()) ? 1.0 : 0.0; return true; }
			if (Key == "waitingChoice") { Out = bWaitingChoice ? 1.0 : 0.0; return true; }
			if (Key == "skip")          { Out = bSkip ? 1.0 : 0.0; return true; }
			return false;
		};

		RepeatProvider Rp;
		Rp.getList = [&](const std::string& Name, std::vector<ItemScope>& Out) -> bool
		{
			if (Name == "choices" && bWaitingChoice && ChoiceLabels)
			{
				for (int i = 0; i < (int)ChoiceLabels->size(); ++i)
					Out.push_back({ {"index", std::to_string(i)}, {"label", (*ChoiceLabels)[i]} });
				return true;
			}
			return false;
		};

		prune(Root, Env);
		expandRepeats(Root, Rp);
		interpolateNode(Root, Env);
		return Root;
	}
}

namespace KaedeCore
{
	bool SmokeTest()
	{
		const std::string PlayJson =
			"{\"type\":\"panel\",\"children\":[{\"type\":\"label\",\"text\":\"hello\"}]}";
		const kaedevn::ui::UiNode Root = kaedevn::ui::screenFromJsonString(PlayJson);
		return !Root.children.empty();
	}

	kaedevn::ui::UiNode BuildDemoPlayTree()
	{
		const std::string Speaker = "ナナ";
		const std::string Body =
			"これは UE5 の Slate で描画したノベル本文です。"
			"MomijiUI の UiNode 契約を SDL2 native エンジンからそのまま移植しているので、"
			"web・native と同じ play.json が UE でも同じ画面を生みます。"
			"長い文章もテキストウィンドウの幅で自動的に折り返されます。";
		return BuildTreeImpl(/*bHasText*/ true, Speaker, Body, /*choice*/ false, /*skip*/ false, nullptr);
	}

	kaedevn::ui::UiNode BuildPlayTree(const kaedevn::GameScreenState& State, bool bCompact,
	                                  int LogicalW, int LogicalH)
	{
		const bool bHasText = State.text.has_value();
		const std::string Speaker = bHasText ? State.text->speaker : std::string();

		// タイプライター: displayedChars（バイト基準）までを可視にする。
		// UTF-8 の途中で切らないよう継続バイト境界まで後退する。
		std::string Body;
		if (bHasText)
		{
			const std::string& Full = State.text->content;
			int Shown = static_cast<int>(State.text->displayedChars);
			if (Shown < 0) Shown = 0;
			if (Shown >= static_cast<int>(Full.size()))
			{
				Body = Full;
			}
			else
			{
				while (Shown > 0 && (static_cast<unsigned char>(Full[Shown]) & 0xC0) == 0x80) --Shown;
				Body = Full.substr(0, Shown);
			}
		}

		const std::vector<std::string>* Labels =
			(State.waitingForChoice && State.choices.has_value()) ? &State.choices->labels : nullptr;
		return BuildTreeImpl(bHasText, Speaker, Body, State.waitingForChoice, State.skipMode, Labels,
		                     bCompact, LogicalW, LogicalH);
	}

	kaedevn::CompiledScenario BuildDemoScenario()
	{
		// テキスト → クリック → 選択肢 → 分岐 → 合流 のミニシナリオ。
		// CHOICE の jump は op の絶対 index（下のコメント番号と一致）。
		nlohmann::json J;
		J["id"] = "kaede-a2-demo";
		J["title"] = "kaedevn A2 demo";
		J["ops"] = nlohmann::json::array();
		auto Add = [&](nlohmann::json Op) { J["ops"].push_back(std::move(Op)); };

		Add({ {"op","BG_SET"}, {"id","bg1"} });                                                            // 0 背景(洞窟1)
		Add({ {"op","CH_SET"}, {"name","ch1"}, {"pos","center"}, {"fadeMs", 600} });                       // 1 立ち絵フェードイン
		Add({ {"op","TEXT_APPEND"}, {"who","ナナ"}, {"text","はじめまして。わたしはナナ。"} });          // 2
		Add({ {"op","WAIT_CLICK"} });                                                                       // 3
		Add({ {"op","TEXT_APPEND"}, {"who","ナナ"}, {"text","これは UE5 上で動くノベルエンジンのデモです。クリックで読み進められます。"} }); // 4
		Add({ {"op","WAIT_CLICK"} });                                                                       // 5
		Add({ {"op","BG_SET"}, {"id","bg2"}, {"fadeMs", 800} });                                            // 6 背景クロスフェード(洞窟1→2)
		Add({ {"op","TEXT_APPEND"}, {"who","ナナ"}, {"text","……日が暮れてきたね。"} });                  // 7
		Add({ {"op","WAIT_CLICK"} });                                                                       // 8
		Add({ {"op","TEXT_APPEND"}, {"who","ナナ"}, {"text","どちらのルートに進む？"} });                  // 9
		Add({ {"op","WAIT_CLICK"} });                                                                       // 10
		Add({ {"op","CHOICE"}, {"options", nlohmann::json::array({
			{ {"label","光の道へ"}, {"jump", 12} },
			{ {"label","影の道へ"}, {"jump", 16} } }) } });                                               // 11
		Add({ {"op","SCREEN_FILTER"}, {"filter","sepia"}, {"intensity", 1.0} });                           // 12 光: セピア（記憶の色）
		Add({ {"op","TEXT_APPEND"}, {"who","ナナ"}, {"text","光の道を選んだ。世界が淡いセピアに染まる。"} }); // 13
		Add({ {"op","WAIT_CLICK"} });                                                                       // 14
		Add({ {"op","JUMP"}, {"pc", 20} });                                                                 // 15
		Add({ {"op","SCREEN_FILTER"}, {"filter","cool"}, {"intensity", 0.9} });                            // 16 影: 寒色フィルター
		Add({ {"op","TEXT_APPEND"}, {"who","ナナ"}, {"text","影の道を選んだ。ひんやりと静かで落ち着く。"} }); // 17
		Add({ {"op","WAIT_CLICK"} });                                                                       // 18
		Add({ {"op","JUMP"}, {"pc", 20} });                                                                 // 19
		Add({ {"op","TEXT_APPEND"}, {"who","ナナ"}, {"text","これで デモはおしまい。お疲れさま！"} });     // 20
		Add({ {"op","WAIT_CLICK"} });                                                                       // 21

		return kaedevn::loadScenario(J);
	}

	int32 SkinVariantCount(int32 Family)
	{
		return Family == 1 ? 2 : 3;  // pc98=dark-console/peach-status、atelier=warm/dusk/light
	}

	kaedevn::ui::UiTheme SkinTheme(int32 Family, int32 Variant)
	{
		// トークンは仕様書のカラートークン表そのまま（04=pc98 / 05=premium-atelier）。
		// 共有 Core（builtinTheme）は触らず、UE ラッパ側の表として持つ。
		auto Hex = [](const char* S) -> kaedevn::ui::Color
		{
			auto Nib = [](char C) -> uint8 {
				if (C >= '0' && C <= '9') return (uint8)(C - '0');
				if (C >= 'a' && C <= 'f') return (uint8)(C - 'a' + 10);
				return (uint8)(C - 'A' + 10);
			};
			auto Byte = [&Nib](const char* P) { return (uint8)(Nib(P[0]) * 16 + Nib(P[1])); };
			kaedevn::ui::Color C{ Byte(S + 1), Byte(S + 3), Byte(S + 5), 255 };
			if (S[7] != '\0') C.a = Byte(S + 7);  // #rrggbbaa
			return C;
		};
		auto Make = [&Hex](const char* Bg, const char* Panel, const char* PanelLight,
		                   const char* PanelEdge, const char* Accent, const char* AccentDim,
		                   const char* Track, const char* Dim, const char* TextPrimary,
		                   const char* TextDim, const char* TextOnAccent)
		{
			kaedevn::ui::UiTheme T;
			T.bg = Hex(Bg); T.panel = Hex(Panel); T.panelLight = Hex(PanelLight);
			T.panelEdge = Hex(PanelEdge); T.accent = Hex(Accent); T.accentDim = Hex(AccentDim);
			T.track = Hex(Track); T.dim = Hex(Dim); T.textPrimary = Hex(TextPrimary);
			T.textDim = Hex(TextDim); T.textOnAccent = Hex(TextOnAccent);
			return T;
		};

		const int32 V = FMath::Clamp(Variant, 0, SkinVariantCount(Family) - 1);
		if (Family == 1)  // pc98（仕様書04）
		{
			if (V == 1)   // peach-status
				return Make("#101010", "#f1c9b5", "#ffe0cf", "#2a1715", "#c85f47", "#7a3d34",
				            "#1b1010", "#000000aa", "#1b1010", "#6a4a43", "#fff0df");
			// dark-console
			return Make("#080808", "#101010", "#fff0df", "#2a1715", "#f4d6b0", "#8a5a42",
			            "#000000dd", "#000000aa", "#fff0df", "#a58b7a", "#101010");
		}
		// premium-atelier（仕様書05）
		if (V == 1)       // dusk
			return Make("#17100c", "#2b2119", "#3a2b20", "#9f7650", "#d6a85f", "#6e5134",
			            "#100b08", "#000000b8", "#f1e5d0", "#a89476", "#1a100a");
		if (V == 2)       // light
			return Make("#e9dcc5", "#fff4dc", "#fffaf0", "#b98a46", "#8f5f24", "#c3a06a",
			            "#d8c39e", "#00000088", "#352414", "#765f42", "#fff8e8");
		// warm
		return Make("#241710", "#3a2a1a", "#4a3521", "#c9a45c", "#e6c87a", "#7a633e",
		            "#191009", "#000000aa", "#f5efe2", "#b8a684", "#241710");
	}
}
