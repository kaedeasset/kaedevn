import { describe, it, expect } from 'vitest';
import { EmitError } from '../src/emitter.js';
import { OpCode } from '../src/types/ir.js';
import type { IRModule, Instruction } from '../src/types/ir.js';
import { emitOnly as compile } from './helpers.js';

/** Get main function instructions */
function mainInstructions(mod: IRModule): Instruction[] {
  return mod.functions[mod.entryPoint].instructions;
}

/** Find all instructions with a given opcode */
function findOps(instructions: Instruction[], op: OpCode): Instruction[] {
  return instructions.filter(i => i.op === op);
}

/** Check if an opcode sequence exists in instructions */
function hasOpSequence(instructions: Instruction[], ops: OpCode[]): boolean {
  for (let i = 0; i <= instructions.length - ops.length; i++) {
    if (ops.every((op, j) => instructions[i + j].op === op)) return true;
  }
  return false;
}

// ========================================================
// Constant Pool
// ========================================================
describe('Constant Pool', () => {
  it('stores numeric constants', () => {
    const mod = compile('let x = 42;');
    expect(mod.constants).toContain(42);
  });

  it('stores string constants', () => {
    const mod = compile('let s = "hello";');
    expect(mod.constants).toContain('hello');
  });

  it('deduplicates identical constants', () => {
    const mod = compile('let a = 42; let b = 42;');
    const indices = mod.constants
      .map((v, i) => (v === 42 ? i : -1))
      .filter(i => i >= 0);
    expect(indices.length).toBe(1);
  });
});

// ========================================================
// Literal Expressions
// ========================================================
describe('Literal Expressions', () => {
  it('emits LOAD_CONST for number literal', () => {
    const mod = compile('let x = 99;');
    const instrs = mainInstructions(mod);
    const loads = findOps(instrs, OpCode.LOAD_CONST);
    expect(loads.length).toBeGreaterThan(0);
    // 99 should be in constant pool
    expect(mod.constants).toContain(99);
  });

  it('emits LOAD_CONST for string literal', () => {
    const mod = compile('let x = "world";');
    expect(mod.constants).toContain('world');
  });

  it('emits LOAD_CONST for boolean true', () => {
    const mod = compile('let x = true;');
    expect(mod.constants).toContain(true);
  });

  it('emits LOAD_CONST for boolean false', () => {
    const mod = compile('let x = false;');
    expect(mod.constants).toContain(false);
  });

  it('emits LOAD_CONST for null', () => {
    const mod = compile('let x = null;');
    expect(mod.constants).toContain(null);
  });

  it('emits LOAD_CONST for undefined', () => {
    const mod = compile('let x = undefined;');
    expect(mod.constants).toContain(undefined);
  });

  it('emits LOAD_CONST for template literal', () => {
    const mod = compile('let x = `hello`;');
    expect(mod.constants).toContain('hello');
  });
});

// ========================================================
// Binary Operators
// ========================================================
describe('Binary Operators', () => {
  it('emits ADD for +', () => {
    const mod = compile('let x = 1 + 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.ADD).length).toBe(1);
  });

  it('emits SUB for -', () => {
    const mod = compile('let x = 5 - 3;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.SUB).length).toBe(1);
  });

  it('emits MUL for *', () => {
    const mod = compile('let x = 2 * 3;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.MUL).length).toBe(1);
  });

  it('emits DIV for /', () => {
    const mod = compile('let x = 10 / 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.DIV).length).toBe(1);
  });

  it('emits MOD for %', () => {
    const mod = compile('let x = 10 % 3;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.MOD).length).toBe(1);
  });

  it('emits CMP_EQ for ==', () => {
    const mod = compile('let x = 1 == 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.CMP_EQ).length).toBe(1);
  });

  it('emits CMP_LT for <', () => {
    const mod = compile('let x = 1 < 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.CMP_LT).length).toBe(1);
  });
});

// ========================================================
// Unary Operators
// ========================================================
describe('Unary Operators', () => {
  it('emits NEG for unary -', () => {
    const mod = compile('let x = -5;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.NEG).length).toBe(1);
  });

  it('emits NOT for !', () => {
    const mod = compile('let x = !true;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.NOT).length).toBe(1);
  });
});

// ========================================================
// Variables
// ========================================================
describe('Variables', () => {
  it('emits STORE_VAR for let declaration', () => {
    const mod = compile('let x = 10;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.STORE_VAR).length).toBeGreaterThan(0);
  });

  it('emits STORE_VAR for const declaration', () => {
    const mod = compile('const y = 20;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.STORE_VAR).length).toBeGreaterThan(0);
  });

  it('emits LOAD_VAR for variable reference', () => {
    const mod = compile('let x = 10; let y = x;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.LOAD_VAR).length).toBeGreaterThan(0);
  });

  it('emits STORE_VAR for assignment', () => {
    const mod = compile('let x = 1; x = 2;');
    const instrs = mainInstructions(mod);
    // Two STORE_VARs: one for init, one for reassignment
    // Plus one from assignment expression value (DUP + STORE)
    const stores = findOps(instrs, OpCode.STORE_VAR);
    expect(stores.length).toBeGreaterThanOrEqual(2);
  });
});

// ========================================================
// Compound Assignment
// ========================================================
describe('Compound Assignment', () => {
  it('emits LOAD_VAR + ADD + STORE_VAR for +=', () => {
    const mod = compile('let x = 10; x += 5;');
    const instrs = mainInstructions(mod);
    expect(hasOpSequence(instrs, [OpCode.LOAD_VAR, OpCode.LOAD_CONST, OpCode.ADD])).toBe(true);
  });

  it('emits SUB for -=', () => {
    const mod = compile('let x = 10; x -= 3;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.SUB).length).toBe(1);
  });

  it('emits MOD for %=', () => {
    const mod = compile('let x = 10; x %= 3;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.MOD).length).toBe(1);
  });
});

// ========================================================
// Functions
// ========================================================
describe('Functions', () => {
  it('creates function entry in functions array', () => {
    const mod = compile('function add(a: number, b: number): number { return a + b; }');
    // Should have 2 functions: add + $main
    expect(mod.functions.length).toBe(2);
    expect(mod.functions[0].name).toBe('add');
    expect(mod.functions[0].paramCount).toBe(2);
  });

  it('emits CALL for function invocation', () => {
    const mod = compile(`
      function double(n: number): number { return n * 2; }
      let result = double(5);
    `);
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.CALL).length).toBe(1);
  });

  it('emits RET for return statement', () => {
    const mod = compile('function foo(): number { return 42; }');
    const funcInstrs = mod.functions[0].instructions;
    expect(findOps(funcInstrs, OpCode.RET).length).toBeGreaterThan(0);
  });

  it('handles function with arguments', () => {
    const mod = compile(`
      function greet(name: string): string { return name; }
      greet("world");
    `);
    const instrs = mainInstructions(mod);
    const calls = findOps(instrs, OpCode.CALL);
    expect(calls.length).toBe(1);
    expect(calls[0].operand).toBe(1); // 1 argument
  });

  it('supports forward references', () => {
    const mod = compile(`
      let x = foo();
      function foo(): number { return 42; }
    `);
    // foo is registered in Pass 1, called in Pass 2 (main)
    expect(mod.functions.find(f => f.name === 'foo')).toBeDefined();
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.CALL).length).toBe(1);
  });
});

// ========================================================
// Control Flow
// ========================================================
describe('Control Flow', () => {
  it('emits JMP_IF_FALSE for if statement', () => {
    const mod = compile('if (true) { let x = 1; }');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBe(1);
  });

  it('emits JMP for if-else', () => {
    const mod = compile('if (true) { let x = 1; } else { let x = 2; }');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBe(1);
    expect(findOps(instrs, OpCode.JMP).length).toBeGreaterThanOrEqual(1);
  });

  it('emits loop structure for while', () => {
    const mod = compile('let i = 0; while (i < 10) { i += 1; }');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBe(1);
    expect(findOps(instrs, OpCode.JMP).length).toBeGreaterThanOrEqual(1);
  });

  it('emits loop structure for for', () => {
    const mod = compile('for (let i = 0; i < 5; i += 1) { let x = i; }');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBe(1);
    expect(findOps(instrs, OpCode.JMP).length).toBeGreaterThanOrEqual(1);
  });

  it('emits JMP for break in while', () => {
    const mod = compile('while (true) { break; }');
    const instrs = mainInstructions(mod);
    // break generates a JMP that gets backpatched to loop end
    const jumps = findOps(instrs, OpCode.JMP);
    expect(jumps.length).toBeGreaterThanOrEqual(2); // break JMP + loop-back JMP
  });

  it('emits JMP for continue in while', () => {
    const mod = compile('let i = 0; while (i < 10) { i += 1; continue; }');
    const instrs = mainInstructions(mod);
    const jumps = findOps(instrs, OpCode.JMP);
    expect(jumps.length).toBeGreaterThanOrEqual(2); // continue JMP + loop-back JMP
  });

  it('emits SWITCH for switch statement', () => {
    const mod = compile(`
      let x = 1;
      switch (x) {
        case 1:
          let a = 10;
          break;
        case 2:
          let b = 20;
          break;
        default:
          let c = 30;
      }
    `);
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.SWITCH).length).toBe(1);
    expect(mod.switchTables.length).toBe(1);
    expect(mod.switchTables[0].cases.length).toBe(2);
    expect(mod.switchTables[0].defaultTarget).toBeGreaterThanOrEqual(0);
  });

  it('switch case table contains correct values', () => {
    const mod = compile(`
      let x = "a";
      switch (x) {
        case "a":
          break;
        case "b":
          break;
      }
    `);
    const table = mod.switchTables[0];
    expect(table.cases.map(c => c.value)).toEqual(['a', 'b']);
  });

  it('continue in for-loop jumps to update, not loop end', () => {
    const mod = compile(`
      for (let i = 0; i < 10; i += 1) {
        continue;
      }
    `);
    const instrs = mainInstructions(mod);
    const jumps = findOps(instrs, OpCode.JMP);
    // Find the continue JMP and the loop-back JMP
    // The continue JMP target should be the same as the update section offset,
    // NOT the loop end. The loop-back JMP goes to loopStart.
    // continue JMP target should equal the offset where i += 1 starts
    // loop-back JMP should jump back to condition check
    // They should differ from each other (continue != loop-back)
    expect(jumps.length).toBeGreaterThanOrEqual(2);
    // The continue should NOT jump to same target as break would
    // Verify the continue target is NOT the loop end (the instruction after the last JMP)
    const lastJmpIdx = instrs.length - 1 - [...instrs].reverse().findIndex(i => i.op === OpCode.JMP);
    const loopBackJmp = instrs[lastJmpIdx];
    // Find the continue JMP (the first JMP that isn't the loop-back)
    const continueJmpIdx = instrs.findIndex(i => i.op === OpCode.JMP);
    const continueJmp = instrs[continueJmpIdx];
    // continue target should NOT equal the final offset (loop end)
    expect(continueJmp.operand).not.toBe(instrs.length);
    // continue target should differ from loop-back target (loopStart vs update)
    expect(continueJmp.operand).not.toBe(loopBackJmp.operand);
  });

  it('break inside loop-inside-switch breaks the loop, not the switch', () => {
    const mod = compile(`
      let x = 1;
      switch (x) {
        case 1:
          let i = 0;
          while (i < 5) {
            break;
          }
          break;
      }
    `);
    const instrs = mainInstructions(mod);
    // There should be 2 different break JMPs with different targets:
    // - inner break: targets while-loop end
    // - outer break: targets switch end
    const allJmps = instrs
      .map((instr, idx) => ({ instr, idx }))
      .filter(({ instr }) => instr.op === OpCode.JMP);
    // At least 3 JMPs: while-break, while-loop-back, switch-break
    expect(allJmps.length).toBeGreaterThanOrEqual(3);
    // The while-break target should be different from switch-break target
    const whileBreak = allJmps[0]; // first JMP in while body
    const switchBreak = allJmps[allJmps.length - 1]; // last JMP before switch ends
    // They target different positions
    expect(whileBreak.instr.operand).not.toBe(switchBreak.instr.operand);
  });
});

// ========================================================
// Array & Object
// ========================================================
describe('Array & Object', () => {
  it('emits MAKE_ARRAY for array literal', () => {
    const mod = compile('let arr = [1, 2, 3];');
    const instrs = mainInstructions(mod);
    const makeArr = findOps(instrs, OpCode.MAKE_ARRAY);
    expect(makeArr.length).toBe(1);
    expect(makeArr[0].operand).toBe(3);
  });

  it('emits MAKE_OBJECT for object literal', () => {
    const mod = compile('let obj = { x: 1, y: 2 };');
    const instrs = mainInstructions(mod);
    const makeObj = findOps(instrs, OpCode.MAKE_OBJECT);
    expect(makeObj.length).toBe(1);
    expect(makeObj[0].operand).toBe(2);
  });

  it('emits GET_FIELD for member access', () => {
    const mod = compile('let obj = { x: 1 }; let v = obj.x;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.GET_FIELD).length).toBe(1);
  });

  it('emits GET_INDEX for index access', () => {
    const mod = compile('let arr = [1, 2]; let v = arr[0];');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.GET_INDEX).length).toBe(1);
  });
});

// ========================================================
// Ternary Operator
// ========================================================
describe('Ternary Operator', () => {
  it('emits JMP_IF_FALSE + JMP for ternary', () => {
    const mod = compile('let x = true ? 1 : 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBe(1);
    // JMP to skip alternate
    expect(findOps(instrs, OpCode.JMP).length).toBeGreaterThanOrEqual(1);
  });

  it('handles nested ternary', () => {
    const mod = compile('let x = true ? (false ? 1 : 2) : 3;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBe(2);
  });
});

// ========================================================
// HOST_CALL
// ========================================================
describe('HOST_CALL', () => {
  it('emits HOST_CALL for engine.playBgm()', () => {
    const mod = compile('engine.playBgm("forest");');
    const instrs = mainInstructions(mod);
    const hostCalls = findOps(instrs, OpCode.HOST_CALL);
    expect(hostCalls.length).toBe(1);
    // operand = name index of "playBgm" in constant pool
    const nameIdx = hostCalls[0].operand!;
    expect(mod.constants[nameIdx]).toBe('playBgm');
    // operand2 = arg count
    expect(hostCalls[0].operand2).toBe(1);
  });

  it('emits HOST_CALL with multiple args', () => {
    const mod = compile('engine.move("hero", 100, 200);');
    const instrs = mainInstructions(mod);
    const hostCalls = findOps(instrs, OpCode.HOST_CALL);
    expect(hostCalls.length).toBe(1);
    expect(hostCalls[0].operand2).toBe(3);
  });

  it('emits AWAIT after HOST_CALL for async engine methods', () => {
    const mod = compile('await engine.setBg("forest");');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(1);
    expect(findOps(instrs, OpCode.AWAIT).length).toBe(1);
    // AWAIT should come after HOST_CALL
    const hostIdx = instrs.findIndex(i => i.op === OpCode.HOST_CALL);
    const awaitIdx = instrs.findIndex(i => i.op === OpCode.AWAIT);
    expect(awaitIdx).toBeGreaterThan(hostIdx);
  });

  it('does not emit HOST_CALL for non-engine member calls', () => {
    const mod = compile('let obj = { x: 1 }; obj.doSomething();');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(0);
    expect(findOps(instrs, OpCode.CALL_METHOD).length).toBe(1);
  });
});

// ========================================================
// DialogueBlock
// ========================================================
describe('DialogueBlock', () => {
  it('emits HOST_CALL + AWAIT for narration (no speaker)', () => {
    const mod = compile('# "Hello world"');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(1);
    expect(findOps(instrs, OpCode.AWAIT).length).toBe(1);
    // showDialogue should be in constants
    expect(mod.constants).toContain('showDialogue');
    // Empty speaker
    expect(mod.constants).toContain('');
  });

  it('emits speaker name + lines for named dialogue', () => {
    const mod = compile('# hero "Nice to meet you"');
    const instrs = mainInstructions(mod);
    expect(mod.constants).toContain('hero');
    expect(mod.constants).toContain('Nice to meet you');
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(1);
  });

  it('emits HOST_CALL for inline @l command', () => {
    const mod = compile('#hero\n「おはよう！」@l\n#');
    const instrs = mainInstructions(mod);
    expect(mod.constants).toContain('showDialogue');
    expect(mod.constants).toContain('waitClick');
    expect(mod.constants).toContain('おはよう！');
    // showDialogue + waitClick
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(2);
  });

  it('emits HOST_CALL for inline @r command', () => {
    const mod = compile('#hero\nHello@r\n#');
    const instrs = mainInstructions(mod);
    expect(mod.constants).toContain('newLine');
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(2);
  });

  it('emits HOST_CALL for inline @p command', () => {
    const mod = compile('#narrator\nGoodbye@p\n#');
    const instrs = mainInstructions(mod);
    expect(mod.constants).toContain('pageClear');
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(2);
  });
});

// ========================================================
// Await
// ========================================================
describe('Await', () => {
  it('emits AWAIT opcode', () => {
    const mod = compile('await engine.setBg("forest");');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.AWAIT).length).toBe(1);
  });

  it('emits AWAIT for nested await expression', () => {
    const mod = compile('let x = await engine.playBgm("music");');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.AWAIT).length).toBe(1);
    expect(findOps(instrs, OpCode.STORE_VAR).length).toBeGreaterThan(0);
  });
});

// ========================================================
// Source Map
// ========================================================
describe('Source Map', () => {
  it('records source line mappings', () => {
    const mod = compile('let x = 1;\nlet y = 2;');
    expect(mod.sourceMap.length).toBeGreaterThan(0);
    // sourceMap entries are [offset, line]
    const lines = mod.sourceMap.map(([, line]) => line);
    expect(lines).toContain(1);
    expect(lines).toContain(2);
  });

  it('emits DEBUG_LINE instructions', () => {
    const mod = compile('let x = 1;\nlet y = 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.DEBUG_LINE).length).toBeGreaterThanOrEqual(2);
  });
});

// ========================================================
// Integration Tests
// ========================================================
describe('Integration', () => {
  it('compiles a simple KSC program with variables and arithmetic', () => {
    const mod = compile(`
      let hp = 100;
      let damage = 25;
      let remaining = hp - damage;
    `);
    expect(mod.functions.length).toBe(1); // only $main
    expect(mod.constants).toContain(100);
    expect(mod.constants).toContain(25);
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.SUB).length).toBe(1);
    expect(findOps(instrs, OpCode.STORE_VAR).length).toBeGreaterThanOrEqual(3);
  });

  it('compiles a function + call + if/else program', () => {
    const mod = compile(`
      function clamp(val: number, min: number, max: number): number {
        if (val < min) { return min; }
        if (val > max) { return max; }
        return val;
      }
      let result = clamp(150, 0, 100);
    `);
    expect(mod.functions.find(f => f.name === 'clamp')).toBeDefined();
    const clamp = mod.functions.find(f => f.name === 'clamp')!;
    expect(clamp.paramCount).toBe(3);
    expect(findOps(clamp.instructions, OpCode.JMP_IF_FALSE).length).toBe(2);
    expect(findOps(clamp.instructions, OpCode.RET).length).toBeGreaterThanOrEqual(3);
  });

  it('compiles a loop with break', () => {
    const mod = compile(`
      let sum = 0;
      let i = 0;
      while (i < 100) {
        if (sum > 50) { break; }
        sum += i;
        i += 1;
      }
    `);
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBeGreaterThanOrEqual(2);
    expect(findOps(instrs, OpCode.ADD).length).toBeGreaterThanOrEqual(2);
  });

  it('compiles a visual novel dialogue scene', () => {
    const mod = compile(`
      engine.setBg("classroom");
      engine.show("hero", "center");
      # hero "Hello everyone!"
      # "The classroom was quiet."
      engine.playBgm("school_theme");
    `);
    const instrs = mainInstructions(mod);
    // 3 HOST_CALLs from engine + 2 from dialogue blocks
    expect(findOps(instrs, OpCode.HOST_CALL).length).toBe(5);
    expect(findOps(instrs, OpCode.AWAIT).length).toBe(2); // from dialogue blocks
    expect(mod.constants).toContain('showDialogue');
    expect(mod.constants).toContain('hero');
    expect(mod.constants).toContain('classroom');
  });
});

// ========================================================
// Export / Import / TypeAlias (no-op)
// ========================================================
describe('Export / Import / TypeAlias', () => {
  it('handles export of variable declaration', () => {
    const mod = compile('export let score = 0;');
    expect(mod.constants).toContain(0);
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.STORE_VAR).length).toBeGreaterThan(0);
  });

  it('handles export of function declaration', () => {
    const mod = compile('export function foo(): void { return; }');
    expect(mod.functions.find(f => f.name === 'foo')).toBeDefined();
  });

  it('generates no code for type alias', () => {
    const mod = compile('type Score = number;');
    // Only main function instructions (DEBUG_LINE + implicit RET)
    const instrs = mainInstructions(mod);
    const meaningful = instrs.filter(i => i.op !== OpCode.DEBUG_LINE && i.op !== OpCode.LOAD_CONST && i.op !== OpCode.RET);
    expect(meaningful.length).toBe(0);
  });

  it('generates no code for import', () => {
    const mod = compile('import { foo } from "bar";');
    const instrs = mainInstructions(mod);
    const meaningful = instrs.filter(i => i.op !== OpCode.DEBUG_LINE && i.op !== OpCode.LOAD_CONST && i.op !== OpCode.RET);
    expect(meaningful.length).toBe(0);
  });
});

// ========================================================
// Logical Operators (short-circuit)
// ========================================================
describe('Logical Operators', () => {
  it('emits short-circuit for && (AND)', () => {
    const mod = compile('let x = true && false;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.DUP).length).toBeGreaterThan(0);
    expect(findOps(instrs, OpCode.JMP_IF_FALSE).length).toBeGreaterThan(0);
  });

  it('emits short-circuit for || (OR)', () => {
    const mod = compile('let x = false || true;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.DUP).length).toBeGreaterThan(0);
    expect(findOps(instrs, OpCode.NOT).length).toBeGreaterThan(0);
  });
});

// ========================================================
// Edge Cases
// ========================================================
describe('Edge Cases', () => {
  it('handles empty program', () => {
    const mod = compile('');
    expect(mod.functions.length).toBe(1); // just $main
    expect(mod.entryPoint).toBe(0);
  });

  it('handles variable without init', () => {
    const mod = compile('let x;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.STORE_VAR).length).toBeGreaterThan(0);
    // undefined should be in constant pool
    expect(mod.constants).toContain(undefined);
  });

  it('handles expression statement (result discarded)', () => {
    const mod = compile('1 + 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.ADD).length).toBe(1);
    expect(findOps(instrs, OpCode.POP).length).toBe(1);
  });

  it('handles nested blocks', () => {
    const mod = compile('{ { let x = 1; } }');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.STORE_VAR).length).toBeGreaterThan(0);
  });

  it('compiles comparison operators', () => {
    const mod = compile('let a = 1 != 2; let b = 1 <= 2; let c = 1 >= 2; let d = 1 > 2;');
    const instrs = mainInstructions(mod);
    expect(findOps(instrs, OpCode.CMP_NEQ).length).toBe(1);
    expect(findOps(instrs, OpCode.CMP_LTEQ).length).toBe(1);
    expect(findOps(instrs, OpCode.CMP_GTEQ).length).toBe(1);
    expect(findOps(instrs, OpCode.CMP_GT).length).toBe(1);
  });
});
