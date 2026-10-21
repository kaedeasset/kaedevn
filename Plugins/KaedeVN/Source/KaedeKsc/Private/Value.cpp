// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "kaedevn/ksc/Value.hpp"

#include <cmath>
#include <cstdio>
#include <sstream>

namespace kaedevn::ksc {

bool is_truthy(const Value& v) noexcept {
    // Match TS vm.ts `isTruthy` *exactly*:
    //   null → false, false → false, 0 (or -0) → false, "" → false, else true.
    // Note: NaN is TRUTHY here because `NaN !== 0`. This differs from JS
    // `if(NaN)` semantics — the KSC VM treats NaN as truthy by design.
    if (is_null(v)) return false;
    if (const auto* b = std::get_if<bool>(&v))   return *b;
    if (const auto* d = std::get_if<double>(&v)) return *d != 0.0;  // NaN != 0 → true
    if (const auto* s = std::get_if<std::string>(&v)) return !s->empty();
    // Objects and arrays are always truthy.
    return true;
}

bool values_equal(const Value& a, const Value& b) noexcept {
    // Different variant alternatives → never equal (TS === semantics).
    if (a.index() != b.index()) return false;

    // Both null.
    if (is_null(a)) return true;

    if (is_bool(a)) {
        return std::get<bool>(a) == std::get<bool>(b);
    }
    if (is_number(a)) {
        const double x = std::get<double>(a);
        const double y = std::get<double>(b);
        // NaN !== NaN (TS). 0 === -0 naturally since ==.
        if (std::isnan(x) || std::isnan(y)) return false;
        return x == y;
    }
    if (is_string(a)) {
        return std::get<std::string>(a) == std::get<std::string>(b);
    }
    if (is_object(a)) {
        return std::get<ObjectPtr>(a).get() == std::get<ObjectPtr>(b).get();
    }
    if (is_array(a)) {
        return std::get<ArrayPtr>(a).get() == std::get<ArrayPtr>(b).get();
    }
    return false;
}

static void number_to_string(double d, std::string& out) {
    // Match TS `String(n)`:
    //   - integers print without decimal (1 → "1")
    //   - NaN → "NaN", Infinity → "Infinity"
    if (std::isnan(d)) {
        out += "NaN";
        return;
    }
    if (std::isinf(d)) {
        out += d < 0 ? "-Infinity" : "Infinity";
        return;
    }
    if (d == static_cast<double>(static_cast<long long>(d)) &&
        d >= -9e15 && d <= 9e15) {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(d));
        out += buf;
        return;
    }
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.17g", d);
    out += buf;
}

static void append_debug(const Value& v, std::string& out, int depth) {
    if (depth > 3) { out += "…"; return; }
    if (is_null(v)) { out += "null"; return; }
    if (const auto* b = std::get_if<bool>(&v))   { out += *b ? "true" : "false"; return; }
    if (const auto* d = std::get_if<double>(&v)) { number_to_string(*d, out); return; }
    if (const auto* s = std::get_if<std::string>(&v)) {
        out += '"';
        out += *s;
        out += '"';
        return;
    }
    if (is_object(v)) {
        const auto& obj = *std::get<ObjectPtr>(v);
        out += '{';
        bool first = true;
        for (const auto& [k, val] : obj.fields) {
            if (!first) out += ", ";
            first = false;
            out += k;
            out += ": ";
            append_debug(val, out, depth + 1);
        }
        out += '}';
        return;
    }
    if (is_array(v)) {
        const auto& arr = *std::get<ArrayPtr>(v);
        out += '[';
        for (std::size_t i = 0; i < arr.elements.size(); ++i) {
            if (i) out += ", ";
            append_debug(arr.elements[i], out, depth + 1);
        }
        out += ']';
        return;
    }
    out += "?";
}

std::string to_debug_string(const Value& v) {
    std::string s;
    s.reserve(32);
    append_debug(v, s, 0);
    return s;
}

} // namespace kaedevn::ksc
