// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "kaedevn/ksc/KscVM.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <string>
#include <utility>

#include <nlohmann/json.hpp>

namespace kaedevn::ksc {

// =============================================================================
// Construction
// =============================================================================

KscVM::KscVM(const IRModule& module, HostAPI* host, std::uint64_t maxInstr)
    : module_(module), host_(host), maxInstructions_(maxInstr) {

    // Build function name → index map (matches TS constructor).
    for (std::size_t i = 0; i < module_.functions.size(); ++i) {
        functionMap_[module_.functions[i].name] = static_cast<int>(i);
    }

    // Push initial call frame for entry point.
    if (module_.entryPoint >= 0 &&
        module_.entryPoint < static_cast<int>(module_.functions.size())) {
        CallFrame frame;
        frame.funcIndex = module_.entryPoint;
        frame.pc        = 0;
        callStack_.push_back(std::move(frame));
    } else {
        setError("entryPoint out of range");
    }

    result_ = make_null();
}

// =============================================================================
// Public API
// =============================================================================

void KscVM::setGlobal(const std::string& name, Value v) {
    globals_[name] = std::move(v);
}

VMStatus KscVM::run() {
    if (status_ == VMStatus::Errored ||
        status_ == VMStatus::Done) {
        return status_;
    }

    if (status_ == VMStatus::Awaiting) {
        // Caller must use resume() instead.
        return status_;
    }

    status_ = VMStatus::Running;
    while (status_ == VMStatus::Running) {
        step();
    }
    return status_;
}

void KscVM::resume(Value awaitedValue) {
    if (status_ != VMStatus::Awaiting) return;
    push(std::move(awaitedValue));
    awaitedValue_ = make_null();
    awaitKind_    = VMResultType::CONTINUE;
    status_       = VMStatus::Running;
}

// =============================================================================
// Step
// =============================================================================

void KscVM::step() {
    if (status_ == VMStatus::Errored ||
        status_ == VMStatus::Done ||
        status_ == VMStatus::Awaiting) {
        return;
    }

    if (status_ == VMStatus::Ready) {
        status_ = VMStatus::Running;
    }

    if (instructionCount_ >= maxInstructions_) {
        setError("Instruction budget exceeded (" +
                 std::to_string(maxInstructions_) + ")");
        return;
    }

    if (callStack_.empty()) {
        // Top-level returned.
        status_ = VMStatus::Done;
        if (!stack_.empty()) result_ = stack_.back();
        return;
    }

    CallFrame& frame = callStack_.back();
    const IRFunction& func = module_.functions[frame.funcIndex];

    if (frame.pc >= static_cast<int>(func.instructions.size())) {
        // Ran off the end of the function — implicit `return null`.
        // Order matters: capture result_ from the pre-null top of stack
        // (= whatever the function body computed), then push null to match
        // TS parity for the stack state.
        callStack_.pop_back();
        if (callStack_.empty()) {
            status_ = VMStatus::Done;
            if (!stack_.empty()) result_ = stack_.back();
        }
        push(make_null());
        return;
    }

    const Instruction inst = func.instructions[frame.pc];
    frame.pc++;
    instructionCount_++;

    exec(inst);
}

// =============================================================================
// Opcode dispatch
// =============================================================================

void KscVM::exec(const Instruction& i) {
    switch (i.op) {
        case OpCode::LOAD_CONST:    opLoadConst(i);  return;
        case OpCode::LOAD_VAR:      opLoadVar(i);    return;
        case OpCode::STORE_VAR:     opStoreVar(i);   return;
        case OpCode::POP:           opPop();         return;
        case OpCode::DUP:           opDup();         return;

        case OpCode::ADD:           opAdd();         return;
        case OpCode::SUB:           opSub();         return;
        case OpCode::MUL:           opMul();         return;
        case OpCode::DIV:           opDiv();         return;
        case OpCode::MOD:           opMod();         return;
        case OpCode::NEG:           opNeg();         return;

        case OpCode::CMP_EQ:        opCmpEq();       return;
        case OpCode::CMP_NEQ:       opCmpNeq();      return;
        case OpCode::CMP_LT:        opCmpLt();       return;
        case OpCode::CMP_LTEQ:      opCmpLteq();     return;
        case OpCode::CMP_GT:        opCmpGt();       return;
        case OpCode::CMP_GTEQ:      opCmpGteq();     return;

        case OpCode::AND:           opAnd();         return;
        case OpCode::OR:            opOr();          return;
        case OpCode::NOT:           opNot();         return;

        case OpCode::DEBUG_LINE:    opDebugLine(i);  return;

        case OpCode::JMP:           opJmp(i);        return;
        case OpCode::JMP_IF_FALSE:  opJmpIfFalse(i); return;
        case OpCode::CALL:          opCall(i);       return;
        case OpCode::RET:           opRet();         return;
        case OpCode::SWITCH:        opSwitch(i);     return;

        case OpCode::MAKE_ARRAY:    opMakeArray(i);  return;
        case OpCode::MAKE_OBJECT:   opMakeObject(i); return;
        case OpCode::GET_FIELD:     opGetField(i);   return;
        case OpCode::SET_FIELD:     opSetField(i);   return;
        case OpCode::GET_INDEX:     opGetIndex();    return;
        case OpCode::SET_INDEX:     opSetIndex();    return;

        case OpCode::CALL_METHOD:   opCallMethod(i); return;
        case OpCode::HOST_CALL:     opHostCall(i);   return;
        case OpCode::AWAIT:         opAwait();       return;
    }
    setError("unknown opcode");
}

// =============================================================================
// Helpers
// =============================================================================

bool KscVM::pop(Value& out) {
    if (stack_.empty()) {
        setError("stack underflow");
        return false;
    }
    out = std::move(stack_.back());
    stack_.pop_back();
    return true;
}

bool KscVM::popNumber(double& out) {
    Value v;
    if (!pop(v)) return false;
    if (const auto* d = std::get_if<double>(&v)) {
        out = *d;
        return true;
    }
    setError("expected number, got " + to_debug_string(v));
    return false;
}

Value KscVM::loadVar(const CallFrame& frame, const std::string& name) const {
    // 1. Current frame locals
    auto itL = frame.locals.find(name);
    if (itL != frame.locals.end()) return itL->second;

    // 2. Globals
    auto itG = globals_.find(name);
    if (itG != globals_.end()) return itG->second;

    // 3. Function name → index (function values are encoded as their index)
    auto itF = functionMap_.find(name);
    if (itF != functionMap_.end()) return make_number(static_cast<double>(itF->second));

    // 4. Unknown variable → null (matches TS)
    return make_null();
}

bool KscVM::constString(std::int32_t index, std::string& out) {
    if (index < 0 || index >= static_cast<std::int32_t>(module_.constants.size())) {
        setError("constant pool index out of range: " + std::to_string(index));
        return false;
    }
    const Value& v = module_.constants[index];
    if (const auto* s = std::get_if<std::string>(&v)) {
        out = *s;
        return true;
    }
    setError("constant at index " + std::to_string(index) + " is not a string");
    return false;
}

void KscVM::setError(std::string msg) {
    status_            = VMStatus::Errored;
    error_.message     = std::move(msg);
    error_.sourceLine  = currentLine_;
    error_.callTrace   = buildCallTrace();
}

std::vector<std::string> KscVM::buildCallTrace() const {
    std::vector<std::string> trace;
    trace.reserve(callStack_.size());
    for (auto it = callStack_.rbegin(); it != callStack_.rend(); ++it) {
        const auto& f = module_.functions[it->funcIndex];
        trace.push_back(f.name + " (pc=" + std::to_string(it->pc) + ")");
    }
    return trace;
}

// =============================================================================
// Stack operations
// =============================================================================

void KscVM::opLoadConst(const Instruction& i) {
    if (i.operand < 0 ||
        i.operand >= static_cast<std::int32_t>(module_.constants.size())) {
        setError("LOAD_CONST: operand out of range");
        return;
    }
    push(module_.constants[i.operand]);
}

void KscVM::opLoadVar(const Instruction& i) {
    std::string name;
    if (!constString(i.operand, name)) return;
    push(loadVar(callStack_.back(), name));
}

void KscVM::opStoreVar(const Instruction& i) {
    std::string name;
    if (!constString(i.operand, name)) return;

    Value val;
    if (!pop(val)) return;

    CallFrame& frame = callStack_.back();

    // Match TS semantics: if the name is already a global AND not a local,
    // update the global. Otherwise store in frame locals.
    const bool isLocal  = frame.locals.find(name) != frame.locals.end();
    const bool isGlobal = globals_.find(name) != globals_.end();

    if (isGlobal && !isLocal) {
        globals_[name] = std::move(val);
    } else {
        frame.locals[name] = std::move(val);
    }
}

void KscVM::opPop() {
    if (stack_.empty()) { setError("POP: stack underflow"); return; }
    stack_.pop_back();
}

void KscVM::opDup() {
    if (stack_.empty()) { setError("DUP: stack underflow"); return; }
    stack_.push_back(stack_.back());
}

// =============================================================================
// Arithmetic
// =============================================================================

namespace {
// Coerce a value to string the TS way for `+` concatenation. Strings are used
// as-is; null / bool / number (and anything else) use to_debug_string, which
// already prints "null", "true"/"false" and the TS number form.
std::string CoerceToString(const Value& v) {
    if (is_string(v)) return std::get<std::string>(v);
    return to_debug_string(v);
}
} // namespace

void KscVM::opAdd() {
    Value b, a;
    if (!pop(b) || !pop(a)) return;
    // If either side is a string, do string concat (matches TS).
    if (is_string(a) || is_string(b)) {
        push(make_string(CoerceToString(a) + CoerceToString(b)));
        return;
    }
    // Otherwise numeric add.
    if (!is_number(a) || !is_number(b)) {
        setError("ADD: expected numbers");
        return;
    }
    push(make_number(std::get<double>(a) + std::get<double>(b)));
}

void KscVM::opSub() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    push(make_number(a - b));
}

void KscVM::opMul() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    push(make_number(a * b));
}

void KscVM::opDiv() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    if (b == 0.0) { setError("Division by zero"); return; }
    push(make_number(a / b));
}

void KscVM::opMod() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    if (b == 0.0) { setError("Division by zero"); return; }
    // TS uses JS % which is fmod-like with sign of dividend.
    push(make_number(std::fmod(a, b)));
}

void KscVM::opNeg() {
    double a;
    if (!popNumber(a)) return;
    push(make_number(-a));
}

// =============================================================================
// Comparison
// =============================================================================

void KscVM::opCmpEq() {
    Value b, a;
    if (!pop(b) || !pop(a)) return;
    push(make_bool(values_equal(a, b)));
}

void KscVM::opCmpNeq() {
    Value b, a;
    if (!pop(b) || !pop(a)) return;
    push(make_bool(!values_equal(a, b)));
}

void KscVM::opCmpLt() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    push(make_bool(a < b));
}

void KscVM::opCmpLteq() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    push(make_bool(a <= b));
}

void KscVM::opCmpGt() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    push(make_bool(a > b));
}

void KscVM::opCmpGteq() {
    double b, a;
    if (!popNumber(b) || !popNumber(a)) return;
    push(make_bool(a >= b));
}

// =============================================================================
// Logical
// =============================================================================

void KscVM::opNot() {
    Value a;
    if (!pop(a)) return;
    push(make_bool(!is_truthy(a)));
}

void KscVM::opAnd() {
    // TS: isTruthy(a) ? b : a
    Value b, a;
    if (!pop(b) || !pop(a)) return;
    push(is_truthy(a) ? std::move(b) : std::move(a));
}

void KscVM::opOr() {
    // TS: isTruthy(a) ? a : b
    Value b, a;
    if (!pop(b) || !pop(a)) return;
    push(is_truthy(a) ? std::move(a) : std::move(b));
}

// =============================================================================
// Control flow
// =============================================================================

void KscVM::opJmp(const Instruction& i) {
    callStack_.back().pc = i.operand;
}

void KscVM::opJmpIfFalse(const Instruction& i) {
    Value cond;
    if (!pop(cond)) return;
    if (!is_truthy(cond)) {
        callStack_.back().pc = i.operand;
    }
}

// New call frame at pc 0 with params bound to args. Missing args default to null.
CallFrame KscVM::MakeFrame(int funcIdx, const IRFunction& target, const std::vector<Value>& args) {
    CallFrame frame;
    frame.funcIndex = funcIdx;
    frame.pc        = 0;
    for (std::size_t k = 0; k < target.paramNames.size(); ++k) {
        frame.locals[target.paramNames[k]] = k < args.size() ? args[k] : make_null();
    }
    return frame;
}

void KscVM::opCall(const Instruction& i) {
    const int argCount = i.operand;

    // Stack layout: [..., arg0, arg1, ..., argN-1, callee]
    Value callee;
    if (!pop(callee)) return;
    if (!is_number(callee)) {
        setError("CALL: callee must be a function index (number), got " +
                 to_debug_string(callee));
        return;
    }
    const int funcIdx = static_cast<int>(std::get<double>(callee));

    if (funcIdx < 0 ||
        funcIdx >= static_cast<int>(module_.functions.size())) {
        setError("CALL: invalid function index: " + std::to_string(funcIdx));
        return;
    }
    const IRFunction& target = module_.functions[funcIdx];

    // Pop arguments in reverse (argN-1 first on top).
    std::vector<Value> args;
    args.resize(static_cast<std::size_t>(argCount));
    for (int k = argCount - 1; k >= 0; --k) {
        if (!pop(args[static_cast<std::size_t>(k)])) return;
    }

    callStack_.push_back(MakeFrame(funcIdx, target, args));
}

void KscVM::opRet() {
    // TS VM tolerates RET on an empty stack (pops undefined → treated as
    // null when observed). We mirror that silently rather than erroring,
    // because some hand-written / compiler-generated IR ends a function
    // via a fall-through path that JMPs to RET without a pushed value.
    Value retVal = make_null();
    if (!stack_.empty()) {
        retVal = std::move(stack_.back());
        stack_.pop_back();
    }
    callStack_.pop_back();

    if (callStack_.empty()) {
        // Returning from main — VM is done. TS VM does NOT push retVal back
        // to the (now-caller-less) stack; we record it only via result_ so
        // the final stack state matches TS parity.
        status_ = VMStatus::Done;
        result_ = std::move(retVal);
        return;
    }

    // Return value goes onto the caller's stack.
    push(std::move(retVal));
}

void KscVM::opSwitch(const Instruction& i) {
    const std::int32_t tableIdx = i.operand;
    if (tableIdx < 0 ||
        tableIdx >= static_cast<std::int32_t>(module_.switchTables.size())) {
        setError("SWITCH: table index out of range: " + std::to_string(tableIdx));
        return;
    }
    const SwitchCaseTable& table = module_.switchTables[tableIdx];

    Value disc;
    if (!pop(disc)) return;

    int target = table.defaultTarget;
    for (const auto& c : table.cases) {
        if (values_equal(c.value, disc)) {
            target = c.target;
            break;
        }
    }
    callStack_.back().pc = target;
}

// =============================================================================
// Objects & arrays (Day 4)
// =============================================================================

void KscVM::opMakeArray(const Instruction& i) {
    const int count = i.operand;
    if (count < 0) { setError("MAKE_ARRAY: negative count"); return; }

    auto arr = new_array();
    arr->elements.resize(static_cast<std::size_t>(count));
    // Popped in reverse so that the original push order is preserved.
    for (int k = count - 1; k >= 0; --k) {
        if (!pop(arr->elements[static_cast<std::size_t>(k)])) return;
    }
    push(make_array(std::move(arr)));
}

void KscVM::opMakeObject(const Instruction& i) {
    // Stack pushed in order: [key0, val0, key1, val1, ...]. Operand = pair count.
    const int count = i.operand;
    if (count < 0) { setError("MAKE_OBJECT: negative count"); return; }

    // Pop pairs in reverse (val then key per pair), collect, then rebuild
    // to preserve left-to-right definition order in iteration (best effort —
    // std::unordered_map doesn't preserve, but field count is tiny in practice).
    std::vector<std::pair<std::string, Value>> pairs;
    pairs.resize(static_cast<std::size_t>(count));
    for (int k = count - 1; k >= 0; --k) {
        Value val, key;
        if (!pop(val)) return;
        if (!pop(key)) return;
        if (!is_string(key)) {
            setError("MAKE_OBJECT: key must be a string, got " +
                     to_debug_string(key));
            return;
        }
        pairs[static_cast<std::size_t>(k)] = {std::get<std::string>(key),
                                              std::move(val)};
    }

    auto obj = new_object();
    for (auto& [k, v] : pairs) {
        obj->fields[k] = std::move(v);
    }
    push(make_object(std::move(obj)));
}

void KscVM::opGetField(const Instruction& i) {
    std::string fieldName;
    if (!constString(i.operand, fieldName)) return;

    Value target;
    if (!pop(target)) return;

    if (is_object(target)) {
        // Walk prototype chain (TS parity — proto is currently always null,
        // but the walk keeps semantics correct if class support lands later).
        ObjectPtr current = std::get<ObjectPtr>(target);
        while (current) {
            auto it = current->fields.find(fieldName);
            if (it != current->fields.end()) {
                push(it->second);
                return;
            }
            current = current->proto;
        }
        push(make_null());
        return;
    }

    if (is_array(target) && fieldName == "length") {
        const auto& arr = *std::get<ArrayPtr>(target);
        push(make_number(static_cast<double>(arr.elements.size())));
        return;
    }

    // Any other target (primitives, null) → null.
    push(make_null());
}

void KscVM::opSetField(const Instruction& i) {
    std::string fieldName;
    if (!constString(i.operand, fieldName)) return;

    Value val, target;
    if (!pop(val) || !pop(target)) return;

    // TS only writes on KscObject; other targets silently no-op.
    if (is_object(target)) {
        std::get<ObjectPtr>(target)->fields[fieldName] = val;
    }

    // Assignment expression yields the assigned value.
    push(std::move(val));
}

void KscVM::opGetIndex() {
    Value index, target;
    if (!pop(index) || !pop(target)) return;

    if (is_array(target)) {
        if (!is_number(index)) {
            // TS coerces non-number index via array subscript; most call sites
            // pass a number. Treat non-number as null for safety.
            push(make_null());
            return;
        }
        const auto& arr = *std::get<ArrayPtr>(target);
        const auto idx = static_cast<std::ptrdiff_t>(std::get<double>(index));
        if (idx < 0 || idx >= static_cast<std::ptrdiff_t>(arr.elements.size())) {
            push(make_null());
            return;
        }
        push(arr.elements[static_cast<std::size_t>(idx)]);
        return;
    }

    if (is_object(target)) {
        // obj[n] → lookup by stringified number (matches TS `String(index)`).
        std::string key;
        if (is_string(index)) {
            key = std::get<std::string>(index);
        } else if (is_number(index)) {
            const double d = std::get<double>(index);
            key = to_debug_string(make_number(d));
        } else {
            push(make_null());
            return;
        }
        const auto& obj = *std::get<ObjectPtr>(target);
        auto it = obj.fields.find(key);
        push(it == obj.fields.end() ? make_null() : it->second);
        return;
    }

    // null / primitive targets → null.
    push(make_null());
}

void KscVM::opSetIndex() {
    // Stack layout: [array, index, value] (value on top)
    Value val, index, target;
    if (!pop(val) || !pop(index) || !pop(target)) return;

    if (is_array(target)) {
        if (!is_number(index)) {
            setError("SET_INDEX: array index must be a number");
            return;
        }
        auto& arr = *std::get<ArrayPtr>(target);
        const auto idx = static_cast<std::ptrdiff_t>(std::get<double>(index));
        if (idx < 0) {
            setError("SET_INDEX: negative index not supported");
            return;
        }
        // TS arrays auto-extend with undefined → we fill with null.
        if (static_cast<std::size_t>(idx) >= arr.elements.size()) {
            arr.elements.resize(static_cast<std::size_t>(idx) + 1, make_null());
        }
        arr.elements[static_cast<std::size_t>(idx)] = val;
    } else if (is_object(target)) {
        // obj[key] = val — key stringified like TS
        std::string key;
        if (is_string(index)) {
            key = std::get<std::string>(index);
        } else if (is_number(index)) {
            key = to_debug_string(make_number(std::get<double>(index)));
        } else {
            push(std::move(val));
            return;
        }
        std::get<ObjectPtr>(target)->fields[key] = val;
    }
    // null / primitive targets silently no-op (TS parity).

    // Assignment expression yields the assigned value.
    push(std::move(val));
}

// =============================================================================
// Methods & async (Day 5)
// =============================================================================

Value KscVM::getFieldOnObject(const ObjectPtr& obj, const std::string& name) const {
    ObjectPtr cur = obj;
    while (cur) {
        auto it = cur->fields.find(name);
        if (it != cur->fields.end()) return it->second;
        cur = cur->proto;
    }
    return make_null();
}

Value KscVM::callArrayMethod(ArrayPtr arr,
                              const std::string& method,
                              const std::vector<Value>& args) {
    if (method == "push") {
        for (const auto& a : args) arr->elements.push_back(a);
        return make_number(static_cast<double>(arr->elements.size()));
    }
    if (method == "pop") {
        if (arr->elements.empty()) return make_null();
        Value v = std::move(arr->elements.back());
        arr->elements.pop_back();
        return v;
    }
    if (method == "length") {
        return make_number(static_cast<double>(arr->elements.size()));
    }
    setError("Unknown array method: " + method);
    return make_null();
}

void KscVM::opCallMethod(const Instruction& i) {
    // operand  = arg count
    // operand2 = const pool idx for the method name (string)
    const int argCount = i.operand;

    std::string methodName;
    if (!constString(i.operand2, methodName)) return;

    // Stack layout before CALL_METHOD: [obj, arg0, arg1, ..., argN-1]
    std::vector<Value> args;
    args.resize(static_cast<std::size_t>(argCount));
    for (int k = argCount - 1; k >= 0; --k) {
        if (!pop(args[static_cast<std::size_t>(k)])) return;
    }

    Value target;
    if (!pop(target)) return;

    // Array methods (built-in).
    if (is_array(target)) {
        ArrayPtr arr = std::get<ArrayPtr>(target);
        const Value result = callArrayMethod(arr, methodName, args);
        if (status_ == VMStatus::Errored) return;
        push(result);
        return;
    }

    // Object method: look up in fields (walking proto).
    if (is_object(target)) {
        ObjectPtr obj = std::get<ObjectPtr>(target);
        Value method = getFieldOnObject(obj, methodName);
        if (is_number(method)) {
            const int funcIdx = static_cast<int>(std::get<double>(method));
            if (funcIdx < 0 ||
                funcIdx >= static_cast<int>(module_.functions.size())) {
                setError("CALL_METHOD: invalid method function index: " +
                         std::to_string(funcIdx));
                return;
            }
            const IRFunction& targetFunc = module_.functions[funcIdx];

            // Push new frame with `this` bound to obj + params bound to args.
            CallFrame newFrame = MakeFrame(funcIdx, targetFunc, args);
            newFrame.locals["this"] = make_object(obj);
            callStack_.push_back(std::move(newFrame));
            return;
        }
        // fall through to error
    }

    setError("Cannot call method '" + methodName + "' on " +
             to_debug_string(target));
}

void KscVM::opHostCall(const Instruction& i) {
    // operand  = const idx for function name (string)
    // operand2 = arg count
    std::string fname;
    if (!constString(i.operand, fname)) return;

    const int argCount = i.operand2;
    std::vector<Value> args;
    args.resize(static_cast<std::size_t>(argCount));
    for (int k = argCount - 1; k >= 0; --k) {
        if (!pop(args[static_cast<std::size_t>(k)])) return;
    }

    // stdlib intrinsics are computed in-VM (host non-経由) for TS/C++ parity.
    {
        Value sv;
        if (tryStdlib(fname, args, sv)) {
            push(std::move(sv));
            return;
        }
    }

    if (!host_) {
        setError("HOST_CALL '" + fname + "': no HostAPI bound");
        return;
    }

    const VMResult result = host_->call(fname, args);

    if (result.type == VMResultType::CONTINUE) {
        push(result.value);
        return;
    }

    // WAIT_* → yield. Host is expected to push the resolved value via resume().
    awaitedValue_ = result.value;
    awaitKind_    = result.type;
    status_       = VMStatus::Awaiting;
}

// stdlib pure-math intrinsics. MUST stay byte-for-byte identical to
// vm.ts callStdlib(). Pinned semantics:
//   round = floor(x + 0.5) (half toward +Inf; NOT std::round, which rounds
//           half away from zero and diverges from JS on negatives)
//   sign  = NaN→NaN, >0→1, <0→-1, else 0
//   min/max = NaN-propagating, plain < / > otherwise
//   sqrt  = IEEE-754 correctly-rounded (platform-identical)
namespace {
double stdlibArg(const std::vector<Value>& args, std::size_t i) {
    if (i < args.size() && is_number(args[i])) return std::get<double>(args[i]);
    return std::numeric_limits<double>::quiet_NaN();
}
}  // namespace

bool KscVM::tryStdlib(const std::string& name,
                      const std::vector<Value>& args,
                      Value& out) const {
    const double a = stdlibArg(args, 0);
    if (name == "floor") { out = make_number(std::floor(a)); return true; }
    if (name == "ceil")  { out = make_number(std::ceil(a));  return true; }
    if (name == "trunc") { out = make_number(std::trunc(a)); return true; }
    if (name == "round") { out = make_number(std::floor(a + 0.5)); return true; }
    if (name == "abs")   { out = make_number(std::fabs(a)); return true; }
    if (name == "sqrt")  { out = make_number(std::sqrt(a)); return true; }
    if (name == "sign")  {
        out = make_number(a != a ? a : (a > 0.0 ? 1.0 : (a < 0.0 ? -1.0 : 0.0)));
        return true;
    }
    if (name == "min") {
        const double b = stdlibArg(args, 1);
        out = make_number(a != a ? a : (b != b ? b : (a < b ? a : b)));
        return true;
    }
    if (name == "max") {
        const double b = stdlibArg(args, 1);
        out = make_number(a != a ? a : (b != b ? b : (a > b ? a : b)));
        return true;
    }
    if (name == "clamp") {
        const double lo = stdlibArg(args, 1);
        const double hi = stdlibArg(args, 2);
        out = make_number(a != a ? a : (a < lo ? lo : (a > hi ? hi : a)));
        return true;
    }
    return false;
}

void KscVM::opAwait() {
    // TS: pop, return {status: 'await', value: popped}. We surface the popped
    // value via awaitedValue() so the host can drive the wait externally.
    Value v;
    if (!pop(v)) return;
    awaitedValue_ = std::move(v);
    awaitKind_    = VMResultType::WAIT_EVENT;
    status_       = VMStatus::Awaiting;
}

// =============================================================================
// Debug
// =============================================================================

void KscVM::opDebugLine(const Instruction& i) {
    currentLine_ = i.operand;
}

// =============================================================================
// Save / Load
// =============================================================================

namespace {

using nlohmann::json;

// Serialize a Value to JSON. Mirrors how the TS VMState shape would look
// when round-tripped through JSON.stringify.
json value_to_json(const Value& v) {
    if (is_null(v)) return nullptr;
    if (const auto* b = std::get_if<bool>(&v))        return *b;
    if (const auto* d = std::get_if<double>(&v)) {
        // Serialize integers without fraction for TS parity.
        if (!std::isnan(*d) && !std::isinf(*d) &&
            *d == static_cast<double>(static_cast<long long>(*d)) &&
            *d >= -9e15 && *d <= 9e15) {
            return static_cast<long long>(*d);
        }
        if (std::isnan(*d)) return "__NaN__";
        if (std::isinf(*d)) return (*d < 0) ? "__-Infinity__" : "__Infinity__";
        return *d;
    }
    if (const auto* s = std::get_if<std::string>(&v)) return *s;
    if (is_array(v)) {
        json arr = json::array();
        for (const auto& e : std::get<ArrayPtr>(v)->elements) {
            arr.push_back(value_to_json(e));
        }
        return {
            {"__ksc_type", "array"},
            {"elements",    arr},
        };
    }
    if (is_object(v)) {
        const auto& obj = *std::get<ObjectPtr>(v);
        json fields = json::object();
        for (const auto& [k, val] : obj.fields) {
            fields[k] = value_to_json(val);
        }
        json j = {
            {"__ksc_type", "object"},
            {"fields",      fields},
            {"typeTag",     obj.typeTag},
        };
        return j;
    }
    return nullptr;
}

// Deserialize a Value from JSON. Round-trip matches value_to_json.
Value value_from_json(const json& j) {
    if (j.is_null())    return make_null();
    if (j.is_boolean()) return make_bool(j.get<bool>());
    if (j.is_number())  return make_number(j.get<double>());
    if (j.is_string()) {
        const auto s = j.get<std::string>();
        if (s == "__NaN__")       return make_number(std::nan(""));
        if (s == "__Infinity__")  return make_number( std::numeric_limits<double>::infinity());
        if (s == "__-Infinity__") return make_number(-std::numeric_limits<double>::infinity());
        return make_string(s);
    }
    if (j.is_object() && j.contains("__ksc_type") && j["__ksc_type"].is_string()) {
        const auto tag = j["__ksc_type"].get<std::string>();
        if (tag == "array") {
            auto arr = new_array();
            if (j.contains("elements") && j["elements"].is_array()) {
                for (const auto& e : j["elements"]) {
                    arr->elements.push_back(value_from_json(e));
                }
            }
            return make_array(arr);
        }
        if (tag == "object") {
            auto obj = new_object();
            if (j.contains("fields") && j["fields"].is_object()) {
                for (auto it = j["fields"].begin(); it != j["fields"].end(); ++it) {
                    obj->fields[it.key()] = value_from_json(it.value());
                }
            }
            if (j.contains("typeTag") && j["typeTag"].is_string()) {
                obj->typeTag = j["typeTag"].get<std::string>();
            }
            return make_object(obj);
        }
    }
    return make_null();
}

const char* status_to_string(VMStatus s) {
    switch (s) {
        case VMStatus::Ready:    return "Ready";
        case VMStatus::Running:  return "Running";
        case VMStatus::Done:     return "Done";
        case VMStatus::Errored:  return "Errored";
        case VMStatus::Awaiting: return "Awaiting";
    }
    return "Ready";
}

bool status_from_string(const std::string& s, VMStatus& out) {
    if (s == "Ready")    { out = VMStatus::Ready;    return true; }
    if (s == "Running")  { out = VMStatus::Running;  return true; }
    if (s == "Done")     { out = VMStatus::Done;     return true; }
    if (s == "Errored")  { out = VMStatus::Errored;  return true; }
    if (s == "Awaiting") { out = VMStatus::Awaiting; return true; }
    return false;
}

} // namespace

std::string KscVM::serializeState() const {
    nlohmann::json root;

    // stack
    root["stack"] = nlohmann::json::array();
    for (const auto& v : stack_) {
        root["stack"].push_back(value_to_json(v));
    }

    // callStack
    root["callStack"] = nlohmann::json::array();
    for (const auto& f : callStack_) {
        nlohmann::json frame;
        frame["funcIndex"] = f.funcIndex;
        frame["pc"]        = f.pc;
        frame["locals"]    = nlohmann::json::object();
        for (const auto& [k, v] : f.locals) {
            frame["locals"][k] = value_to_json(v);
        }
        root["callStack"].push_back(std::move(frame));
    }

    // globals
    root["globals"] = nlohmann::json::object();
    for (const auto& [k, v] : globals_) {
        root["globals"][k] = value_to_json(v);
    }

    root["currentLine"]      = currentLine_;
    root["done"]             = (status_ == VMStatus::Done);
    root["status"]           = status_to_string(status_);
    root["awaitKind"]        = static_cast<int>(awaitKind_);
    root["awaitedValue"]     = value_to_json(awaitedValue_);
    root["instructionCount"] = instructionCount_;

    return root.dump();
}

bool KscVM::deserializeState(const std::string& jsonText) {
    nlohmann::json root = nlohmann::json::parse(jsonText, nullptr, false);
    if (root.is_discarded() || !root.is_object()) return false;

    // 壊れたセーブの数は step() で配列の添字になる。整数でなければ失敗にする。
    const auto intField = [](const nlohmann::json& o, const char* key, int& out) -> bool {
        const auto it = o.find(key);
        if (it == o.end()) { out = 0; return true; }
        if (!it->is_number_integer()) return false;
        const auto v = it->get<std::int64_t>();
        if (v < INT32_MIN || v > INT32_MAX) return false;
        out = static_cast<int>(v);
        return true;
    };

    // Build candidate state in locals; only commit if fully parsed.
    std::vector<Value>                  newStack;
    std::vector<CallFrame>              newCallStack;
    std::unordered_map<std::string, Value> newGlobals;
    int                                 newLine = 0;
    VMStatus                            newStatus = VMStatus::Ready;
    Value                               newAwaitedValue = make_null();
    VMResultType                        newAwaitKind = VMResultType::CONTINUE;
    std::uint64_t                       newInstrCount = 0;

    if (root.contains("stack") && root["stack"].is_array()) {
        for (const auto& v : root["stack"]) {
            newStack.push_back(value_from_json(v));
        }
    }

    if (root.contains("callStack") && root["callStack"].is_array()) {
        for (const auto& f : root["callStack"]) {
            if (!f.is_object()) return false;
            CallFrame frame;
            if (!intField(f, "funcIndex", frame.funcIndex)) return false;
            if (!intField(f, "pc", frame.pc)) return false;
            // step() は functions[funcIndex] を確かめずに引く（pc は上限だけ見る）。
            // pc == instructions.size() は「関数の終わり」（暗黙の return）で正しい値。
            if (frame.funcIndex < 0
                || frame.funcIndex >= static_cast<int>(module_.functions.size())) return false;
            if (frame.pc < 0
                || frame.pc > static_cast<int>(module_.functions[frame.funcIndex].instructions.size())) return false;
            if (f.contains("locals") && f["locals"].is_object()) {
                for (auto it = f["locals"].begin();
                     it != f["locals"].end(); ++it) {
                    frame.locals[it.key()] = value_from_json(it.value());
                }
            }
            newCallStack.push_back(std::move(frame));
        }
    }

    if (root.contains("globals") && root["globals"].is_object()) {
        for (auto it = root["globals"].begin();
             it != root["globals"].end(); ++it) {
            newGlobals[it.key()] = value_from_json(it.value());
        }
    }

    if (!intField(root, "currentLine", newLine)) return false;
    if (root.contains("instructionCount")) {
        if (!root["instructionCount"].is_number_unsigned()
            && !root["instructionCount"].is_number_integer()) return false;
        newInstrCount = root["instructionCount"].is_number_unsigned()
            ? root["instructionCount"].get<std::uint64_t>()
            : static_cast<std::uint64_t>(std::max<std::int64_t>(0, root["instructionCount"].get<std::int64_t>()));
    }

    if (root.contains("status") && root["status"].is_string()) {
        status_from_string(root["status"].get<std::string>(), newStatus);
    } else if (root.contains("done") && root["done"].is_boolean() && root["done"].get<bool>()) {
        newStatus = VMStatus::Done;
    }

    if (root.contains("awaitKind") && root["awaitKind"].is_number_integer()) {
        const int k = root["awaitKind"].get<int>();
        if (k >= 0 && k <= static_cast<int>(VMResultType::WAIT_BATTLE)) {
            newAwaitKind = static_cast<VMResultType>(k);
        }
    }
    if (root.contains("awaitedValue")) {
        newAwaitedValue = value_from_json(root["awaitedValue"]);
    }

    // Commit.
    stack_            = std::move(newStack);
    callStack_        = std::move(newCallStack);
    globals_          = std::move(newGlobals);
    currentLine_      = newLine;
    status_           = newStatus;
    awaitedValue_     = std::move(newAwaitedValue);
    awaitKind_        = newAwaitKind;
    instructionCount_ = newInstrCount;
    error_            = VMError{};
    if (!stack_.empty()) result_ = stack_.back();

    return true;
}

} // namespace kaedevn::ksc
