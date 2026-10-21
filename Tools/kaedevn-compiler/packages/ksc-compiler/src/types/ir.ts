/** KSC IR (Intermediate Representation) types */

import type { Value } from './value.js';

export enum OpCode {
  // Stack operations
  LOAD_CONST = 'LOAD_CONST',     // Push constant from pool
  LOAD_VAR = 'LOAD_VAR',         // Push variable value
  STORE_VAR = 'STORE_VAR',       // Pop and store to variable
  POP = 'POP',                   // Discard stack top
  DUP = 'DUP',                   // Duplicate stack top

  // Arithmetic
  ADD = 'ADD',
  SUB = 'SUB',
  MUL = 'MUL',
  DIV = 'DIV',
  MOD = 'MOD',
  NEG = 'NEG',                   // Unary negation

  // Comparison
  CMP_EQ = 'CMP_EQ',
  CMP_NEQ = 'CMP_NEQ',
  CMP_LT = 'CMP_LT',
  CMP_LTEQ = 'CMP_LTEQ',
  CMP_GT = 'CMP_GT',
  CMP_GTEQ = 'CMP_GTEQ',

  // Logical
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  // Control flow
  JMP = 'JMP',                   // Unconditional jump
  JMP_IF_FALSE = 'JMP_IF_FALSE', // Jump if stack top is falsy
  CALL = 'CALL',                 // Call function (operand = arg count)
  CALL_METHOD = 'CALL_METHOD',   // Call method on object (operand = arg count)
                                 // Stack: [obj, ...args], operand2 = method name const index
                                 // Binds this = obj, resolves method from obj's fields/proto
  RET = 'RET',                   // Return from function
  SWITCH = 'SWITCH',             // Switch dispatch (operand = case table index)

  // Object / Array
  MAKE_ARRAY = 'MAKE_ARRAY',     // Create array from N stack values
  MAKE_OBJECT = 'MAKE_OBJECT',   // Create object from N key-value pairs
  GET_FIELD = 'GET_FIELD',       // Get object field (operand = field name const index)
  SET_FIELD = 'SET_FIELD',       // Set object field
  GET_INDEX = 'GET_INDEX',       // Get array element by index
  SET_INDEX = 'SET_INDEX',       // Set array element by index (stack: [array, index, value])

  // Host API
  HOST_CALL = 'HOST_CALL',       // Call host function (operand = function name const index)

  // Async
  AWAIT = 'AWAIT',               // Await stack top Promise (VM yields)

  // Debug
  DEBUG_LINE = 'DEBUG_LINE',     // Source line mapping (operand = line number)
}

export interface Instruction {
  op: OpCode;
  operand?: number;   // Constant pool index, jump target, or count
  operand2?: number;  // Secondary operand (e.g., method name const index for CALL_METHOD)
}

export interface IRFunction {
  name: string;
  paramCount: number;
  paramNames: string[];  // Parameter names for CALL binding
  localCount: number;
  instructions: Instruction[];
  sourceFile?: string;  // Source file path for multi-file debugging
}

export interface SwitchCaseTable {
  cases: { value: unknown; target: number }[];
  defaultTarget: number;
}

export interface IRModule {
  constants: unknown[];           // Constant pool (numbers, strings, etc.)
  functions: IRFunction[];        // Function definitions
  entryPoint: number;            // Index into functions[] for main
  switchTables: SwitchCaseTable[]; // Switch case dispatch tables
  sourceMap: Array<[number, number]>; // IR instruction offset → source line (serializable)
}

/** VM execution result — returned by Host API calls */
export enum VMResultType {
  CONTINUE = 'CONTINUE',
  WAIT_TIME = 'WAIT_TIME',
  WAIT_INPUT = 'WAIT_INPUT',
  WAIT_EVENT = 'WAIT_EVENT',
  WAIT_BATTLE = 'WAIT_BATTLE',
}

export interface VMResult {
  type: VMResultType;
  value?: unknown;
}

/** Serializable VM state for save/load */
export interface VMState {
  pc: number;
  stack: Value[];
  callStack: { funcIndex: number; returnPc: number; locals: Record<string, Value> }[];
  globals: Record<string, Value>;
  flags: Record<string, Value>;
}
