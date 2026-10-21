// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// Host function bridge for KSC.
//
// The VM calls `HostAPI::call(name, args)` whenever it executes a HOST_CALL
// opcode. The host returns either a synchronous result (`CONTINUE`) or a
// WAIT_* status that yields the VM until `KscVM::resume(value)` is called.

#pragma once

#include <string>
#include <vector>

#include "IR.hpp"
#include "Value.hpp"

namespace kaedevn::ksc {

class HostAPI {
public:
    virtual ~HostAPI() = default;

    /// Synchronous host call.
    /// - `CONTINUE`  : `value` is the return value (pushed onto VM stack).
    /// - `WAIT_*`    : VM yields; caller invokes `KscVM::resume(result)` later.
    virtual VMResult call(const std::string&         name,
                          const std::vector<Value>& args) = 0;
};

} // namespace kaedevn::ksc
