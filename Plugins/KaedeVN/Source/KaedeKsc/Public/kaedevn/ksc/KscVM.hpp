// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KSC stack VM — C++ port of Tools/kaedevn-compiler/packages/ksc-compiler/src/vm.ts.
//
// Exception-free contract: `run()` and `step()` never throw. Errors are
// recorded in `status() == Errored` and `error()`. The VM is designed to
// build with -fno-exceptions -fno-rtti for Switch targets.

#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "HostAPI.hpp"
#include "IR.hpp"
#include "Value.hpp"

namespace kaedevn::ksc {

enum class VMStatus {
    Ready,      // Initialized but not yet stepped
    Running,    // Mid-execution (used internally during step)
    Done,       // Top-level function returned
    Errored,    // Runtime error — see error()
    Awaiting,   // Host call yielded a WAIT_* — caller must resume()
};

struct VMError {
    std::string              message;
    int                      sourceLine = 0;
    std::vector<std::string> callTrace;
};

struct CallFrame {
    int                                       funcIndex = 0;
    int                                       pc        = 0;
    std::unordered_map<std::string, Value>    locals;
};

class KscVM {
public:
    /// @param module   Borrowed, must outlive the VM.
    /// @param host     Optional (nullptr until Day 5 HOST_CALL support).
    /// @param maxInstr Budget for a single `run()` invocation.
    explicit KscVM(const IRModule& module,
                   HostAPI*        host    = nullptr,
                   std::uint64_t   maxInstr = 1'000'000);

    /// Execute one instruction. No-op if status is not Ready/Running.
    void step();

    /// Drive `step()` until status transitions out of Running/Ready.
    /// Returns the final status (Done / Errored / Awaiting).
    VMStatus run();

    /// Resume from Awaiting by pushing the host-produced value onto the
    /// stack. No-op if status is not Awaiting.
    void resume(Value awaitedValue);

    /// Value popped by AWAIT or passed to a WAIT_* host return. Valid only
    /// while status is Awaiting; returns null otherwise.
    const Value& awaitedValue() const noexcept { return awaitedValue_; }

    /// If the VM went Awaiting from a WAIT_* host call, this is the
    /// specific WAIT type the host asked for.
    VMResultType awaitKind() const noexcept { return awaitKind_; }

    // ---- Inspection ----

    VMStatus         status() const noexcept { return status_; }
    const VMError&   error() const noexcept { return error_; }

    /// Top-of-stack snapshot at the moment status became Done.
    /// Before Done, returns the live stack top (or null if empty).
    const Value&     result() const noexcept { return result_; }

    const std::vector<Value>&      stack() const noexcept { return stack_; }
    const std::vector<CallFrame>&  callStack() const noexcept { return callStack_; }

    // ---- Setup (pre-`run`) ----

    /// Seed a global variable. Must be called before run().
    void setGlobal(const std::string& name, Value v);

    // ---- Limits ----

    std::uint64_t instructionCount() const noexcept { return instructionCount_; }

    /// Current source line, updated by DEBUG_LINE opcodes. Mirrors TS
    /// VM's `currentLine` field for trace/save parity.
    int currentLine() const noexcept { return currentLine_; }

    // ---- Save / Load ----

    /// Serialize the current VM state to a JSON string compatible with the
    /// TS `VMState` shape (stack / callStack / globals / currentLine / done).
    /// Reference identity between objects/arrays is NOT preserved across a
    /// round-trip — any sharing becomes separate copies (matches TS parity
    /// since the TS VM uses structural JSON too).
    std::string serializeState() const;

    /// Restore from a JSON string produced by serializeState. On failure,
    /// returns false and the VM is left in its previous state.
    bool deserializeState(const std::string& json);

private:
    const IRModule& module_;
    [[maybe_unused]] HostAPI* host_;  // used from Day 5 (HOST_CALL)
    std::uint64_t   maxInstructions_;
    std::uint64_t   instructionCount_ = 0;

    VMStatus status_ = VMStatus::Ready;
    VMError  error_;
    Value    result_;

    // Await state
    Value        awaitedValue_;
    VMResultType awaitKind_ = VMResultType::CONTINUE;

    std::vector<Value>      stack_;
    std::vector<CallFrame>  callStack_;

    std::unordered_map<std::string, Value> globals_;
    std::unordered_map<std::string, int>   functionMap_;

    int currentLine_ = 0;

    // -------- Dispatch & helpers --------

    void exec(const Instruction& i);

    /// Pop the top value into `out`. On underflow, sets Errored and returns false.
    [[nodiscard]] bool pop(Value& out);

    /// Pop and coerce to number. On underflow or non-number, sets Errored.
    [[nodiscard]] bool popNumber(double& out);

    /// Push with no error path (stack is unbounded in practice).
    void push(Value v) { stack_.push_back(std::move(v)); }

    /// Resolve a variable per TS `loadVar`: locals → globals → function index → null.
    Value loadVar(const CallFrame& frame, const std::string& name) const;

    /// Look up a constant-pool entry as a string (used by LOAD_VAR / STORE_VAR).
    /// Sets Errored if out of range or not a string.
    [[nodiscard]] bool constString(std::int32_t index, std::string& out);

    /// Record an error and halt.
    void setError(std::string msg);

    std::vector<std::string> buildCallTrace() const;

    // -------- Opcode implementations (Day 2 scope) --------

    void opLoadConst(const Instruction& i);
    void opLoadVar(const Instruction& i);
    void opStoreVar(const Instruction& i);
    void opPop();
    void opDup();

    void opAdd();
    void opSub();
    void opMul();
    void opDiv();
    void opMod();
    void opNeg();

    void opCmpEq();
    void opCmpNeq();
    void opCmpLt();
    void opCmpLteq();
    void opCmpGt();
    void opCmpGteq();

    void opNot();
    void opAnd();
    void opOr();

    // -------- Opcode implementations (Day 3 scope — control flow) --------

    void opJmp(const Instruction& i);
    void opJmpIfFalse(const Instruction& i);
    void opCall(const Instruction& i);
    /// Shared by CALL and CALL_METHOD (the latter adds `this`).
    static CallFrame MakeFrame(int funcIdx, const IRFunction& target, const std::vector<Value>& args);
    void opRet();
    void opSwitch(const Instruction& i);

    // -------- Opcode implementations (Day 4 scope — objects & arrays) --------

    void opMakeArray(const Instruction& i);
    void opMakeObject(const Instruction& i);
    void opGetField(const Instruction& i);
    void opSetField(const Instruction& i);
    void opGetIndex();
    void opSetIndex();

    // -------- Opcode implementations (Day 5 scope — methods & async) --------

    void opCallMethod(const Instruction& i);
    void opHostCall(const Instruction& i);
    void opAwait();

    // Built-in array methods. Returns Value on success; sets Errored and
    // returns null on unknown method.
    Value callArrayMethod(ArrayPtr arr,
                           const std::string& method,
                           const std::vector<Value>& args);

    // stdlib pure-math intrinsics. If `name` is a stdlib function, computes the
    // result in-VM (host non-経由), writes it to `out` and returns true. Must
    // stay byte-for-byte identical to vm.ts callStdlib(). See KscVM.cpp.
    bool tryStdlib(const std::string& name,
                   const std::vector<Value>& args,
                   Value& out) const;

    // Walk proto chain and return field value, or null if not found.
    Value getFieldOnObject(const ObjectPtr& obj, const std::string& name) const;

    void opDebugLine(const Instruction& i);
};

} // namespace kaedevn::ksc
