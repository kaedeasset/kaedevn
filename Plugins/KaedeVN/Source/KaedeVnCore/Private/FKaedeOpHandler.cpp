// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// FKaedeOpHandler.cpp — Op を GameScreenState の更新へ翻訳する（IOpHandler の UE 実装）。
//
// **描画は一切しない。** 状態だけを持ち、KaedeVnUI の widget がそれを読んで Slate で描く。
//
// 非同期 Op の作りは全て同じ形:
//   1. handler メソッドが「残り時間」と onComplete を状態として持つ
//   2. update(deltaMs) が時間を進め、尽きたら onComplete を呼ぶ
//   3. OpRunner はそのコールバックが来るまで pc を進めない
// 待機（WAIT_CLICK/WAIT_MS）・画面エフェクト（SHAKE/FLASH/FADE_*）がこの形。
// 一方 CH_MOVE と画像オーバーレイは**同期扱い**で、呼んだ時点で次の Op へ進み、
// 動き自体は update が裏で進める（移動中も本文を送れる）。
//
// 演出の状態は小さな構造体（camera_・mask_・shake_・fade_）ごとに持ち、待ちのコールバックは pending_ にまとめる。
// PrepareForLoad はそれを構造体ごと既定値へ戻す（ロード直後に暗転が残ったり、揺れの途中から始まったりしないため）。
// 補間の時計は FKaedeTween の 1 つ（FKaedeOpHandler.h）。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "FKaedeOpHandler.h"
#include "KaedeVnLog.h"
#include "GameScreenUpdater.hpp"  // kaedevn::updateGameScreen

#include <algorithm>              // std::min / std::max / std::remove_if
#include <cmath>                  // std::sin（SHAKE の揺れ位相）
#include <utility>                // std::forward

using kaedevn::ScreenTextState;
using kaedevn::ScreenChoiceState;
using kaedevn::ScreenCharacterState;

float FKaedeTween::Step(float& RemainMs, float& DurMs, float DeltaMs, bool bEase)
{
	if (RemainMs <= 0.0f || DurMs <= 0.0f) return 1.0f;
	RemainMs = std::max(0.0f, RemainMs - DeltaMs);
	const float T = 1.0f - (RemainMs / DurMs);
	if (RemainMs <= 0.0f) DurMs = 0.0f;
	// 等速だと機械的に見えるものは、両端を緩めた 3t²-2t³（smoothstep）を使う。
	return bEase ? T * T * (3.0f - 2.0f * T) : T;
}

namespace
{
	// 一枚絵・スプライトの alpha を Target へ FadeMs かけて寄せ始める。時間なしならその場で Target にする。
	template <typename TItem>
	void StartFade(TItem& It, float Target, float FadeMs)
	{
		It.targetAlpha = Target;
		It.Fade.Start(FadeMs);
		if (!It.Fade.Active()) It.alpha = Target;
	}

	// 一枚絵・スプライトの alpha のフェードを進める。出るときは 0 から、消えるときは 1 から。
	template <typename TItem>
	void AdvanceFade(TItem& It, float DeltaMs)
	{
		const float From = (It.targetAlpha > 0.5f) ? 0.0f : 1.0f;
		It.alpha = FKaedeTween::Lerp(From, It.targetAlpha, It.Fade.Advance(DeltaMs));
	}

	// 待ちのコールバックを取り出して空にしてから呼ぶ（呼んだ先で次の待ちが入っても消さない）。
	template <typename TCallback, typename... TArgs>
	void Fire(TCallback& Cb, TArgs&&... Args)
	{
		TCallback Taken = std::move(Cb);
		Cb = nullptr;
		if (Taken) Taken(std::forward<TArgs>(Args)...);
	}
}

// タイプライター速度は textSpeed_ メンバ（既定 60 バイト/秒 ≒ 日本語 20 字/秒）。
// 設定画面のメッセージ速度から SetTextSpeed で可変（旧 kTextSpeed 定数を置換）。

void FKaedeOpHandler::textAppend(const std::string& who, const std::string& text)
{
	if (!who.empty()) pendingSpeaker_ = who;
	textBuffer_ += text;
}

void FKaedeOpHandler::textNl()
{
	textBuffer_ += "\n";
}

void FKaedeOpHandler::textStyle(const std::string& bgColor, const std::string& nameColor)
{
	// "default" と空は既定（今の窓の色）に戻す。色をどう描くかは描画側が state_ を見て決める
	state_.textBgColor = (bgColor == "default") ? std::string() : bgColor;
	state_.nameColor = (nameColor == "default") ? std::string() : nameColor;
}

void FKaedeOpHandler::textClear(const std::string& target)
{
	// Tyrano [cm]（target="all"）/ [er]（target="current"）相当。
	// PAGE と違いクリック待ちをしない＝呼んだ直後に次の Op へ進む。
	// kaedevn のメッセージ枠は1面だけなので、どちらも表示中の本文を消す。
	// 違いは「未確定の入力バッファも捨てるか」だけにしてある:
	//   all     … 表示中＋未確定バッファ＋話者を全部捨てる（画面を完全に白紙へ）
	//   current … 表示中だけ消す（直後に積み始めた次の本文は残す）
	// バックログ（history_）には触らない。既読は消さない。
	state_.text.reset();
	if (target != "current")
	{
		textBuffer_.clear();
		pendingSpeaker_.clear();
	}
}

void FKaedeOpHandler::ShowPendingText()
{
	// 本文が確定した時点でバックログに積む（空行は積まない＝ロード時の再装填も無害）。
	if (!textBuffer_.empty()) history_.push_back({ pendingSpeaker_, textBuffer_ });
	// タイプライター: displayedChars=0 から開始し update() で徐々に表示する。
	state_.text = ScreenTextState{ textBuffer_, pendingSpeaker_, 0.0f, textSpeed_ };
	textBuffer_.clear();
}

void FKaedeOpHandler::waitClick(Callback onComplete)
{
	ShowPendingText();
	state_.waitingForClick = true;
	pending_.Click = std::move(onComplete);
}

void FKaedeOpHandler::page(Callback onComplete)
{
	ShowPendingText();
	state_.waitingForPage = true;
	pending_.Page = std::move(onComplete);
}

void FKaedeOpHandler::waitMs(int ms, Callback onComplete)
{
	state_.waitTimerMs = 0.0f;
	state_.waitTargetMs = static_cast<float>(ms);
	state_.waitingForTimer = true;
	pending_.Wait = std::move(onComplete);
}

void FKaedeOpHandler::bgSet(const std::string& id, int fadeMs, const std::string& effect, float, float, float)
{
	if (fadeMs > 0 && !state_.bgId.empty() && state_.bgId != id)
	{
		// クロスフェード開始。完了は updateGameScreen が bgId=toId にして reset する。
		kaedevn::BgTransition t;
		t.fromId = state_.bgId;
		t.toId = id;
		t.effect = effect.empty() ? "fade" : effect;
		t.durationMs = static_cast<float>(fadeMs);
		t.elapsedMs = 0.0f;
		t.progress = 0.0f;
		state_.bgTransition = t;
	}
	else
	{
		state_.bgId = id;
		state_.bgTransition.reset();
	}
}
void FKaedeOpHandler::bgClear(int) { state_.bgId.clear(); state_.bgTransition.reset(); }

void FKaedeOpHandler::chSet(const std::string& name, const std::string& pose,
                            const std::string& pos, int fadeMs, float, float, float)
{
	const float a0 = (fadeMs > 0) ? 0.0f : 1.0f;  // フェードインは 0 から
	ScreenCharacterState St{ name, pose, pos, a0, false };
	// 表示位置の正は xNorm。pos から初期化するので CH_MOVE を使わない作品は従来どおり。
	St.xNorm = St.xNormFrom = St.xNormTo = kaedevn::PosToXNorm(pos);
	state_.characters[name] = std::move(St);
	charFadeDurMs_[name] = static_cast<float>(fadeMs);
}

void FKaedeOpHandler::chMove(const std::string& name, const std::string& pos,
                             int durationMs, float x, float /*y*/)
{
	auto It = state_.characters.find(name);
	if (It == state_.characters.end()) return;   // 出ていないキャラは黙って無視
	ScreenCharacterState& Ch = It->second;

	// 目標位置: pos があればスロット、無ければ x を正規化値として受ける。
	const float To = !pos.empty() ? kaedevn::PosToXNorm(pos)
	                              : std::min(1.0f, std::max(0.0f, x));
	if (!pos.empty()) Ch.pos = pos;   // 以後の chSet 等と食い違わないよう追従させる

	Ch.xNormFrom = Ch.xNorm;
	Ch.xNormTo = To;
	if (durationMs <= 0)
	{
		Ch.xNorm = To;
		Ch.moveRemainMs = Ch.moveDurMs = 0.0f;
		return;
	}
	Ch.moveDurMs = Ch.moveRemainMs = static_cast<float>(durationMs);
}
void FKaedeOpHandler::chExpr(const std::string& name, const std::string& expression, int fadeMs)
{
	auto It = state_.characters.find(name);
	if (It == state_.characters.end()) return;   // 出ていないキャラは黙って無視（TS と同じ）
	ScreenCharacterState& Ch = It->second;

	// 同じ表情への差し替えは何もしない（無用な再フェードで画がちらつくのを防ぐ）。
	if (Ch.pose == expression) return;

	Ch.pose = expression;

	// fadeMs>0 なら差し替えた絵を 0 からフェードインさせる（立ち絵の chSet と同じ経路）。
	// 描画側は name+pose で絵を解決するので、pose を変えた時点で見た目が変わる。
	if (fadeMs > 0)
	{
		Ch.alpha = 0.0f;
		charFadeDurMs_[name] = static_cast<float>(fadeMs);
	}
	else
	{
		Ch.alpha = 1.0f;
		charFadeDurMs_[name] = 0.0f;
	}
}
void FKaedeOpHandler::chHide(const std::string& name, int) { state_.characters.erase(name); }
void FKaedeOpHandler::chClear(int) { state_.characters.clear(); }

void FKaedeOpHandler::bgmPlay(const std::string& id, float vol, int) { state_.bgmId = id; state_.bgmVol = vol; }
void FKaedeOpHandler::bgmStop(int) { state_.bgmId.clear(); }
void FKaedeOpHandler::sePlay(const std::string&, float) {}
void FKaedeOpHandler::voicePlay(const std::string&) {}

void FKaedeOpHandler::showChoices(const std::vector<std::string>& labels, IntCallback onComplete)
{
	// 選択肢の直前の本文（「どうする？」）は、クリック待ちを挟まずに書かれる（KS の選択肢の書き方）。
	// 溜めたまま選択肢を出すと問いが画面に出ず、選んだ後の次の本文とつながって出ていた（2026-10-21・kaedevn-trace で発見）。
	// 溜めた本文があるときだけ出す（無いときに出すと、表示中の前の文を空で上書きする）。
	if (!textBuffer_.empty()) ShowPendingText();
	state_.choices = ScreenChoiceState{ labels, {}, -1 };
	state_.waitingForChoice = true;
	pending_.Choice = std::move(onComplete);
}

void FKaedeOpHandler::screenFilter(const std::string& filter, float intensity, const FilterParams&)
{
	filterName_ = filter;
	filterIntensity_ = intensity;
}
void FKaedeOpHandler::screenFilterClear()
{
	filterName_.clear();
	filterIntensity_ = 0.0f;
}

void FKaedeOpHandler::update(float deltaMs)
{
	if (state_.text.has_value()) state_.text->speed = textSpeed_;
	kaedevn::updateGameScreen(state_, deltaMs);

	// 立ち絵フェードイン: alpha を duration かけて 1.0 へ。
	for (auto& Kv : state_.characters)
	{
		auto It = charFadeDurMs_.find(Kv.first);
		const float Dur = (It != charFadeDurMs_.end()) ? It->second : 0.0f;
		if (Dur > 0.0f && Kv.second.alpha < 1.0f)
		{
			Kv.second.alpha = std::min(1.0f, Kv.second.alpha + deltaMs / Dur);
		}

		// CH_MOVE の水平移動: ease-in-out で xNormFrom → xNormTo。
		ScreenCharacterState& Ch = Kv.second;
		if (Ch.moveRemainMs > 0.0f && Ch.moveDurMs > 0.0f)
		{
			const float T = FKaedeTween::Step(Ch.moveRemainMs, Ch.moveDurMs, deltaMs, /*bEase*/ true);
			Ch.xNorm = FKaedeTween::Lerp(Ch.xNormFrom, Ch.xNormTo, T);
		}
	}

	// タイマー完了 → コールバック発火（Handler の責務）。
	if (state_.waitingForTimer && state_.waitTimerMs >= state_.waitTargetMs)
	{
		state_.waitingForTimer = false;
		Fire(pending_.Wait);
	}

	// ===== 画像オーバーレイ: alpha を target へ寄せ、消えきったら捨てる =====
	for (auto& It : overlayItems_) AdvanceFade(It, deltaMs);
	overlayItems_.erase(
		std::remove_if(overlayItems_.begin(), overlayItems_.end(),
			[](const FKaedeOverlayItem& It)
			{ return It.targetAlpha <= 0.0f && It.alpha <= 0.0f; }),
		overlayItems_.end());

	// ===== スプライト: 移動・スケール・alpha を進め、消えきったら捨てる =====
	for (auto& It : sprites_)
	{
		if (It.Move.Active())
		{
			const float T = It.Move.Advance(deltaMs);
			It.x = FKaedeTween::Lerp(It.xFrom, It.xTo, T);
			It.y = FKaedeTween::Lerp(It.yFrom, It.yTo, T);
			It.scale = FKaedeTween::Lerp(It.scaleFrom, It.scaleTo, T);
		}
		AdvanceFade(It, deltaMs);
	}
	sprites_.erase(
		std::remove_if(sprites_.begin(), sprites_.end(),
			[](const FKaedeSpriteItem& It)
			{ return It.targetAlpha <= 0.0f && It.alpha <= 0.0f; }),
		sprites_.end());

	// ===== タイムライン: 再生位置を進め、評価結果をスプライトへ流す =====
	// **スプライトの掃除より後**に置く。ここで alpha を書くので、上のトゥイーン処理に
	// 上書きされてはいけない（update の順序がそのまま優先順位になっている）。
	if (!activeTimelines_.empty())
	{
		std::vector<Callback> Finished;   // 走査中に OpRunner を再入させないため後で撃つ
		for (auto& T : activeTimelines_)
		{
			T.elapsedMs += deltaMs;
			const float Now = std::min(T.elapsedMs, T.durationMs);
			ApplyTimelineResults(kaedevn::EvaluateTimeline(T.root, Now));
			if (T.elapsedMs >= T.durationMs && T.onComplete)
			{
				Finished.push_back(std::move(T.onComplete));
				T.onComplete = nullptr;
			}
		}
		activeTimelines_.erase(
			std::remove_if(activeTimelines_.begin(), activeTimelines_.end(),
				[](const FKaedeActiveTimeline& T)
				{ return T.elapsedMs >= T.durationMs; }),
			activeTimelines_.end());
		for (auto& cb : Finished) if (cb) cb();
	}

	// ===== カメラ: パン/ズームを ease-in-out で To へ寄せる =====
	if (camera_.Tween.Active())
	{
		const float T = camera_.Tween.Advance(deltaMs, /*bEase*/ true);
		camera_.X    = FKaedeTween::Lerp(camera_.FromX,    camera_.ToX,    T);
		camera_.Y    = FKaedeTween::Lerp(camera_.FromY,    camera_.ToY,    T);
		camera_.Zoom = FKaedeTween::Lerp(camera_.FromZoom, camera_.ToZoom, T);
	}
	if (camera_.Tween.RemainMs <= 0.0f) Fire(pending_.Camera);

	// ===== マスク: 全画面カラーを target へ寄せる（clear まで維持するので破棄しない）=====
	if (mask_.Tween.Active())
	{
		mask_.Alpha = FKaedeTween::Lerp(mask_.From, mask_.TargetAlpha, mask_.Tween.Advance(deltaMs));
	}

	// ===== レイヤのトランジション: opacity 0→1。完了で WAIT_TRANSITION を解放 =====
	for (auto& Kv : layers_)
	{
		FKaedeLayerState& L = Kv.second;
		if (!L.Trans.Active()) continue;

		L.opacity = L.Trans.Advance(deltaMs);
		if (!L.Trans.Active() && pendingTransitionLayer_ == Kv.first && pending_.Transition)
		{
			pendingTransitionLayer_.clear();
			Fire(pending_.Transition);
		}
	}

	// ===== SHAKE: 残時間を減らし、尽きたら完了通知 =====
	if (shake_.RemainMs > 0.0f)
	{
		shake_.ElapsedMs += deltaMs;
		shake_.RemainMs -= deltaMs;
		if (shake_.RemainMs <= 0.0f)
		{
			shake_.RemainMs = 0.0f;
			shake_.Intensity = 0.0f;   // 揺れを完全に止める（半端な位置で固まらないように）
			Fire(pending_.Shake);
		}
	}

	// ===== 全画面オーバーレイ: 経過割合から alpha を決め、尽きたら完了通知 =====
	if (fade_.Mode != EOverlayMode::None && fade_.DurMs > 0.0f)
	{
		fade_.ElapsedMs += deltaMs;
		const float T = std::min(1.0f, fade_.ElapsedMs / fade_.DurMs);
		switch (fade_.Mode)
		{
		case EOverlayMode::In:    fade_.Alpha = T;                                        break;
		case EOverlayMode::Out:   fade_.Alpha = 1.0f - T;                                 break;
		case EOverlayMode::Flash: fade_.Alpha = (T < 0.5f) ? (T * 2.0f) : (2.0f - T * 2.0f); break;
		default: break;
		}
		if (T >= 1.0f)
		{
			// FADE_* は暗転を維持する。BLACK_IN/WHITE_IN と FLASH は消える。
			const bool bHold = (fade_.Mode == EOverlayMode::In);
			fade_.Alpha = bHold ? 1.0f : 0.0f;
			fade_.DurMs = 0.0f;
			if (!bHold) fade_.Mode = EOverlayMode::None;
			Fire(pending_.Overlay);
		}
	}
}

// ===== 画像オーバーレイ（OVERLAY_SET / OVERLAY_HIDE）=====

void FKaedeOpHandler::overlaySet(const std::string& id, int fadeMs, float x, float y, float s)
{
	if (id.empty()) return;

	// 同じ id が既にあれば積み増さず上書きする（位置や倍率の差し替えに使える）。
	for (auto& It : overlayItems_)
	{
		if (It.id != id) continue;
		It.x = x;
		It.y = y;
		It.scale = (s > 0.0f) ? s : 1.0f;
		StartFade(It, 1.0f, static_cast<float>(fadeMs));
		return;
	}

	FKaedeOverlayItem Item;
	Item.id = id;
	Item.x = x;
	Item.y = y;
	Item.scale = (s > 0.0f) ? s : 1.0f;
	StartFade(Item, 1.0f, static_cast<float>(fadeMs));   // フェードするなら alpha 0 から
	overlayItems_.push_back(std::move(Item));
}

void FKaedeOpHandler::overlayHide(const std::string& id, int fadeMs)
{
	for (auto& It : overlayItems_)
	{
		// id 未指定（空）は「全部消す」。TS 側の運用に合わせる。
		if (!id.empty() && It.id != id) continue;
		StartFade(It, 0.0f, static_cast<float>(fadeMs));
	}
}

// ===== スプライト（SPRITE_SET / MOVE / HIDE / CLEAR）=====
// 実作品での出現が最多（585回）の系統。Tyrano [image] 相当。
// 座標は論理px の絶対指定で、overlayItems_ の「センタリング＋オフセット」とは別物。
// 移植元は monorepo の packages/web/src/renderer/delegates/SpriteController.ts。

void FKaedeOpHandler::spriteSet(const std::string& id, const std::string& storage,
                                const std::string& layer, float x, float y,
                                float opacity, int fadeMs)
{
	if (id.empty()) return;

	const float Target = std::min(1.0f, std::max(0.0f, opacity));
	const float FadeMs = static_cast<float>(fadeMs);

	// 同一 id の再 SET は置き換え（TS の ctx.show と同じライフサイクル）。
	for (auto& It : sprites_)
	{
		if (It.id != id) continue;
		It.storage = storage;
		It.order = SpriteLayerOrder(layer);
		It.x = It.xFrom = It.xTo = x;
		It.y = It.yFrom = It.yTo = y;
		It.Move = {};
		StartFade(It, Target, FadeMs);
		return;
	}

	FKaedeSpriteItem Item;
	Item.id = id;
	Item.storage = storage;
	Item.order = SpriteLayerOrder(layer);
	Item.x = Item.xFrom = Item.xTo = x;
	Item.y = Item.yFrom = Item.yTo = y;
	StartFade(Item, Target, FadeMs);   // フェードするなら alpha 0 から
	sprites_.push_back(std::move(Item));
}

void FKaedeOpHandler::spriteMove(const std::string& id, bool hasX, float x, bool hasY, float y,
                                 bool hasOpacity, float opacity, bool hasScale, float scale,
                                 int durationMs)
{
	for (auto& It : sprites_)
	{
		if (It.id != id) continue;   // 出ていない id は黙って無視（TS と同じ）

		// 省略された引数は現在値を維持する。
		const float ToX = hasX ? x : It.x;
		const float ToY = hasY ? y : It.y;
		const float ToScale = hasScale ? scale : It.scale;

		if (durationMs <= 0)
		{
			It.x = It.xFrom = It.xTo = ToX;
			It.y = It.yFrom = It.yTo = ToY;
			It.scale = It.scaleFrom = It.scaleTo = ToScale;
			It.Move = {};
			if (hasOpacity) StartFade(It, std::min(1.0f, std::max(0.0f, opacity)), 0.0f);
			return;
		}

		// 座標・スケール・不透明度を同一時間で並走補間する（TS の Promise.all 相当）。
		It.xFrom = It.x;  It.xTo = ToX;
		It.yFrom = It.y;  It.yTo = ToY;
		It.scaleFrom = It.scale;  It.scaleTo = ToScale;
		It.Move.Start(static_cast<float>(durationMs));
		if (hasOpacity) StartFade(It, std::min(1.0f, std::max(0.0f, opacity)), static_cast<float>(durationMs));
		return;
	}
}

void FKaedeOpHandler::spriteHide(const std::string& id, int fadeMs)
{
	for (auto& It : sprites_)
	{
		if (It.id != id) continue;
		StartFade(It, 0.0f, static_cast<float>(fadeMs));   // update が消えきったものを捨てる
		return;
	}
}

void FKaedeOpHandler::spriteClear(const std::string& layer, int fadeMs)
{
	// layer 未指定（空）は全レイヤ対象。指定時は order が一致するものだけ。
	const bool bAll = layer.empty();
	const int Order = SpriteLayerOrder(layer);
	for (auto& It : sprites_)
	{
		if (!bAll && It.order != Order) continue;
		StartFade(It, 0.0f, static_cast<float>(fadeMs));
	}
}

void FKaedeOpHandler::textSpriteSet(const std::string& id, const std::string& text,
                                    float x, float y, float size, const std::string& color,
                                    bool bold, const std::string& layer, int fadeMs)
{
	if (id.empty()) return;

	const float FadeMs = static_cast<float>(fadeMs);

	// 画像スプライトと同一キー空間。同一 id の再セットは置き換え（TS の removeSprite→追加）。
	auto Apply = [&](FKaedeSpriteItem& It)
	{
		It.bIsText = true;
		It.storage.clear();          // テキストなので絵は引かない
		It.text = text;
		It.fontSize = (size > 0.0f) ? size : 24.0f;
		It.color = color;
		It.bBold = bold;
		It.order = SpriteLayerOrder(layer);
		It.x = It.xFrom = It.xTo = x;
		It.y = It.yFrom = It.yTo = y;
		It.scale = It.scaleFrom = It.scaleTo = 1.0f;
		It.Move = {};
		StartFade(It, 1.0f, FadeMs);
	};

	for (auto& It : sprites_)
	{
		if (It.id != id) continue;
		Apply(It);
		return;
	}

	FKaedeSpriteItem Item;   // alpha 0 から（フェードしないなら Apply が 1 にする）
	Item.id = id;
	Apply(Item);
	sprites_.push_back(std::move(Item));
}

// ===== 論理レイヤ（LAYER_SET / TRANSITION / WAIT_TRANSITION）=====

std::string FKaedeOpHandler::NormalizeLayerName(const std::string& name)
{
	// TS の SpriteController::resolveLayer と同じ別名を受ける。
	if (name == "background" || name == "bg")                        return "background";
	if (name == "character"  || name == "ch")                        return "character";
	if (name == "overlay"    || name == "front" || name == "sprite") return "overlay";
	return std::string();   // 未知名は対象なし（TS も null を返して no-op）
}

bool FKaedeOpHandler::LayerVisible(const std::string& name) const
{
	auto It = layers_.find(NormalizeLayerName(name));
	return (It != layers_.end()) ? It->second.bVisible : true;
}

float FKaedeOpHandler::LayerOpacity(const std::string& name) const
{
	auto It = layers_.find(NormalizeLayerName(name));
	return (It != layers_.end()) ? It->second.opacity : 1.0f;
}

void FKaedeOpHandler::layerSet(const std::string& name, bool hasVisible, bool visible,
                               bool hasOpacity, float opacity)
{
	const std::string Key = NormalizeLayerName(name);
	if (Key.empty()) return;   // 未知レイヤは黙って無視（Tyrano の message0 等）

	FKaedeLayerState& L = layers_[Key];
	if (hasVisible) L.bVisible = visible;
	if (hasOpacity) L.opacity = std::min(1.0f, std::max(0.0f, opacity));
}

void FKaedeOpHandler::transition(const std::string& target, const std::string&, int durationMs)
{
	const std::string Key = NormalizeLayerName(target.empty() ? "overlay" : target);
	if (Key.empty()) return;

	FKaedeLayerState& L = layers_[Key];
	L.Trans.Start(static_cast<float>(durationMs));
	if (!L.Trans.Active())
	{
		L.opacity = 1.0f;
		return;
	}
	// alpha 0 から 1 へ。非ブロッキングなので、待つのは WAIT_TRANSITION の仕事。
	L.opacity = 0.0f;
	pendingTransitionLayer_ = Key;
}

void FKaedeOpHandler::waitTransition(const std::string& target, Callback onComplete)
{
	// target 指定があればそのレイヤ、無ければ直近に開始したものを待つ。
	const std::string Key = target.empty() ? pendingTransitionLayer_ : NormalizeLayerName(target);
	auto It = (Key.empty() ? layers_.end() : layers_.find(Key));
	if (It == layers_.end() || !It->second.Trans.Active())
	{
		// 待つものが無い＝即完了（シナリオを止めない）。
		if (onComplete) onComplete();
		return;
	}
	pendingTransitionLayer_ = Key;
	pending_.Transition = std::move(onComplete);
}

// ===== マスク（MASK_SET / MASK_CLEAR）=====

void FKaedeOpHandler::maskSet(const std::string& color, float opacity, int durationMs)
{
	mask_.Color = color.empty() ? "#000000" : color;
	mask_.From = mask_.Alpha;
	mask_.TargetAlpha = std::min(1.0f, std::max(0.0f, opacity));
	mask_.Tween.Start(static_cast<float>(durationMs));
	if (!mask_.Tween.Active()) mask_.Alpha = mask_.TargetAlpha;
}

void FKaedeOpHandler::maskClear(int durationMs)
{
	mask_.From = mask_.Alpha;
	mask_.TargetAlpha = 0.0f;
	mask_.Tween.Start(static_cast<float>(durationMs));
	if (!mask_.Tween.Active()) mask_.Alpha = 0.0f;
}

std::vector<FKaedeOpHandler::FKaedeLayerSnapshot> FKaedeOpHandler::LayerSnapshots() const
{
	// 既定（表示・不透明）のままのレイヤは保存しない＝セーブを無駄に太らせない。
	std::vector<FKaedeLayerSnapshot> Out;
	for (const auto& Kv : layers_)
	{
		if (Kv.second.bVisible && Kv.second.opacity >= 1.0f) continue;
		Out.push_back({ Kv.first, Kv.second.bVisible, Kv.second.opacity });
	}
	return Out;
}

void FKaedeOpHandler::RestoreExtras(const std::vector<FKaedeSpriteItem>& InSprites,
                                    const std::string& InMaskColor, float InMaskAlpha,
                                    const std::vector<FKaedeLayerSnapshot>& InLayers)
{
	// スプライトは確定値で入れる（ロード直後にフェードや移動の途中から始めない）。
	sprites_.clear();
	for (const FKaedeSpriteItem& In : InSprites)
	{
		FKaedeSpriteItem It = In;
		It.alpha = It.targetAlpha;
		It.xFrom = It.xTo = It.x;
		It.yFrom = It.yTo = It.y;
		It.scaleFrom = It.scaleTo = It.scale;
		It.Fade = {};
		It.Move = {};
		sprites_.push_back(std::move(It));
	}

	mask_ = {};
	mask_.Color = InMaskColor.empty() ? "#000000" : InMaskColor;
	mask_.Alpha = mask_.From = mask_.TargetAlpha = std::min(1.0f, std::max(0.0f, InMaskAlpha));

	layers_.clear();
	for (const FKaedeLayerSnapshot& L : InLayers)
	{
		if (L.name.empty()) continue;
		FKaedeLayerState& S = layers_[L.name];
		S.bVisible = L.bVisible;
		S.opacity = L.opacity;   // トランジション途中は再現しない（Trans は止まったまま）
	}
}

// ===== 宣言的UI画面（UI_SHOW / UI_HIDE）=====
// ハンドラは描画しない。「開いてほしい画面名」を置いて widget に拾わせ、
// 閉じたら widget から NotifyUiAction が返ってくる、という往復にしている。

void FKaedeOpHandler::uiShow(const std::string& screenId, bool wait, StringCallback onAction)
{
	if (screenId.empty())
	{
		// 画面名が無ければシナリオを止めない（空振り）。
		if (onAction) onAction(std::string());
		return;
	}
	pendingUiScreen_ = screenId;
	if (wait)
	{
		pending_.Ui = std::move(onAction);
	}
	else
	{
		pending_.Ui = nullptr;
		if (onAction) onAction(std::string());   // 待たない＝開いた時点で完了
	}
}

void FKaedeOpHandler::uiHide()
{
	pendingUiScreen_.clear();
	// 待っている最中に UI_HIDE が来たら close 扱いで解放する（デッドロックを作らない）。
	Fire(pending_.Ui, std::string("close"));
}

void FKaedeOpHandler::NotifyUiAction(const std::string& action)
{
	pendingUiScreen_.clear();
	Fire(pending_.Ui, action);
}

// ===== カメラ（CAMERA_SET）=====

void FKaedeOpHandler::cameraSet(bool hasX, float x, bool hasY, float y,
                                bool hasZoom, float zoom, int durationMs, bool reset)
{
	// reset は「初期状態へ戻す」。他の引数より優先する（Tyrano [camera reset] と同じ）。
	FKaedeCameraState& C = camera_;
	const float ToX    = reset ? 0.0f : (hasX ? x : C.X);
	const float ToY    = reset ? 0.0f : (hasY ? y : C.Y);
	const float ToZoom = reset ? 1.0f : (hasZoom ? (zoom > 0.0f ? zoom : 1.0f) : C.Zoom);

	C.FromX = C.X;  C.ToX = ToX;
	C.FromY = C.Y;  C.ToY = ToY;
	C.FromZoom = C.Zoom;  C.ToZoom = ToZoom;
	C.Tween.Start(static_cast<float>(durationMs));
	if (!C.Tween.Active())
	{
		C.X = C.FromX = ToX;
		C.Y = C.FromY = ToY;
		C.Zoom = C.FromZoom = ToZoom;
	}
}

// ===== タイムライン（TIMELINE_PLAY / Tyrano [kanim]）=====
// 評価器は engine/TimelineEvaluator.hpp（TS Tools/kaedevn-compiler/packages/core/src/timeline の移植・状態なし）。
// ここは「再生位置を進めて、結果をスプライトへ流し込む」だけを持つ。

void FKaedeOpHandler::timelinePlay(const std::string& timelineId, Callback onComplete)
{
	// 未登録の id はシナリオを止めない（TS も warn して return するだけ）。
	if (!timelines_.is_object() || !timelines_.contains(timelineId))
	{
		if (onComplete) onComplete();
		return;
	}

	FKaedeActiveTimeline Active;
	Active.root = timelines_[timelineId];
	Active.durationMs = Active.root.value("durationMs", 0.0f);
	Active.elapsedMs = 0.0f;
	Active.onComplete = std::move(onComplete);

	// 長さ 0 は演出にならないので即完了（0除算も避ける）。
	if (Active.durationMs <= 0.0f)
	{
		if (Active.onComplete) Active.onComplete();
		return;
	}

	// 開始フレームの値を即座に反映する（1フレーム分の「元の位置で表示」を出さない）。
	ApplyTimelineResults(kaedevn::EvaluateTimeline(Active.root, 0.0f));
	activeTimelines_.push_back(std::move(Active));
}

void FKaedeOpHandler::ApplyTimelineResults(const std::vector<kaedevn::TimelineTrackResult>& Results)
{
	// targetId は "spr_<スプライトid>"（web が spr_ プレフィクスのキー空間を使うため）。
	static const std::string SpritePrefix = "spr_";

	for (const kaedevn::TimelineTrackResult& R : Results)
	{
		if (R.targetId.size() <= SpritePrefix.size()) continue;
		if (R.targetId.compare(0, SpritePrefix.size(), SpritePrefix) != 0) continue;
		const std::string SpriteId = R.targetId.substr(SpritePrefix.size());

		for (auto& It : sprites_)
		{
			if (It.id != SpriteId) continue;

			// タイムラインが駆動している間は、進行中のトゥイーンより優先する
			// （両方が同じ値を書くと取り合いになるため、こちらで打ち切る）。
			auto Prop = [&R](const char* Name, float& Out) -> bool
			{
				auto F = R.properties.find(Name);
				if (F == R.properties.end()) return false;
				Out = F->second;
				return true;
			};

			float V = 0.0f;
			if (Prop("x", V))       { It.x = It.xFrom = It.xTo = V; It.Move = {}; }
			if (Prop("y", V))       { It.y = It.yFrom = It.yTo = V; It.Move = {}; }
			if (Prop("scale", V))   { It.scale = It.scaleFrom = It.scaleTo = V; }
			if (Prop("opacity", V))
			{
				It.alpha = std::min(1.0f, std::max(0.0f, V));
				It.Fade = {};
				// targetAlpha は触らない。ここで 0 にすると update の掃除で
				// フェードイン開始直後（alpha=0）のスプライトが消える。
			}
			break;
		}
	}
}

// ===== 画面エフェクト（設計 Docs/Reports/2026/07/17/01 Phase A）=====

void FKaedeOpHandler::shake(float intensity, int durationMs, Callback onComplete)
{
	// 強度か時間が無ければ演出にならないので即完了（シナリオを止めない）。
	if (intensity <= 0.0f || durationMs <= 0)
	{
		if (onComplete) onComplete();
		return;
	}
	shake_.DurMs = static_cast<float>(durationMs);
	shake_.RemainMs = shake_.DurMs;
	shake_.ElapsedMs = 0.0f;
	shake_.Intensity = intensity;
	pending_.Shake = std::move(onComplete);
}

void FKaedeOpHandler::ShakeOffset(float& OutX, float& OutY) const
{
	OutX = 0.0f;
	OutY = 0.0f;
	if (shake_.RemainMs <= 0.0f || shake_.DurMs <= 0.0f) return;

	// 残量で線形に減衰させ、x/y で周波数をずらして単純な往復に見せない。
	// 周期は 100ms 前後（sin の係数 0.06〜0.08 rad/ms）。縦は横の 6 割に抑える
	// ＝横揺れ主体の方が「衝撃」に見え、本文が読みづらくなりにくい。
	const float Decay = std::max(0.0f, 1.0f - shake_.ElapsedMs / shake_.DurMs);   // 残り時間の割合
	const float Amp = shake_.Intensity * Decay;
	OutX = Amp * std::sin(shake_.ElapsedMs * 0.061f);
	OutY = Amp * std::sin(shake_.ElapsedMs * 0.083f + 1.7f) * 0.6f;
}

void FKaedeOpHandler::StartOverlay(EOverlayMode Mode, bool bWhite, int durationMs, Callback onComplete)
{
	fade_.Mode = Mode;
	fade_.bWhite = bWhite;
	fade_.ElapsedMs = 0.0f;

	if (durationMs <= 0)
	{
		// 時間指定なし＝即座に最終状態へ。In だけ塗ったまま残す。
		fade_.Alpha = (Mode == EOverlayMode::In) ? 1.0f : 0.0f;
		fade_.DurMs = 0.0f;
		if (Mode != EOverlayMode::In) fade_.Mode = EOverlayMode::None;
		if (onComplete) onComplete();
		return;
	}

	fade_.DurMs = static_cast<float>(durationMs);
	// 開始フレームの見た目を確定させる（Out は 1 から始まる。1フレーム透けるのを防ぐ）。
	fade_.Alpha = (Mode == EOverlayMode::Out) ? 1.0f : 0.0f;
	pending_.Overlay = std::move(onComplete);
}

void FKaedeOpHandler::flash(int durationMs, Callback onComplete)
{
	StartOverlay(EOverlayMode::Flash, /*bWhite*/ true, durationMs, std::move(onComplete));
}

void FKaedeOpHandler::fadeBlack(int durationMs, Callback onComplete)
{
	StartOverlay(EOverlayMode::In, /*bWhite*/ false, durationMs, std::move(onComplete));
}

void FKaedeOpHandler::fadeWhite(int durationMs, Callback onComplete)
{
	StartOverlay(EOverlayMode::In, /*bWhite*/ true, durationMs, std::move(onComplete));
}

void FKaedeOpHandler::blackIn(int durationMs, Callback onComplete)
{
	StartOverlay(EOverlayMode::Out, /*bWhite*/ false, durationMs, std::move(onComplete));
}

void FKaedeOpHandler::whiteIn(int durationMs, Callback onComplete)
{
	StartOverlay(EOverlayMode::Out, /*bWhite*/ true, durationMs, std::move(onComplete));
}

void FKaedeOpHandler::handleClick()
{
	// タイプライター進行中なら、まず全文表示（VN 標準）。このクリックを消費する。
	if (state_.text.has_value() &&
	    state_.text->displayedChars < static_cast<float>(state_.text->content.size()))
	{
		state_.text->displayedChars = static_cast<float>(state_.text->content.size());
		return;
	}
	if (state_.waitingForClick)
	{
		state_.waitingForClick = false;
		Fire(pending_.Click);
		return;
	}
	if (state_.waitingForPage)
	{
		state_.waitingForPage = false;
		state_.text.reset();
		pendingSpeaker_.clear();
		Fire(pending_.Page);
		return;
	}
}

void FKaedeOpHandler::onUnhandledOp(int pc, const std::string& opName)
{
	UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] 処理しない Op を読み飛ばした: pc=%d op=%s"), pc, UTF8_TO_TCHAR(opName.c_str()));
}

void FKaedeOpHandler::selectChoice(int index)
{
	if (!state_.waitingForChoice) return;
	state_.waitingForChoice = false;
	state_.choices.reset();
	Fire(pending_.Choice, index);
}

void FKaedeOpHandler::PrepareForLoad()
{
	// 演出は保存の外で、ロード直後に暗転が残ったり揺れの途中から始まったりしないよう白紙へ戻す。
	// 残すのは作品データ（timelines_）と設定（textSpeed_）だけ。状態を足すときは下の構造体へ入れる。
	state_.reset();
	textBuffer_.clear(); pendingSpeaker_.clear(); history_.clear(); charFadeDurMs_.clear();
	filterName_.clear(); filterIntensity_ = 0.0f;
	pending_ = {}; camera_ = {}; mask_ = {}; shake_ = {}; fade_ = {};
	overlayItems_.clear(); sprites_.clear(); layers_.clear(); activeTimelines_.clear();
	pendingTransitionLayer_.clear(); pendingUiScreen_.clear();
}

void FKaedeOpHandler::waitCamera(Callback Done)
{
	if (camera_.Tween.RemainMs <= 0.f) { if (Done) Done(); }
	else pending_.Camera = std::move(Done);
}

void FKaedeOpHandler::CancelPendingCommands()
{
	pending_ = {};
	pendingUiScreen_.clear();
	for (auto& T : activeTimelines_) T.onComplete = nullptr;
	state_.waitingForClick = state_.waitingForPage = state_.waitingForChoice = state_.waitingForTimer = false;
	state_.choices.reset();
}

float FKaedeOpHandler::VisualWaitRemaining() const
{
	if (pending_.Camera) return camera_.Tween.RemainMs;
	if (pending_.Shake) return shake_.RemainMs;
	if (pending_.Overlay) return std::max(0.f, fade_.DurMs - fade_.ElapsedMs);
	if (pending_.Transition) {
		auto It = layers_.find(pendingTransitionLayer_);
		if (It != layers_.end()) return It->second.Trans.RemainMs;
	}
	return 0.f;
}

void FKaedeOpHandler::RestoreScene(const kaedevn::GameScreenState& Snapshot,
                                   const std::string& Filter, float FilterIntensity,
                                   const std::vector<FKaedeHistoryLine>& InHistory)
{
	// 見た目だけを上書き（待機フラグ・選択肢・コールバックは再装填済みのものを保持）。
	state_.bgId = Snapshot.bgId;
	state_.bgTransition.reset();              // ロード直後はクロスフェード途中を再現しない
	state_.characters = Snapshot.characters;  // 復元時は全員 alpha=1（フェードインしない）
	state_.text = Snapshot.text;              // 本文は全文表示済みで復元
	state_.textBgColor = Snapshot.textBgColor;
	state_.nameColor = Snapshot.nameColor;
	state_.bgmId = Snapshot.bgmId;
	state_.bgmVol = Snapshot.bgmVol;
	filterName_ = Filter;
	filterIntensity_ = FilterIntensity;
	history_ = InHistory;
	charFadeDurMs_.clear();
}
