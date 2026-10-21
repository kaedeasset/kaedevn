// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "kaedevn/ksc/IRLoader.hpp"

#include <string>
#include <unordered_map>

#include <nlohmann/json.hpp>

namespace kaedevn::ksc {

using nlohmann::json;

// -----------------------------------------------------------------------------
// OpCode string ↔ enum
// -----------------------------------------------------------------------------

static const std::unordered_map<std::string, OpCode>& opcode_table() {
    static const std::unordered_map<std::string, OpCode> t = {
        {"LOAD_CONST",  OpCode::LOAD_CONST},
        {"LOAD_VAR",    OpCode::LOAD_VAR},
        {"STORE_VAR",   OpCode::STORE_VAR},
        {"POP",         OpCode::POP},
        {"DUP",         OpCode::DUP},
        {"ADD",         OpCode::ADD},
        {"SUB",         OpCode::SUB},
        {"MUL",         OpCode::MUL},
        {"DIV",         OpCode::DIV},
        {"MOD",         OpCode::MOD},
        {"NEG",         OpCode::NEG},
        {"CMP_EQ",      OpCode::CMP_EQ},
        {"CMP_NEQ",     OpCode::CMP_NEQ},
        {"CMP_LT",      OpCode::CMP_LT},
        {"CMP_LTEQ",    OpCode::CMP_LTEQ},
        {"CMP_GT",      OpCode::CMP_GT},
        {"CMP_GTEQ",    OpCode::CMP_GTEQ},
        {"AND",         OpCode::AND},
        {"OR",          OpCode::OR},
        {"NOT",         OpCode::NOT},
        {"JMP",         OpCode::JMP},
        {"JMP_IF_FALSE", OpCode::JMP_IF_FALSE},
        {"CALL",        OpCode::CALL},
        {"CALL_METHOD", OpCode::CALL_METHOD},
        {"RET",         OpCode::RET},
        {"SWITCH",      OpCode::SWITCH},
        {"MAKE_ARRAY",  OpCode::MAKE_ARRAY},
        {"MAKE_OBJECT", OpCode::MAKE_OBJECT},
        {"GET_FIELD",   OpCode::GET_FIELD},
        {"SET_FIELD",   OpCode::SET_FIELD},
        {"GET_INDEX",   OpCode::GET_INDEX},
        {"SET_INDEX",   OpCode::SET_INDEX},
        {"HOST_CALL",   OpCode::HOST_CALL},
        {"AWAIT",       OpCode::AWAIT},
        {"DEBUG_LINE",  OpCode::DEBUG_LINE},
    };
    return t;
}

const char* opcode_to_string(OpCode op) noexcept {
    switch (op) {
        case OpCode::LOAD_CONST:    return "LOAD_CONST";
        case OpCode::LOAD_VAR:      return "LOAD_VAR";
        case OpCode::STORE_VAR:     return "STORE_VAR";
        case OpCode::POP:           return "POP";
        case OpCode::DUP:           return "DUP";
        case OpCode::ADD:           return "ADD";
        case OpCode::SUB:           return "SUB";
        case OpCode::MUL:           return "MUL";
        case OpCode::DIV:           return "DIV";
        case OpCode::MOD:           return "MOD";
        case OpCode::NEG:           return "NEG";
        case OpCode::CMP_EQ:        return "CMP_EQ";
        case OpCode::CMP_NEQ:       return "CMP_NEQ";
        case OpCode::CMP_LT:        return "CMP_LT";
        case OpCode::CMP_LTEQ:      return "CMP_LTEQ";
        case OpCode::CMP_GT:        return "CMP_GT";
        case OpCode::CMP_GTEQ:      return "CMP_GTEQ";
        case OpCode::AND:           return "AND";
        case OpCode::OR:            return "OR";
        case OpCode::NOT:           return "NOT";
        case OpCode::JMP:           return "JMP";
        case OpCode::JMP_IF_FALSE:  return "JMP_IF_FALSE";
        case OpCode::CALL:          return "CALL";
        case OpCode::CALL_METHOD:   return "CALL_METHOD";
        case OpCode::RET:           return "RET";
        case OpCode::SWITCH:        return "SWITCH";
        case OpCode::MAKE_ARRAY:    return "MAKE_ARRAY";
        case OpCode::MAKE_OBJECT:   return "MAKE_OBJECT";
        case OpCode::GET_FIELD:     return "GET_FIELD";
        case OpCode::SET_FIELD:     return "SET_FIELD";
        case OpCode::GET_INDEX:     return "GET_INDEX";
        case OpCode::SET_INDEX:     return "SET_INDEX";
        case OpCode::HOST_CALL:     return "HOST_CALL";
        case OpCode::AWAIT:         return "AWAIT";
        case OpCode::DEBUG_LINE:    return "DEBUG_LINE";
    }
    return "UNKNOWN";
}

bool opcode_from_string(const std::string& s, OpCode& out) noexcept {
    const auto& t = opcode_table();
    const auto it = t.find(s);
    if (it == t.end()) return false;
    out = it->second;
    return true;
}

// -----------------------------------------------------------------------------
// JSON → Value (for constants and switch case values)
// -----------------------------------------------------------------------------

static bool json_to_value(const json& j, Value& out, std::string& err) {
    if (j.is_null())    { out = make_null();                         return true; }
    if (j.is_boolean()) { out = make_bool(j.get<bool>());             return true; }
    if (j.is_number())  { out = make_number(j.get<double>());         return true; }
    if (j.is_string())  { out = make_string(j.get<std::string>());    return true; }
    // Arrays / objects should not appear in the constant pool (compiler
    // never emits them as literals — they are built at runtime).
    err = "non-primitive value in constant pool";
    return false;
}

// -----------------------------------------------------------------------------
// Load helpers — each `load_*` returns false on error with `err` populated.
// -----------------------------------------------------------------------------

static bool load_instruction(const json& j, Instruction& out, std::string& err) {
    if (!j.is_object() || !j.contains("op")) {
        err = "instruction missing 'op'";
        return false;
    }
    if (!j["op"].is_string()) {
        err = "instruction 'op' is not a string";
        return false;
    }
    const auto opStr = j["op"].get<std::string>();
    if (!opcode_from_string(opStr, out.op)) {
        err = "unknown opcode: " + opStr;
        return false;
    }
    if (j.contains("operand") && j["operand"].is_number()) {
        out.operand = j["operand"].get<std::int32_t>();
    }
    if (j.contains("operand2") && j["operand2"].is_number()) {
        out.operand2 = j["operand2"].get<std::int32_t>();
    }
    return true;
}

static bool load_function(const json& j, IRFunction& out, std::string& err) {
    if (!j.is_object()) { err = "function is not an object"; return false; }

    out.name       = j.value("name", "");
    out.paramCount = j.value("paramCount", 0);
    out.localCount = j.value("localCount", 0);
    out.sourceFile = j.value("sourceFile", "");

    if (j.contains("paramNames") && j["paramNames"].is_array()) {
        for (const auto& n : j["paramNames"]) {
            if (!n.is_string()) { err = "paramName not string"; return false; }
            out.paramNames.push_back(n.get<std::string>());
        }
    }

    if (!j.contains("instructions") || !j["instructions"].is_array()) {
        err = "function missing 'instructions' array";
        return false;
    }
    out.instructions.reserve(j["instructions"].size());
    for (const auto& inst : j["instructions"]) {
        Instruction ins;
        if (!load_instruction(inst, ins, err)) return false;
        out.instructions.push_back(std::move(ins));
    }
    return true;
}

static bool load_switch_table(const json& j, SwitchCaseTable& out, std::string& err) {
    if (!j.is_object()) { err = "switch table is not an object"; return false; }
    out.defaultTarget = j.value("defaultTarget", 0);

    if (j.contains("cases") && j["cases"].is_array()) {
        for (const auto& c : j["cases"]) {
            if (!c.is_object()) { err = "switch case not an object"; return false; }
            SwitchCase sc;
            if (!json_to_value(c.value("value", json()), sc.value, err)) return false;
            sc.target = c.value("target", 0);
            out.cases.push_back(std::move(sc));
        }
    }
    return true;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

// Shared post-parse path: take an already-parsed json DOM and fill an
// IRModule. Used by both the JSON and CBOR entry points.
static LoadResult load_ir_from_dom(json&& root) noexcept;

LoadResult load_ir_from_json(const std::string& jsonText) noexcept {
    // nlohmann::json can throw. Keep the noexcept contract by using
    // parse's error-reporting overload (no throw) whenever possible.
    json root = json::parse(jsonText, /*cb=*/nullptr, /*allow_exceptions=*/false);
    if (root.is_discarded()) {
        LoadResult r;
        r.ok = false;
        r.errorMessage = "IRLoader: JSON parse failed";
        return r;
    }
    return load_ir_from_dom(std::move(root));
}

LoadResult load_ir_from_cbor(const std::uint8_t* data,
                              std::size_t size) noexcept {
    // nlohmann::json::from_cbor throws on malformed input unless we pass
    // allow_exceptions=false. The 4th arg controls tag handling; default ok.
    json root = json::from_cbor(data, data + size,
                                 /*strict=*/true,
                                 /*allow_exceptions=*/false);
    if (root.is_discarded()) {
        LoadResult r;
        r.ok = false;
        r.errorMessage = "IRLoader: CBOR parse failed";
        return r;
    }
    return load_ir_from_dom(std::move(root));
}

LoadResult load_ir_auto(const std::uint8_t* data,
                         std::size_t size) noexcept {
    if (size == 0) {
        LoadResult r;
        r.errorMessage = "IRLoader: empty input";
        return r;
    }
    // JSON text always begins with `{`, `[`, or whitespace (0x09/0x0a/0x0d/0x20).
    // Everything else we treat as CBOR.
    const std::uint8_t b = data[0];
    const bool looksLikeJson = b == '{' || b == '[' || b == ' '
        || b == '\t' || b == '\n' || b == '\r';
    if (looksLikeJson) {
        return load_ir_from_json(std::string(reinterpret_cast<const char*>(data),
                                              size));
    }
    return load_ir_from_cbor(data, size);
}

std::vector<std::uint8_t> encode_ir_to_cbor(const std::string& jsonText) noexcept {
    json root = json::parse(jsonText, /*cb=*/nullptr, /*allow_exceptions=*/false);
    if (root.is_discarded()) return {};
    return json::to_cbor(root);
}

static LoadResult load_ir_from_dom_checked(const json& root);

static LoadResult load_ir_from_dom(json&& root) noexcept {
    // 型は読む前に見ている。それでも見落とした get<>/value() の型の例外が noexcept を
    // 越えると std::terminate になるので、最後の網として失敗の結果に変える。
    try {
        return load_ir_from_dom_checked(root);
    } catch (const std::exception& e) {
        LoadResult r;
        r.errorMessage = std::string("IRLoader: malformed IR: ") + e.what();
        return r;
    }
}

static LoadResult load_ir_from_dom_checked(const json& root) {
    LoadResult result;

    std::string err;

    if (!root.is_object()) {
        result.errorMessage = "IRLoader: module is not an object";
        return result;
    }

    // entryPoint
    result.module.entryPoint = root.value("entryPoint", 0);

    // constants
    if (root.contains("constants") && root["constants"].is_array()) {
        result.module.constants.reserve(root["constants"].size());
        for (const auto& c : root["constants"]) {
            Value v;
            if (!json_to_value(c, v, err)) {
                result.errorMessage = "IRLoader: constant: " + err;
                return result;
            }
            result.module.constants.push_back(std::move(v));
        }
    }

    // functions
    if (!root.contains("functions") || !root["functions"].is_array()) {
        result.errorMessage = "IRLoader: module missing 'functions' array";
        return result;
    }
    result.module.functions.reserve(root["functions"].size());
    for (const auto& f : root["functions"]) {
        IRFunction fn;
        if (!load_function(f, fn, err)) {
            result.errorMessage = "IRLoader: function: " + err;
            return result;
        }
        result.module.functions.push_back(std::move(fn));
    }

    // switchTables
    if (root.contains("switchTables") && root["switchTables"].is_array()) {
        result.module.switchTables.reserve(root["switchTables"].size());
        for (const auto& t : root["switchTables"]) {
            SwitchCaseTable table;
            if (!load_switch_table(t, table, err)) {
                result.errorMessage = "IRLoader: switchTable: " + err;
                return result;
            }
            result.module.switchTables.push_back(std::move(table));
        }
    }

    // sourceMap: [[offset, line], ...]
    if (root.contains("sourceMap") && root["sourceMap"].is_array()) {
        for (const auto& pair : root["sourceMap"]) {
            if (!pair.is_array() || pair.size() != 2
                || !pair[0].is_number_integer() || !pair[1].is_number_integer()) {
                result.errorMessage = "IRLoader: sourceMap entry must be [offset, line]";
                return result;
            }
            result.module.sourceMap.emplace_back(
                pair[0].get<int>(), pair[1].get<int>());
        }
    }

    result.ok = true;
    return result;
}

} // namespace kaedevn::ksc
