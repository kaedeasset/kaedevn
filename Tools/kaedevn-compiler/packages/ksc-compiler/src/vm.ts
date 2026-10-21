/** KSC Stack-based Virtual Machine */

import {
  OpCode,
  type IRModule, type IRFunction, type SwitchCaseTable, type Instruction,
} from './types/ir.js';
import type { Value, KscObject, KscArray } from './types/value.js';
import { isKscObject, isKscArray, createKscObject, createKscArray } from './types/value.js';
import { STDLIB_NAMES } from './stdlib.js';

// ---- Public types ----

export interface HostAPI {
  call(name: string, args: Value[]): Value;
}

// ---- stdlib intrinsics ----
// Deterministic pure-math functions computed IN-VM (never delegated to the
// host) so the TS VM and the C++ VM (KscVM.cpp tryStdlib) stay byte-for-byte
// identical. Semantics are pinned here and MUST match the C++ implementation:
//   round  = floor(x + 0.5)        (half toward +Inf; NOT Math.round)
//   sign   = NaN→NaN, >0→1, <0→-1, else 0
//   min/max= NaN-propagating, plain < / > otherwise
//   sqrt   = IEEE-754 correctly-rounded (platform-identical)
const STDLIB_FN = new Set<string>(STDLIB_NAMES);

function stdlibNum(v: Value): number {
  return typeof v === 'number' ? v : NaN;
}

function callStdlib(name: string, args: Value[]): number {
  const a = stdlibNum(args[0]);
  switch (name) {
    case 'floor': return Math.floor(a);
    case 'ceil':  return Math.ceil(a);
    case 'trunc': return Math.trunc(a);
    case 'round': return Math.floor(a + 0.5);
    case 'abs':   return Math.abs(a);
    case 'sqrt':  return Math.sqrt(a);
    case 'sign':  return a !== a ? a : (a > 0 ? 1 : (a < 0 ? -1 : 0));
    case 'min': { const b = stdlibNum(args[1]); return a !== a ? a : (b !== b ? b : (a < b ? a : b)); }
    case 'max': { const b = stdlibNum(args[1]); return a !== a ? a : (b !== b ? b : (a > b ? a : b)); }
    case 'clamp': {
      const lo = stdlibNum(args[1]);
      const hi = stdlibNum(args[2]);
      return a !== a ? a : (a < lo ? lo : (a > hi ? hi : a));
    }
    default: return NaN;
  }
}

export class VMError extends Error {
  constructor(
    message: string,
    public sourceLine: number,
    public callTrace: string[],
  ) {
    super(message);
    this.name = 'VMError';
  }
}

export interface VMOptions {
  maxInstructions?: number; // default: 1_000_000
}

export type VMResultStatus = 'done' | 'await';

export interface VMResult {
  status: VMResultStatus;
  value: Value;
}

// ---- Internal types ----

interface CallFrame {
  funcIndex: number;
  pc: number;
  locals: Map<string, Value>;
}

// ---- VM ----

export class VM {
  // Module data
  private readonly module: IRModule;
  private readonly host: HostAPI;
  private readonly maxInstructions: number;

  // Runtime state
  private stack: Value[] = [];
  private callStack: CallFrame[] = [];
  private globals: Map<string, Value> = new Map();
  private functionMap: Map<string, number> = new Map();
  private currentLine = 0;
  private _done = false;
  private instructionCount = 0;

  constructor(module: IRModule, host: HostAPI, options?: VMOptions) {
    this.module = module;
    this.host = host;
    this.maxInstructions = options?.maxInstructions ?? 1_000_000;

    // Build function name → index map
    for (let i = 0; i < module.functions.length; i++) {
      this.functionMap.set(module.functions[i].name, i);
    }

    // Initialize call stack with entry point
    this.callStack.push({
      funcIndex: module.entryPoint,
      pc: 0,
      locals: new Map(),
    });
  }

  get done(): boolean {
    return this._done;
  }

  run(): VMResult {
    return this.execute();
  }

  resume(value: Value): VMResult {
    if (this._done) {
      throw new VMError('Cannot resume: VM is done', this.currentLine, this.buildCallTrace());
    }
    this.stack.push(value);
    return this.execute();
  }

  getState(): VMState {
    return {
      stack: [...this.stack],
      callStack: this.callStack.map(f => ({
        funcIndex: f.funcIndex,
        pc: f.pc,
        locals: Object.fromEntries(f.locals),
      })),
      globals: Object.fromEntries(this.globals),
      currentLine: this.currentLine,
      done: this._done,
    };
  }

  loadState(state: VMState): void {
    this.stack = [...state.stack];
    this.callStack = state.callStack.map(f => ({
      funcIndex: f.funcIndex,
      pc: f.pc,
      locals: new Map(Object.entries(f.locals)),
    }));
    this.globals = new Map(Object.entries(state.globals));
    this.currentLine = state.currentLine;
    this._done = state.done;
    this.instructionCount = 0;
  }

  // ---- Execution loop ----

  private execute(): VMResult {
    while (this.callStack.length > 0) {
      if (this.instructionCount >= this.maxInstructions) {
        this.error(`Instruction budget exceeded (${this.maxInstructions})`);
      }

      const frame = this.callStack[this.callStack.length - 1];
      const func = this.module.functions[frame.funcIndex];
      const instr = func.instructions[frame.pc];

      if (!instr) {
        // Ran off the end of the function — treat as implicit return null
        this.callStack.pop();
        this.stack.push(null);
        continue;
      }

      frame.pc++;
      this.instructionCount++;

      const result = this.dispatch(frame, instr);
      if (result) return result;
    }

    // Call stack empty — done
    this._done = true;
    return { status: 'done', value: null };
  }

  /** 命令を命令群の関数へ振り分ける。VM を止める命令（RET で main を抜ける・AWAIT）だけ結果を返す。 */
  private dispatch(frame: CallFrame, instr: Instruction): VMResult | null {
    switch (instr.op) {
      case OpCode.LOAD_CONST:
      case OpCode.LOAD_VAR:
      case OpCode.STORE_VAR:
      case OpCode.POP:
      case OpCode.DUP:
        this.execStack(frame, instr);
        return null;

      case OpCode.ADD:
      case OpCode.SUB:
      case OpCode.MUL:
      case OpCode.DIV:
      case OpCode.MOD:
      case OpCode.NEG:
        this.execArithmetic(instr.op);
        return null;

      case OpCode.CMP_EQ:
      case OpCode.CMP_NEQ:
      case OpCode.CMP_LT:
      case OpCode.CMP_LTEQ:
      case OpCode.CMP_GT:
      case OpCode.CMP_GTEQ:
      case OpCode.NOT:
      case OpCode.AND:
      case OpCode.OR:
        this.execCompareLogical(instr.op);
        return null;

      case OpCode.JMP:
      case OpCode.JMP_IF_FALSE:
      case OpCode.SWITCH:
        this.execJump(frame, instr);
        return null;

      case OpCode.CALL:
        this.execCall(instr);
        return null;

      case OpCode.RET:
        return this.execReturn();

      case OpCode.MAKE_ARRAY:
      case OpCode.MAKE_OBJECT:
      case OpCode.GET_FIELD:
      case OpCode.SET_FIELD:
      case OpCode.GET_INDEX:
      case OpCode.SET_INDEX:
        this.execObject(instr);
        return null;

      case OpCode.CALL_METHOD:
        this.execCallMethod(instr);
        return null;

      case OpCode.HOST_CALL:
        this.execHostCall(instr);
        return null;

      // ---- Async ----
      case OpCode.AWAIT: {
        const val = this.stack.pop()!;
        return { status: 'await', value: val };
      }

      // ---- Debug ----
      case OpCode.DEBUG_LINE:
        this.currentLine = instr.operand!;
        return null;

      default:
        this.error(`Unknown opcode: ${instr.op}`);
    }
  }

  // ---- Stack operations ----

  private execStack(frame: CallFrame, instr: Instruction): void {
    switch (instr.op) {
      case OpCode.LOAD_CONST:
        this.stack.push(this.module.constants[instr.operand!] as Value);
        break;

      case OpCode.LOAD_VAR:
        this.stack.push(this.loadVar(frame, this.module.constants[instr.operand!] as string));
        break;

      case OpCode.STORE_VAR: {
        const name = this.module.constants[instr.operand!] as string;
        const val = this.stack.pop()!;
        // Store in locals if the variable exists there or in the current frame,
        // otherwise in globals. For simplicity, always store in frame locals
        // unless it's already a global and NOT a local.
        if (this.globals.has(name) && !frame.locals.has(name)) {
          this.globals.set(name, val);
        } else {
          frame.locals.set(name, val);
        }
        break;
      }

      case OpCode.POP:
        this.stack.pop();
        break;

      case OpCode.DUP:
        this.stack.push(this.stack[this.stack.length - 1]);
        break;
    }
  }

  // ---- Arithmetic ----

  private execArithmetic(op: OpCode): void {
    if (op === OpCode.NEG) {
      const a = this.stack.pop()! as number;
      this.stack.push(-a);
      return;
    }
    if (op === OpCode.ADD) {
      const b = this.stack.pop()!;
      const a = this.stack.pop()!;
      if (typeof a === 'string' || typeof b === 'string') {
        this.stack.push(String(a) + String(b));
      } else {
        this.stack.push((a as number) + (b as number));
      }
      return;
    }
    const b = this.stack.pop()! as number;
    const a = this.stack.pop()! as number;
    switch (op) {
      case OpCode.SUB: this.stack.push(a - b); break;
      case OpCode.MUL: this.stack.push(a * b); break;
      case OpCode.DIV:
        if (b === 0) this.error('Division by zero');
        this.stack.push(a / b);
        break;
      case OpCode.MOD:
        if (b === 0) this.error('Division by zero');
        this.stack.push(a % b);
        break;
    }
  }

  // ---- Comparison / Logical ----

  private execCompareLogical(op: OpCode): void {
    if (op === OpCode.NOT) {
      const a = this.stack.pop()!;
      this.stack.push(!this.isTruthy(a));
      return;
    }
    const b = this.stack.pop()!;
    const a = this.stack.pop()!;
    switch (op) {
      case OpCode.CMP_EQ:   this.stack.push(a === b); break;
      case OpCode.CMP_NEQ:  this.stack.push(a !== b); break;
      case OpCode.CMP_LT:   this.stack.push((a as number) < (b as number)); break;
      case OpCode.CMP_LTEQ: this.stack.push((a as number) <= (b as number)); break;
      case OpCode.CMP_GT:   this.stack.push((a as number) > (b as number)); break;
      case OpCode.CMP_GTEQ: this.stack.push((a as number) >= (b as number)); break;
      case OpCode.AND:      this.stack.push(this.isTruthy(a) ? b : a); break;
      case OpCode.OR:       this.stack.push(this.isTruthy(a) ? a : b); break;
    }
  }

  // ---- Control flow ----

  private execJump(frame: CallFrame, instr: Instruction): void {
    switch (instr.op) {
      case OpCode.JMP:
        frame.pc = instr.operand!;
        break;

      case OpCode.JMP_IF_FALSE: {
        const cond = this.stack.pop()!;
        if (!this.isTruthy(cond)) {
          frame.pc = instr.operand!;
        }
        break;
      }

      case OpCode.SWITCH: {
        const table: SwitchCaseTable = this.module.switchTables[instr.operand!];
        const discriminant = this.stack.pop()!;
        let target = table.defaultTarget;
        for (const c of table.cases) {
          if (c.value === discriminant) {
            target = c.target;
            break;
          }
        }
        frame.pc = target;
        break;
      }
    }
  }

  private execCall(instr: Instruction): void {
    const argCount = instr.operand!;
    const funcIdx = this.stack.pop()! as number;
    const targetFunc = this.module.functions[funcIdx];
    if (!targetFunc) {
      this.error(`Invalid function index: ${funcIdx}`);
    }
    // Arguments were pushed in order: arg0, arg1, ..., argN-1
    const args = this.popArgs(argCount);
    this.pushFrame(funcIdx, targetFunc, args, null);
  }

  private execReturn(): VMResult | null {
    const retVal = this.stack.pop()!;
    this.callStack.pop();

    if (this.callStack.length === 0) {
      // Returning from main — VM is done
      this._done = true;
      return { status: 'done', value: retVal };
    }

    this.stack.push(retVal);
    return null;
  }

  // ---- Object / Array ----

  private execObject(instr: Instruction): void {
    switch (instr.op) {
      case OpCode.MAKE_ARRAY:
        this.stack.push(createKscArray(this.popArgs(instr.operand!)));
        break;

      case OpCode.MAKE_OBJECT: {
        const count = instr.operand!;
        const obj = createKscObject();
        // Key-value pairs were pushed in order: [key0, val0, key1, val1, ...]
        const pairs: [string, Value][] = [];
        for (let i = 0; i < count; i++) {
          const val = this.stack.pop()!;
          const key = this.stack.pop()! as string;
          pairs.unshift([key, val]);
        }
        for (const [key, val] of pairs) {
          obj.fields.set(key, val);
        }
        this.stack.push(obj);
        break;
      }

      case OpCode.GET_FIELD: {
        const fieldName = this.module.constants[instr.operand!] as string;
        const obj = this.stack.pop()!;
        if (isKscObject(obj)) {
          // Walk prototype chain (missing → null)
          this.stack.push(this.getField(obj, fieldName));
        } else if (isKscArray(obj) && fieldName === 'length') {
          this.stack.push(obj.elements.length);
        } else {
          this.stack.push(null);
        }
        break;
      }

      case OpCode.SET_FIELD: {
        const fieldName = this.module.constants[instr.operand!] as string;
        const val = this.stack.pop()!;
        const obj = this.stack.pop()!;
        if (isKscObject(obj)) {
          obj.fields.set(fieldName, val);
        }
        this.stack.push(val);
        break;
      }

      case OpCode.GET_INDEX: {
        const index = this.stack.pop()! as number;
        const arr = this.stack.pop()!;
        if (isKscArray(arr)) {
          this.stack.push(arr.elements[index] ?? null);
        } else if (isKscObject(arr)) {
          // Support obj[key] access
          this.stack.push(arr.fields.get(String(index)) ?? null);
        } else {
          this.stack.push(null);
        }
        break;
      }

      case OpCode.SET_INDEX: {
        const val = this.stack.pop()!;
        const index = this.stack.pop()! as number;
        const arr = this.stack.pop()!;
        if (isKscArray(arr)) {
          arr.elements[index] = val;
        }
        this.stack.push(val);
        break;
      }
    }
  }

  // ---- Method call ----

  private execCallMethod(instr: Instruction): void {
    const argCount = instr.operand!;
    const methodName = this.module.constants[instr.operand2!] as string;

    // Stack: [obj, arg0, arg1, ..., argN-1]
    const args = this.popArgs(argCount);
    const obj = this.stack.pop()!;

    // Built-in array methods
    if (isKscArray(obj)) {
      this.stack.push(this.callArrayMethod(obj, methodName, args));
      return;
    }

    // Object method: look up in fields
    if (isKscObject(obj)) {
      const method = this.getField(obj, methodName);
      if (typeof method === 'number') {
        // method is a function index
        const targetFunc = this.module.functions[method];
        if (!targetFunc) this.error(`Invalid method function index: ${method}`);
        this.pushFrame(method, targetFunc, args, obj);
        return;
      }
    }

    this.error(`Cannot call method '${methodName}' on value`);
  }

  // ---- Host API ----

  private execHostCall(instr: Instruction): void {
    const funcName = this.module.constants[instr.operand!] as string;
    const args = this.popArgs(instr.operand2!);
    // stdlib intrinsics are computed in-VM (host non-経由) for parity.
    if (STDLIB_FN.has(funcName)) {
      this.stack.push(callStdlib(funcName, args));
      return;
    }
    this.stack.push(this.host.call(funcName, args));
  }

  // ---- Helpers ----

  /** スタックの上から count 個を、積んだ順の配列にして取り出す。 */
  private popArgs(count: number): Value[] {
    const args: Value[] = [];
    for (let i = 0; i < count; i++) {
      args.unshift(this.stack.pop()!);
    }
    return args;
  }

  /** 新しいフレームを積み、引数を束ねる（thisObj があれば 'this' という局所変数にも入れる）。 */
  private pushFrame(funcIndex: number, targetFunc: IRFunction, args: Value[], thisObj: KscObject | null): void {
    const newFrame: CallFrame = {
      funcIndex,
      pc: 0,
      locals: new Map(),
    };
    if (thisObj) newFrame.locals.set('this', thisObj);
    for (let i = 0; i < targetFunc.paramNames.length; i++) {
      newFrame.locals.set(targetFunc.paramNames[i], i < args.length ? args[i] : null);
    }
    this.callStack.push(newFrame);
  }

  private loadVar(frame: CallFrame, name: string): Value {
    // 1. Current frame locals
    if (frame.locals.has(name)) {
      return frame.locals.get(name)!;
    }
    // 2. Globals
    if (this.globals.has(name)) {
      return this.globals.get(name)!;
    }
    // 3. Function name → index
    if (this.functionMap.has(name)) {
      return this.functionMap.get(name)!;
    }
    // 4. undefined (null in KSC)
    return null;
  }

  private isTruthy(value: Value): boolean {
    if (value === false) return false;
    if (value === 0) return false;
    if (value === '') return false;
    if (value === null) return false;
    return true;
  }

  private getField(obj: KscObject, name: string): Value {
    let current: KscObject | null = obj;
    while (current) {
      if (current.fields.has(name)) return current.fields.get(name)!;
      current = current.proto;
    }
    return null;
  }

  private callArrayMethod(arr: KscArray, method: string, args: Value[]): Value {
    switch (method) {
      case 'push':
        for (const a of args) arr.elements.push(a);
        return arr.elements.length;
      case 'pop':
        return arr.elements.pop() ?? null;
      case 'length':
        return arr.elements.length;
      default:
        this.error(`Unknown array method: ${method}`);
        return null; // unreachable
    }
  }

  private buildCallTrace(): string[] {
    return this.callStack.map(f => this.module.functions[f.funcIndex].name);
  }

  private error(message: string): never {
    throw new VMError(
      message,
      this.currentLine,
      this.buildCallTrace(),
    );
  }
}

// ---- Serializable state ----

export interface VMState {
  stack: Value[];
  callStack: { funcIndex: number; pc: number; locals: Record<string, Value> }[];
  globals: Record<string, Value>;
  currentLine: number;
  done: boolean;
}
