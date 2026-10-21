// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once
#include "Op.hpp"
#include "IOpHandler.hpp"
#include <nlohmann/json.hpp>
#include <functional>
#include <memory>
#include <vector>

// UE ビルドでは UBT が KAEDEVNCORE_API(=DLLEXPORT/DLLIMPORT) を定義する（別DLL＝KaedeRpg から実行器を持つための export。
// 定石は ui/Easing.hpp と同じ）。KaedeVnCore の純C++ TU は UE ヘッダを include しないので DLLEXPORT をここで補う。
// UE の外（Tools/rpg-cli など）では空定義で素通し。
#ifndef KAEDEVNCORE_API
#define KAEDEVNCORE_API
#endif
#if !defined(DLLEXPORT) && defined(_MSC_VER)
#define DLLEXPORT __declspec(dllexport)
#define DLLIMPORT __declspec(dllimport)
#endif

namespace kaedevn {

enum class RunnerState {
    Idle,
    Executing,
    WaitingCallback,
    Finished
};

class OpRunner;

/**
 * IOpExtension — OpRunner に足す命令の口（RPG 制作ツールの命令・世界の状態の変数など）。
 * 表示の窓口 IOpHandler に世界の状態を持ち込まないために分けてある（RPG の詳細設計 §10）。
 *
 * 各 Op を組み込みの処理より**先に**聞く。NotHandled を返せば組み込みの処理（下の switch）に進む。
 *   Sync      … 済んだ。pc を 1 進めて続ける
 *   Jumped    … pc は ctx.jump() で動かした。そのまま続ける
 *   Wait      … 待つ。終わったら ctx.resume() を呼ぶ（呼ぶまで pc を進めない）
 *   Yield     … この Op をまだ実行しない。今回の tick() をここで終え、次の tick() でもう一度聞く
 *               （1 フレームに進める Op の数の上限・終わらないループで固まらないため）
 */
class IOpExtension {
public:
    enum class Result { NotHandled, Sync, Jumped, Wait, Yield };

    struct Context {
        OpRunner& runner;
        int pc;
        std::function<void(int)> jump;     // pc を動かす（Jumped と一緒に使う）
        std::function<void()> resume;      // Wait の終わり（pc を 1 進めて再開）
        std::function<void(int)> resumeAt; // Wait の終わり（pc をそこへ動かして再開。選択肢・戦闘の結果）
    };

    virtual ~IOpExtension() = default;
    virtual Result tryExecute(const Op& op, Context& ctx) = 0;
};

/**
 * OpRunner — Op JSON を順次実行する。
 * monorepo の packages/core/src/engine/OpRunner.ts の C++ 版。
 *
 * tick() をメインループから毎フレーム呼ぶ。
 * 非同期 Op（WAIT_CLICK, CHOICE 等）ではコールバック待ちになり、
 * コールバックが呼ばれるまで PC を進めない。
 */
// C4251: 標準ライブラリの型（shared_ptr・vector・function・json）をメンバに持つクラスを DLL から公開すると出る警告。
// 使う側も同じ MSVC・同じ標準ライブラリで組むので害は無い。OpRunner.hpp を読む全部の TU に出るので、ここだけで抑える
#if defined(_MSC_VER)
#pragma warning(push)
#pragma warning(disable : 4251)
#endif
class KAEDEVNCORE_API OpRunner {
public:
    void start(const CompiledScenario& scenario, IOpHandler* handler);
    void resume(const CompiledScenario& scenario, IOpHandler* handler,
                int pc, const nlohmann::json& vars, const nlohmann::json& read);
    void stop();

    // プログラムを共有して持つ形（実行器を何本も持つときに Op 列を複製しない）。
    // pc から始める。callStack は CALL の返り先（セーブから戻すとき・空なら新しく始める）
    void startShared(std::shared_ptr<const CompiledScenario> program, IOpHandler* handler, int pc,
                     const std::vector<int>& callStack = {});
    const std::vector<int>& callStack() const { return callStack_; }
    const CompiledScenario& program() const { return *program_; }

    // 拡張の口（IOpExtension）。nullptr で外す
    void setExtension(IOpExtension* ext) { ext_ = ext; }
    // JUMP_IF の条件式の名前の引き方を外から足す（先にこれを見て、無ければ vars を見る）
    using VarResolver = std::function<bool(const std::string&, double&)>;
    void setVarResolver(VarResolver resolver) { resolver_ = std::move(resolver); }

    /**
     * メインループから毎フレーム呼ぶ。
     * Executing 状態なら同期 Op を連続実行し、非同期 Op で停止。
     */
    void tick();

    RunnerState state() const { return state_; }
    int pc() const { return pc_; }
    const nlohmann::json& vars() const { return vars_; }
    const nlohmann::json& readFlags() const { return read_; }
    bool isFinished() const { return state_ == RunnerState::Finished; }

private:
    void executeNext();
    void advanceAndResume();

    // Op 列（共有して持つ。start / resume は 1 回だけ複製して持つ）
    std::shared_ptr<const CompiledScenario> program_ = std::make_shared<const CompiledScenario>();
    IOpHandler* handler_ = nullptr;
    IOpExtension* ext_ = nullptr;
    VarResolver resolver_;
    RunnerState state_ = RunnerState::Idle;
    int pc_ = 0;
    nlohmann::json vars_;
    nlohmann::json read_;
    // CALL の返り先 PC スタック。RETURN で pop。空のとき RETURN は script を終了させる。
    // Web 側（monorepo）packages/core/src/engine/OpRunner.ts の callStack と同等。
    std::vector<int> callStack_;
    bool yield_ = false;   // 拡張が Yield を返した（今回の tick() を終える）
};
#if defined(_MSC_VER)
#pragma warning(pop)
#endif

} // namespace kaedevn
