// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// OpRunner.cpp — シナリオ（Op 列）を順に実行する再生エンジン。
//
// tick() をホストが毎フレーム呼ぶ。同期 Op は連続実行し、非同期 Op（WAIT_CLICK /
// 選択肢 / 画面エフェクト等）で止まって、handler の onComplete が来るまで pc を進めない。
//
// Op の振り分けは 2 つに分けてある。
//   ここ（executeNext の switch） … pc を動かす Op（TEXT_APPEND・変数・選択肢・ジャンプ・CALL/RETURN・
//                                   jump を解決する UI_SHOW）だけ
//   DispatchDisplayOp.hpp         … 表示・音声・演出・待機の Op。KSC の再生（FKaedeKscHost）と共有する
// 新しい表示系の Op は DispatchDisplayOp だけに足す。どちらにも無い Op は handler の onUnhandledOp に知らせて読み飛ばす。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "OpRunner.hpp"
#include "ui/Interp.hpp"   // evalCondExpr（JUMP_IF の条件式。UI の showIf と同じ文法）
#include "DispatchDisplayOp.hpp"
#include <cassert>

namespace kaedevn {

namespace {
// 変数・Op 引数の数としての値。bool→0/1・number→値・それ以外（鍵なし・文字列・null 等）→0。
// tick() は try 無しで毎フレーム呼ばれるので、台本 1 行の書き損じで get<> の例外を投げない。
double NumberOf(const nlohmann::json& v) {
    if (v.is_boolean()) return v.get<bool>() ? 1.0 : 0.0;
    if (v.is_number())  return v.get<double>();
    return 0.0;
}

// d の鍵 key の値。無ければ null（const json の operator[] は鍵が無いと未定義動作）。
const nlohmann::json& FieldOf(const nlohmann::json& d, const char* key) {
    static const nlohmann::json kNull;
    if (!d.is_object()) return kNull;
    const auto it = d.find(key);
    return it != d.end() ? *it : kNull;
}
} // namespace

void OpRunner::start(const CompiledScenario& scenario, IOpHandler* handler) {
    assert(handler && "OpRunner は handler 無しでは動かない");
    program_ = std::make_shared<const CompiledScenario>(scenario);
    handler_ = handler;
    pc_ = 0;
    vars_ = nlohmann::json::object();
    read_ = nlohmann::json::object();
    callStack_.clear();
    state_ = program_->ops.empty() ? RunnerState::Finished : RunnerState::Executing;
}

void OpRunner::resume(const CompiledScenario& scenario, IOpHandler* handler,
                      int pc, const nlohmann::json& vars, const nlohmann::json& read) {
    assert(handler && "OpRunner は handler 無しでは動かない");
    program_ = std::make_shared<const CompiledScenario>(scenario);
    handler_ = handler;
    pc_ = pc;
    vars_ = vars;
    read_ = read;
    callStack_.clear();
    state_ = (pc_ >= (int)program_->ops.size()) ? RunnerState::Finished : RunnerState::Executing;
}

void OpRunner::startShared(std::shared_ptr<const CompiledScenario> program, IOpHandler* handler, int pc,
                           const std::vector<int>& callStack) {
    assert(handler && "OpRunner は handler 無しでは動かない");
    program_ = program ? std::move(program) : std::make_shared<const CompiledScenario>();
    handler_ = handler;
    pc_ = pc;
    vars_ = nlohmann::json::object();
    read_ = nlohmann::json::object();
    callStack_ = callStack;
    state_ = (pc_ < 0 || pc_ >= (int)program_->ops.size()) ? RunnerState::Finished : RunnerState::Executing;
}

void OpRunner::stop() {
    state_ = RunnerState::Finished;
}

void OpRunner::tick() {
    if (state_ != RunnerState::Executing) return;

    // 同期 Op は連続実行。非同期 Op で WaitingCallback になると止まる。
    while (state_ == RunnerState::Executing && pc_ < (int)program_->ops.size()) {
        executeNext();
        if (yield_) {
            yield_ = false;
            return;
        }
    }

    if (state_ == RunnerState::Executing && pc_ >= (int)program_->ops.size()) {
        state_ = RunnerState::Finished;
    }
}

void OpRunner::advanceAndResume() {
    std::string pcStr = std::to_string(pc_);
    read_[pcStr] = true;
    pc_++;
    state_ = (pc_ >= (int)program_->ops.size()) ? RunnerState::Finished : RunnerState::Executing;
}

void OpRunner::executeNext() {
    if (pc_ < 0 || pc_ >= (int)program_->ops.size()) {
        state_ = RunnerState::Finished;
        return;
    }

    // Op 列は共有で持つので、実行中に差し替えられても消えないよう手元に握る
    const std::shared_ptr<const CompiledScenario> program = program_;
    const auto& op = program->ops[pc_];
    const auto& d = op.data;

    handler_->onOpEnter(pc_, d.value("op", std::string("?")));

    // 拡張の口を先に聞く（IOpExtension の説明は OpRunner.hpp）
    if (ext_) {
        IOpExtension::Context ctx{*this, pc_,
            [this](int target) { pc_ = target; },
            [this]() { advanceAndResume(); },
            [this](int target) {
                pc_ = target;
                state_ = (pc_ < 0 || pc_ >= (int)program_->ops.size()) ? RunnerState::Finished : RunnerState::Executing;
            }};
        // Wait のとき、拡張が tryExecute の中で resume を呼ぶこともある（すぐ終わる待ち）。先に待ちにしておく
        state_ = RunnerState::WaitingCallback;
        const IOpExtension::Result r = ext_->tryExecute(op, ctx);
        if (r == IOpExtension::Result::Wait) return;
        if (r == IOpExtension::Result::Yield) {
            state_ = RunnerState::Executing;
            yield_ = true;
            return;
        }
        if (r == IOpExtension::Result::NotHandled) {
            state_ = RunnerState::Executing;
        } else {
            if (r == IOpExtension::Result::Sync) pc_++;
            state_ = (pc_ < 0 || pc_ >= (int)program_->ops.size()) ? RunnerState::Finished : RunnerState::Executing;
            return;
        }
    }

    switch (op.type) {
        // ===== テキスト（同期） =====
        case OpType::TEXT_APPEND:
            handler_->textAppend(d.value("who", ""), d.value("text", ""));
            pc_++;
            break;

        // ===== 宣言的UI画面 =====
        // wait=true のときだけ待つ。終了アクションが "jump:<label>" なら pc をそこへ飛ばす
        // （ラベル解決は runner の責務。DispatchDisplayOp 経由では解決できない）。
        case OpType::UI_SHOW:
        {
            const bool bWait = d.value("wait", false);
            if (!bWait)
            {
                handler_->uiShow(d.value("screenId", ""), false, nullptr);
                pc_++;
                break;
            }
            state_ = RunnerState::WaitingCallback;
            handler_->uiShow(d.value("screenId", ""), true, [this](const std::string& action) {
                static const std::string JumpPrefix = "jump:";
                if (action.size() > JumpPrefix.size()
                    && action.compare(0, JumpPrefix.size(), JumpPrefix) == 0)
                {
                    const std::string Label = action.substr(JumpPrefix.size());
                    auto It = program_->labels.find(Label);
                    if (It != program_->labels.end())
                    {
                        pc_ = It->second;      // ラベルへ飛ぶ（advance せずその位置から再開）
                        state_ = RunnerState::Executing;
                        tick();
                        return;
                    }
                    // 未定義ラベルはシナリオを止めない。次の op へ進む。
                }
                advanceAndResume();
            });
            return;
        }

        // ===== 変数（同期） =====
        case OpType::VAR_SET: {
            std::string name = d.value("name", "");
            if (!name.empty()) vars_[name] = FieldOf(d, "value");
            pc_++;
            break;
        }

        case OpType::VAR_ADD: {
            std::string name = d.value("name", "");
            const double addVal = NumberOf(FieldOf(d, "value"));
            if (!name.empty()) {
                const double cur = vars_.contains(name) ? NumberOf(vars_[name]) : 0.0;
                vars_[name] = cur + addVal;
            }
            pc_++;
            break;
        }

        case OpType::VAR_SUB: {
            std::string name = d.value("name", "");
            const double subVal = NumberOf(FieldOf(d, "value"));
            if (!name.empty()) {
                const double cur = vars_.contains(name) ? NumberOf(vars_[name]) : 0.0;
                vars_[name] = cur - subVal;
            }
            pc_++;
            break;
        }

        // ===== 選択肢（非同期） =====
        case OpType::CHOICE: {
            std::vector<std::string> labels;
            std::vector<int> jumps;
            if (d.contains("options") && d["options"].is_array()) {
                for (const auto& opt : d["options"]) {
                    labels.push_back(opt.value("label", ""));
                    jumps.push_back(opt.value("jump", 0));
                }
            }
            state_ = RunnerState::WaitingCallback;
            handler_->showChoices(labels, [this, jumps](int selected) {
                if (selected >= 0 && selected < (int)jumps.size()) {
                    pc_ = jumps[selected];
                } else {
                    pc_++;
                }
                state_ = (pc_ >= (int)program_->ops.size())
                    ? RunnerState::Finished : RunnerState::Executing;
            });
            return;
        }

        // ===== ジャンプ・分岐（同期） =====
        case OpType::JUMP:
            pc_ = d.value("pc", 0);
            break;

        case OpType::JUMP_IF: {
            const std::string cond = d.value("condition", "");
            const int target = d.value("pc", 0);
            // condition は evalCondExpr 文法（ui/Interp.hpp）:
            //   "varName"            … 変数が truthy なら jump（旧仕様。後方互換）
            //   "name OP 数値"        … == != >= <= > < の比較
            //   "A && B" / "A || B" / "!A" / "(...)"  … 論理合成
            // 評価器は UI の showIf/hideIf と共有する（条件文法をエンジン内で一本化）。
            // 意図的な上限: ループも関数も無いので、分岐は静的に全ルート列挙できる。
            ui::VarEnv env;
            env.resolveNum = [this](const std::string& key, double& out) -> bool {
                // 外から足した引き方（RPG の世界の状態など）を先に見る
                if (resolver_ && resolver_(key, out)) return true;
                const auto it = vars_.find(key);
                if (it == vars_.end()) return false;
                const auto& val = *it;
                if (val.is_boolean() || val.is_number()) out = NumberOf(val);
                // 文字列は「非空なら真」。旧 truthy 判定と同じ意味を保つ。
                else if (val.is_string()) out = val.get<std::string>().empty() ? 0.0 : 1.0;
                else return false;
                return true;
            };
            if (ui::evalCondExpr(cond, env)) {
                pc_ = target;
            } else {
                pc_++;
            }
            break;
        }

        // ===== サブルーチン (Web OpRunner と同等) =====
        case OpType::CALL:
            // 返り先 (現 pc + 1) を stack に push し、call 先の pc にジャンプ。
            callStack_.push_back(pc_ + 1);
            pc_ = d.value("pc", 0);
            if (pc_ < 0 || pc_ > (int)program_->ops.size()) {
                pc_ = (int)program_->ops.size();
                state_ = RunnerState::Finished;
            }
            break;

        case OpType::RETURN:
            // Web の RETURN と同シェイプ: callStack 空 → script を終了。
            // 空でなければ pop して復帰。
            if (callStack_.empty()) {
                pc_ = (int)program_->ops.size();
                state_ = RunnerState::Finished;
            } else {
                int returnPc = callStack_.back();
                callStack_.pop_back();
                if (returnPc < 0 || returnPc > (int)program_->ops.size()) {
                    pc_ = (int)program_->ops.size();
                    state_ = RunnerState::Finished;
                } else {
                    pc_ = returnPc;
                }
            }
            break;

        // ===== 表示・音声・演出・待機は DispatchDisplayOp に委ねる =====
        // 同期の Op はその場で、非同期の Op は終わったときに完了が呼ばれ、pc を 1 進めて再開する。
        // どちらでもないもの（未対応の Op）は handler に知らせて読み飛ばす。
        default:
            state_ = RunnerState::WaitingCallback;
            if (!DispatchDisplayOp(op, *handler_, [this]() { advanceAndResume(); })) {
                handler_->onUnhandledOp(pc_, d.value("op", std::string("?")));
                pc_++;
                state_ = RunnerState::Executing;
            }
            return;
    }
}

} // namespace kaedevn
