// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KSC Runtime Value Types — C++ port of Tools/kaedevn-compiler/packages/ksc-compiler/src/types/value.ts
//
// Design:
//   Value is std::variant over TS runtime types. Numbers are double (matches TS),
//   strings are UTF-8 std::string. Objects and arrays use shared_ptr to mirror
//   JS reference semantics (assigning an object shares identity).
//
//   KscObject.proto is reserved for future class support (always nullptr for now).
//   Cyclic prototype chains are forbidden — the VM has no cycle collector.
//   If class support adds circularity, switch proto to std::weak_ptr.

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace kaedevn::ksc {

class KscObject;
class KscArray;

using ObjectPtr = std::shared_ptr<KscObject>;
using ArrayPtr  = std::shared_ptr<KscArray>;

/// KSC runtime value. Matches TS `type Value = number | string | boolean | null | KscObject | KscArray`.
/// `std::monostate` represents JS `null` (and KSC's only nil-like value).
using Value = std::variant<
    std::monostate,  // null
    bool,
    double,
    std::string,
    ObjectPtr,
    ArrayPtr
>;

/// Object value. `fields` preserves insertion order via a separate vector
/// when TS VM does (check during Day 4 — switch to ordered map if needed).
class KscObject {
public:
    std::unordered_map<std::string, Value> fields;

    /// Class name. Always nullptr-string-equivalent ("") until class support lands.
    std::string typeTag;

    /// Prototype chain. Always nullptr until class support lands.
    /// When introduced, must be acyclic (no cycle collector).
    ObjectPtr proto;
};

/// Array value.
class KscArray {
public:
    std::vector<Value> elements;
};

// -----------------------------------------------------------------------------
// Type checks (inline — match TS `isKscObject`, `isKscArray`)
// -----------------------------------------------------------------------------

inline bool is_null(const Value& v)   noexcept { return std::holds_alternative<std::monostate>(v); }
inline bool is_bool(const Value& v)   noexcept { return std::holds_alternative<bool>(v); }
inline bool is_number(const Value& v) noexcept { return std::holds_alternative<double>(v); }
inline bool is_string(const Value& v) noexcept { return std::holds_alternative<std::string>(v); }
inline bool is_object(const Value& v) noexcept { return std::holds_alternative<ObjectPtr>(v); }
inline bool is_array(const Value& v)  noexcept { return std::holds_alternative<ArrayPtr>(v); }

// -----------------------------------------------------------------------------
// Factories
// -----------------------------------------------------------------------------

inline Value make_null()                         noexcept { return Value{std::monostate{}}; }
inline Value make_bool(bool b)                   noexcept { return Value{b}; }
inline Value make_number(double d)               noexcept { return Value{d}; }
inline Value make_string(std::string s)          noexcept { return Value{std::move(s)}; }
inline Value make_object(ObjectPtr obj)          noexcept { return Value{std::move(obj)}; }
inline Value make_array(ArrayPtr arr)            noexcept { return Value{std::move(arr)}; }

inline ObjectPtr new_object() {
    return std::make_shared<KscObject>();
}

inline ArrayPtr new_array() {
    return std::make_shared<KscArray>();
}

// -----------------------------------------------------------------------------
// Semantics (match TS behavior exactly — parity tests will verify)
// -----------------------------------------------------------------------------

/// Truthy judgment.
///   null   → false
///   false  → false
///   0      → false (also -0 and NaN in TS, matched here)
///   ""     → false
///   others → true
bool is_truthy(const Value& v) noexcept;

/// Strict equality (matches TS `===`).
///   - different types never equal
///   - numbers: NaN !== NaN, 0 === -0
///   - objects/arrays: reference equality
bool values_equal(const Value& a, const Value& b) noexcept;

/// Debug string (matches TS `String(v)` for primitives; objects/arrays get
/// a shallow JSON-like form). Used for error messages and DEBUG_LINE traces.
std::string to_debug_string(const Value& v);

} // namespace kaedevn::ksc
