// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KSC IR (Intermediate Representation) — C++ port of
// Tools/kaedevn-compiler/packages/ksc-compiler/src/types/ir.ts
//
// The on-wire JSON format of an IRModule is the contract between the
// TypeScript compiler and this C++ VM. Do not change field names or opcode
// string values without also updating ir.ts and re-running parity tests.

#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "Value.hpp"

namespace kaedevn::ksc {

/// Opcode. Stringly-serialized in IR.json (see IRLoader). Keep this enum
/// in the same order as `OpCode` in ir.ts for debuggability.
enum class OpCode : std::uint8_t {
    // Stack
    LOAD_CONST,
    LOAD_VAR,
    STORE_VAR,
    POP,
    DUP,

    // Arithmetic
    ADD,
    SUB,
    MUL,
    DIV,
    MOD,
    NEG,

    // Comparison
    CMP_EQ,
    CMP_NEQ,
    CMP_LT,
    CMP_LTEQ,
    CMP_GT,
    CMP_GTEQ,

    // Logical
    AND,
    OR,
    NOT,

    // Control flow
    JMP,
    JMP_IF_FALSE,
    CALL,
    CALL_METHOD,
    RET,
    SWITCH,

    // Object / Array
    MAKE_ARRAY,
    MAKE_OBJECT,
    GET_FIELD,
    SET_FIELD,
    GET_INDEX,
    SET_INDEX,

    // Host API
    HOST_CALL,

    // Async
    AWAIT,

    // Debug
    DEBUG_LINE,
};

const char* opcode_to_string(OpCode op) noexcept;
bool opcode_from_string(const std::string& s, OpCode& out) noexcept;

struct Instruction {
    OpCode      op;
    std::int32_t operand  = 0;
    std::int32_t operand2 = 0;
};

struct IRFunction {
    std::string              name;
    int                      paramCount = 0;
    std::vector<std::string> paramNames;
    int                      localCount = 0;
    std::vector<Instruction> instructions;
    std::string              sourceFile;
};

struct SwitchCase {
    Value value;
    int   target = 0;
};

struct SwitchCaseTable {
    std::vector<SwitchCase> cases;
    int                     defaultTarget = 0;
};

struct IRModule {
    /// Constant pool. Numbers, strings, booleans, null — no objects/arrays
    /// ever appear as compile-time constants in KSC.
    std::vector<Value> constants;

    std::vector<IRFunction>      functions;
    int                          entryPoint = 0;
    std::vector<SwitchCaseTable> switchTables;

    /// Maps IR-instruction-offset → source line (serializable). Matches ir.ts.
    std::vector<std::pair<int, int>> sourceMap;
};

/// VM execution status returned by Host API calls.
/// Keep order and names in sync with ir.ts VMResultType.
enum class VMResultType {
    CONTINUE,
    WAIT_TIME,
    WAIT_INPUT,
    WAIT_EVENT,
    WAIT_BATTLE,
};

struct VMResult {
    VMResultType type = VMResultType::CONTINUE;
    Value        value;
};

} // namespace kaedevn::ksc
