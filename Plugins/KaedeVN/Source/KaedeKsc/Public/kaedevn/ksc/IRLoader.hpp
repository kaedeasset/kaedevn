// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// Deserializes IRModule from the JSON produced by Tools/kaedevn-compiler/packages/ksc-compiler.
//
// The JSON shape is defined by ir.ts — if that file changes, this loader
// must be updated to match, and parity tests re-run.
//
// Two wire formats are supported:
//   - JSON text (default, produced by `emitIR` in TS)
//   - CBOR bytes (compressed, produced by `encode_ir_to_cbor` below).
//     CBOR is ~30-50% smaller than JSON for typical IRs and parses faster
//     on constrained platforms. The IR structure is identical; only the
//     wire encoding changes.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "IR.hpp"

namespace kaedevn::ksc {

struct LoadResult {
    bool        ok = false;
    std::string errorMessage;
    IRModule    module;
};

/// Parse IR.json text. On failure, `ok = false` and `errorMessage` is
/// populated with a human-readable reason. Never throws (even when the
/// package is built with exceptions enabled).
LoadResult load_ir_from_json(const std::string& jsonText) noexcept;

/// Parse IR from CBOR bytes. Same semantics as `load_ir_from_json`.
LoadResult load_ir_from_cbor(const std::uint8_t* data,
                              std::size_t size) noexcept;

/// Auto-detect format by the first byte and dispatch to the appropriate
/// loader. JSON starts with `{`, `[`, or whitespace; CBOR major types
/// fall outside that range.
LoadResult load_ir_auto(const std::uint8_t* data,
                         std::size_t size) noexcept;

/// Convert IR.json text to CBOR bytes. Round-trip safe with
/// `load_ir_from_cbor`. Returns an empty vector on failure.
std::vector<std::uint8_t> encode_ir_to_cbor(const std::string& jsonText) noexcept;

} // namespace kaedevn::ksc
