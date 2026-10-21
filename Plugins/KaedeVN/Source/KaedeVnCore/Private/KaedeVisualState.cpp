// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "FKaedeOpHandler.h"

#include <cmath>

// ADV saves the visual state separately from its remaining command stream.
// Tween endpoints and elapsed times are retained; VM callbacks are never serialized.
//
// 形は名前つきのオブジェクト（{"camera":{"x":…}}）。2026-10-18 より前のセーブは
// 位置決めの配列（{"camera":[x, y, …]}）で、読めれば読む。壊れたセーブで落ちないよう、
// 読み手は例外を投げず、型の違い・配列の不足を見つけたら false を返して何も変えない。
nlohmann::json FKaedeOpHandler::SaveVisualState() const
{
	nlohmann::json J;
	J["background"] = state_.bgId;
	if (state_.bgTransition) {
		const auto& T = *state_.bgTransition;
		J["backgroundTransition"] = {{"fromId", T.fromId}, {"toId", T.toId}, {"effect", T.effect},
			{"progress", T.progress}, {"durationMs", T.durationMs}, {"elapsedMs", T.elapsedMs}};
	}
	const FKaedeCameraState& C = camera_;
	J["camera"] = {{"x", C.X}, {"y", C.Y}, {"zoom", C.Zoom},
		{"fromX", C.FromX}, {"fromY", C.FromY}, {"fromZoom", C.FromZoom},
		{"toX", C.ToX}, {"toY", C.ToY}, {"toZoom", C.ToZoom},
		{"remainMs", C.Tween.RemainMs}, {"durMs", C.Tween.DurMs}};
	J["mask"] = {{"color", mask_.Color}, {"alpha", mask_.Alpha}, {"from", mask_.From},
		{"targetAlpha", mask_.TargetAlpha}, {"remainMs", mask_.Tween.RemainMs}, {"durMs", mask_.Tween.DurMs}};
	J["shake"] = {{"durMs", shake_.DurMs}, {"remainMs", shake_.RemainMs},
		{"elapsedMs", shake_.ElapsedMs}, {"intensity", shake_.Intensity}};
	J["fade"] = {{"mode", static_cast<int>(fade_.Mode)}, {"white", fade_.bWhite}, {"alpha", fade_.Alpha},
		{"durMs", fade_.DurMs}, {"elapsedMs", fade_.ElapsedMs}};
	J["transitionLayer"] = pendingTransitionLayer_;
	J["sprites"] = nlohmann::json::array();
	for (const auto& S : sprites_) J["sprites"].push_back({
		{"id", S.id}, {"storage", S.storage}, {"order", S.order}, {"isText", S.bIsText},
		{"text", S.text}, {"fontSize", S.fontSize}, {"color", S.color}, {"bold", S.bBold},
		{"transform", {{"x", S.x}, {"y", S.y}, {"scale", S.scale}, {"alpha", S.alpha},
			{"targetAlpha", S.targetAlpha}, {"fadeRemainMs", S.Fade.RemainMs}, {"fadeDurMs", S.Fade.DurMs},
			{"xFrom", S.xFrom}, {"xTo", S.xTo}, {"yFrom", S.yFrom}, {"yTo", S.yTo},
			{"scaleFrom", S.scaleFrom}, {"scaleTo", S.scaleTo},
			{"moveRemainMs", S.Move.RemainMs}, {"moveDurMs", S.Move.DurMs}}}});
	J["overlays"] = nlohmann::json::array();
	for (const auto& O : overlayItems_) J["overlays"].push_back({{"id", O.id}, {"x", O.x}, {"y", O.y},
		{"scale", O.scale}, {"alpha", O.alpha}, {"targetAlpha", O.targetAlpha},
		{"fadeRemainMs", O.Fade.RemainMs}, {"fadeDurMs", O.Fade.DurMs}});
	J["layers"] = nlohmann::json::object();
	for (const auto& L : layers_) J["layers"][L.first] = {{"visible", L.second.bVisible},
		{"opacity", L.second.opacity}, {"transRemainMs", L.second.Trans.RemainMs}, {"transDurMs", L.second.Trans.DurMs}};
	return J;
}

namespace
{
	using FJson = nlohmann::json;

	// 1 まとまり（camera・mask など）の読み手。名前つきなら鍵で、古い配列なら位置で引く。
	// 鍵が無いものは既定値のまま。型の違い・配列の不足は bOk を落とす。
	struct FGroup
	{
		const FJson* G = nullptr;
		bool& bOk;

		FGroup(const FJson* InG, bool& InOk) : G(InG), bOk(InOk)
		{
			if (G && !G->is_object() && !G->is_array()) bOk = false;
		}
		const FJson* Get(const char* Key, size_t Index) const
		{
			if (!G) return nullptr;
			if (G->is_object()) {
				const auto It = G->find(Key);
				return It != G->end() ? &*It : nullptr;
			}
			if (G->is_array()) {
				if (Index < G->size()) return &(*G)[Index];
				bOk = false;
			}
			return nullptr;
		}
		void Num(const char* Key, size_t Index, float& Out) const
		{
			const FJson* V = Get(Key, Index);
			if (!V) return;
			if (!V->is_number()) { bOk = false; return; }
			const float F = V->get<float>();
			if (!std::isfinite(F)) { bOk = false; return; }
			Out = F;
		}
		void Int(const char* Key, size_t Index, int& Out) const
		{
			const FJson* V = Get(Key, Index);
			if (!V) return;
			if (!V->is_number_integer()) { bOk = false; return; }
			Out = V->get<int>();
		}
		void Bool(const char* Key, size_t Index, bool& Out) const
		{
			const FJson* V = Get(Key, Index);
			if (!V) return;
			if (!V->is_boolean()) { bOk = false; return; }
			Out = V->get<bool>();
		}
		void Str(const char* Key, size_t Index, std::string& Out) const
		{
			const FJson* V = Get(Key, Index);
			if (!V) return;
			if (!V->is_string()) { bOk = false; return; }
			Out = V->get<std::string>();
		}
	};

	const FJson* FieldOf(const FJson& O, const char* Key)
	{
		if (!O.is_object()) return nullptr;
		const auto It = O.find(Key);
		return It != O.end() ? &*It : nullptr;
	}
}

bool FKaedeOpHandler::RestoreVisualState(const nlohmann::json& J)
{
	if (!J.is_object()) return false;

	// 既定の状態から組み立て、全部読めたときだけ自分へ移す（途中で失敗しても今の見た目は残る）。
	FKaedeOpHandler Next;
	bool bOk = true;
	const FGroup Top(&J, bOk);

	Top.Str("background", 0, Next.state_.bgId);
	if (const FJson* V = FieldOf(J, "backgroundTransition")) {
		const FGroup T(V, bOk);
		kaedevn::BgTransition Tr;
		T.Str("fromId", 0, Tr.fromId); T.Str("toId", 1, Tr.toId); T.Str("effect", 2, Tr.effect);
		T.Num("progress", 3, Tr.progress); T.Num("durationMs", 4, Tr.durationMs); T.Num("elapsedMs", 5, Tr.elapsedMs);
		Next.state_.bgTransition = Tr;
	}

	FKaedeCameraState& Cam = Next.camera_;
	const FGroup C(FieldOf(J, "camera"), bOk);
	C.Num("x", 0, Cam.X); C.Num("y", 1, Cam.Y); C.Num("zoom", 2, Cam.Zoom);
	C.Num("fromX", 3, Cam.FromX); C.Num("fromY", 4, Cam.FromY); C.Num("fromZoom", 5, Cam.FromZoom);
	C.Num("toX", 6, Cam.ToX); C.Num("toY", 7, Cam.ToY); C.Num("toZoom", 8, Cam.ToZoom);
	C.Num("remainMs", 9, Cam.Tween.RemainMs); C.Num("durMs", 10, Cam.Tween.DurMs);

	FKaedeMaskState& Mask = Next.mask_;
	const FGroup M(FieldOf(J, "mask"), bOk);
	M.Str("color", 0, Mask.Color); M.Num("alpha", 1, Mask.Alpha); M.Num("from", 2, Mask.From);
	M.Num("targetAlpha", 3, Mask.TargetAlpha); M.Num("remainMs", 4, Mask.Tween.RemainMs); M.Num("durMs", 5, Mask.Tween.DurMs);

	const FGroup H(FieldOf(J, "shake"), bOk);
	H.Num("durMs", 0, Next.shake_.DurMs); H.Num("remainMs", 1, Next.shake_.RemainMs);
	H.Num("elapsedMs", 2, Next.shake_.ElapsedMs); H.Num("intensity", 3, Next.shake_.Intensity);

	FKaedeFadeState& Fade = Next.fade_;
	const FGroup F(FieldOf(J, "fade"), bOk);
	int Mode = static_cast<int>(EOverlayMode::None);
	F.Int("mode", 0, Mode);
	if (Mode < static_cast<int>(EOverlayMode::None) || Mode > static_cast<int>(EOverlayMode::Flash)) bOk = false;
	else Fade.Mode = static_cast<EOverlayMode>(Mode);
	F.Bool("white", 1, Fade.bWhite); F.Num("alpha", 2, Fade.Alpha);
	F.Num("durMs", 3, Fade.DurMs); F.Num("elapsedMs", 4, Fade.ElapsedMs);

	Top.Str("transitionLayer", 0, Next.pendingTransitionLayer_);

	if (const FJson* List = FieldOf(J, "sprites")) {
		if (!List->is_array()) bOk = false;
		else for (const auto& V : *List) {
			if (!V.is_object()) { bOk = false; break; }
			const FGroup G(&V, bOk);
			FKaedeSpriteItem S;
			G.Str("id", 0, S.id); G.Str("storage", 0, S.storage); G.Int("order", 0, S.order); G.Bool("isText", 0, S.bIsText);
			G.Str("text", 0, S.text); G.Num("fontSize", 0, S.fontSize); G.Str("color", 0, S.color); G.Bool("bold", 0, S.bBold);
			const FGroup T(FieldOf(V, "transform"), bOk);
			T.Num("x", 0, S.x); T.Num("y", 1, S.y); T.Num("scale", 2, S.scale); T.Num("alpha", 3, S.alpha);
			T.Num("targetAlpha", 4, S.targetAlpha); T.Num("fadeRemainMs", 5, S.Fade.RemainMs); T.Num("fadeDurMs", 6, S.Fade.DurMs);
			T.Num("xFrom", 7, S.xFrom); T.Num("xTo", 8, S.xTo); T.Num("yFrom", 9, S.yFrom); T.Num("yTo", 10, S.yTo);
			T.Num("scaleFrom", 11, S.scaleFrom); T.Num("scaleTo", 12, S.scaleTo);
			T.Num("moveRemainMs", 13, S.Move.RemainMs); T.Num("moveDurMs", 14, S.Move.DurMs);
			Next.sprites_.push_back(std::move(S));
		}
	}

	if (const FJson* List = FieldOf(J, "overlays")) {
		if (!List->is_array()) bOk = false;
		else for (const auto& V : *List) {
			const FGroup G(&V, bOk);
			FKaedeOverlayItem O;
			G.Str("id", 0, O.id); G.Num("x", 1, O.x); G.Num("y", 2, O.y); G.Num("scale", 3, O.scale);
			G.Num("alpha", 4, O.alpha); G.Num("targetAlpha", 5, O.targetAlpha);
			G.Num("fadeRemainMs", 6, O.Fade.RemainMs); G.Num("fadeDurMs", 7, O.Fade.DurMs);
			Next.overlayItems_.push_back(std::move(O));
		}
	}

	if (const FJson* Map = FieldOf(J, "layers")) {
		if (!Map->is_object()) bOk = false;
		else for (const auto& V : Map->items()) {
			const FGroup G(&V.value(), bOk);
			FKaedeLayerState L;
			G.Bool("visible", 0, L.bVisible); G.Num("opacity", 1, L.opacity);
			G.Num("transRemainMs", 2, L.Trans.RemainMs); G.Num("transDurMs", 3, L.Trans.DurMs);
			Next.layers_[V.key()] = L;
		}
	}

	if (!bOk) return false;

	state_.bgId = std::move(Next.state_.bgId);
	state_.bgTransition = std::move(Next.state_.bgTransition);
	camera_ = Next.camera_;
	mask_ = std::move(Next.mask_);
	shake_ = Next.shake_;
	fade_ = Next.fade_;
	pendingTransitionLayer_ = std::move(Next.pendingTransitionLayer_);
	sprites_ = std::move(Next.sprites_);
	overlayItems_ = std::move(Next.overlayItems_);
	layers_ = std::move(Next.layers_);
	return true;
}
