import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { emitIR } from '../src/emitter.js';
import { VM, VMError } from '../src/vm.js';
import type { HostAPI, VMResult } from '../src/vm.js';
import { isKscArray, isKscObject } from '../src/types/value.js';
import type { Value } from '../src/types/value.js';

// ---- Helpers ----

/** Null host — no host calls expected */
const nullHost: HostAPI = {
  call(name: string) {
    throw new Error(`Unexpected host call: ${name}`);
  },
};

/** Compile source → IRModule → VM and run to completion */
function runSource(source: string, host: HostAPI = nullHost): VMResult {
  const mod = emitIR(parse(tokenize(source)));
  const vm = new VM(mod, host);
  return vm.run();
}

/** Run and extract the final value (last expression stored in __result) */
function evalExpr(expr: string, host: HostAPI = nullHost): Value {
  const source = `let __result = ${expr};`;
  const mod = emitIR(parse(tokenize(source)));
  const vm = new VM(mod, host);
  vm.run();
  // The VM runs $main which stores to __result and returns null.
  // To get the variable value, we inspect the state.
  const state = vm.getState();
  // __result is in callStack[0].locals or globals
  // After main returns, callStack is empty. Use globals approach.
  // Actually, main already returned, so let's use a wrapper:
  return state.globals['__result'] ??
    (state.callStack.length > 0
      ? state.callStack[0].locals['__result']
      : null);
}

/** Better helper: wraps expression in host call to extract value */
function evalExprViaHost(expr: string): Value {
  let captured: Value = null;
  const host: HostAPI = {
    call(name: string, args: Value[]) {
      if (name === '__capture') captured = args[0];
      return null;
    },
  };
  const source = `engine.__capture(${expr});`;
  runSource(source, host);
  return captured;
}

/** Run program and capture all host calls */
function runWithCapture(source: string): { result: VMResult; calls: [string, Value[]][] } {
  const calls: [string, Value[]][] = [];
  const host: HostAPI = {
    call(name: string, args: Value[]) {
      calls.push([name, [...args]]);
      return null;
    },
  };
  const result = runSource(source, host);
  return { result, calls };
}

// ================================================================
// Literals & Constants
// ================================================================
describe('Literals & Constants', () => {
  it('evaluates number literal', () => {
    expect(evalExprViaHost('42')).toBe(42);
  });

  it('evaluates string literal', () => {
    expect(evalExprViaHost('"hello"')).toBe('hello');
  });

  it('evaluates boolean true', () => {
    expect(evalExprViaHost('true')).toBe(true);
  });

  it('evaluates boolean false', () => {
    expect(evalExprViaHost('false')).toBe(false);
  });

  it('evaluates null', () => {
    expect(evalExprViaHost('null')).toBe(null);
  });
});

// ================================================================
// Arithmetic
// ================================================================
describe('Arithmetic', () => {
  it('adds two numbers', () => {
    expect(evalExprViaHost('3 + 4')).toBe(7);
  });

  it('subtracts', () => {
    expect(evalExprViaHost('10 - 3')).toBe(7);
  });

  it('multiplies', () => {
    expect(evalExprViaHost('6 * 7')).toBe(42);
  });

  it('divides', () => {
    expect(evalExprViaHost('15 / 3')).toBe(5);
  });

  it('modulus', () => {
    expect(evalExprViaHost('10 % 3')).toBe(1);
  });

  it('negation', () => {
    expect(evalExprViaHost('-5')).toBe(-5);
  });

  it('throws on division by zero', () => {
    expect(() => runSource('engine.__capture(10 / 0);', {
      call() { return null; },
    })).toThrow('Division by zero');
  });
});

// ================================================================
// String operations
// ================================================================
describe('String operations', () => {
  it('concatenates strings', () => {
    expect(evalExprViaHost('"hello" + " world"')).toBe('hello world');
  });

  it('concatenates string and number', () => {
    expect(evalExprViaHost('"count: " + 42')).toBe('count: 42');
  });
});

// ================================================================
// Comparison
// ================================================================
describe('Comparison', () => {
  it('== true', () => {
    expect(evalExprViaHost('5 == 5')).toBe(true);
  });

  it('== false', () => {
    expect(evalExprViaHost('5 == 6')).toBe(false);
  });

  it('!=', () => {
    expect(evalExprViaHost('5 != 6')).toBe(true);
  });

  it('<', () => {
    expect(evalExprViaHost('3 < 5')).toBe(true);
  });

  it('<=', () => {
    expect(evalExprViaHost('5 <= 5')).toBe(true);
  });

  it('> and >=', () => {
    expect(evalExprViaHost('10 > 5')).toBe(true);
    expect(evalExprViaHost('5 >= 5')).toBe(true);
  });
});

// ================================================================
// Logical
// ================================================================
describe('Logical', () => {
  it('NOT true → false', () => {
    expect(evalExprViaHost('!true')).toBe(false);
  });

  it('NOT false → true', () => {
    expect(evalExprViaHost('!false')).toBe(true);
  });

  it('&& short-circuits on falsy', () => {
    // false && anything → false
    expect(evalExprViaHost('false && 42')).toBe(false);
  });

  it('|| short-circuits on truthy', () => {
    // 1 || anything → 1
    expect(evalExprViaHost('1 || 42')).toBe(1);
  });
});

// ================================================================
// Variables
// ================================================================
describe('Variables', () => {
  it('declares and reads variable', () => {
    const { calls } = runWithCapture(`
      let x = 10;
      engine.__capture(x);
    `);
    expect(calls[0][1][0]).toBe(10);
  });

  it('reassigns variable', () => {
    const { calls } = runWithCapture(`
      let x = 10;
      x = 20;
      engine.__capture(x);
    `);
    expect(calls[0][1][0]).toBe(20);
  });

  it('compound assignment +=', () => {
    const { calls } = runWithCapture(`
      let x = 10;
      x += 5;
      engine.__capture(x);
    `);
    expect(calls[0][1][0]).toBe(15);
  });

  it('multiple variables', () => {
    const { calls } = runWithCapture(`
      let a = 1;
      let b = 2;
      let c = a + b;
      engine.__capture(c);
    `);
    expect(calls[0][1][0]).toBe(3);
  });
});

// ================================================================
// If/Else
// ================================================================
describe('If/Else', () => {
  it('takes true branch', () => {
    const { calls } = runWithCapture(`
      if (true) {
        engine.__capture(1);
      }
    `);
    expect(calls[0][1][0]).toBe(1);
  });

  it('takes false branch (no else)', () => {
    const { calls } = runWithCapture(`
      if (false) {
        engine.__capture(1);
      }
    `);
    expect(calls).toHaveLength(0);
  });

  it('takes else branch', () => {
    const { calls } = runWithCapture(`
      if (false) {
        engine.__capture(1);
      } else {
        engine.__capture(2);
      }
    `);
    expect(calls[0][1][0]).toBe(2);
  });

  it('else-if chain', () => {
    const { calls } = runWithCapture(`
      let x = 2;
      if (x == 1) {
        engine.__capture(10);
      } else if (x == 2) {
        engine.__capture(20);
      } else {
        engine.__capture(30);
      }
    `);
    expect(calls[0][1][0]).toBe(20);
  });
});

// ================================================================
// While loops
// ================================================================
describe('While loops', () => {
  it('basic while loop', () => {
    const { calls } = runWithCapture(`
      let i = 0;
      let sum = 0;
      while (i < 5) {
        sum += i;
        i += 1;
      }
      engine.__capture(sum);
    `);
    expect(calls[0][1][0]).toBe(10); // 0+1+2+3+4
  });

  it('while with break', () => {
    const { calls } = runWithCapture(`
      let i = 0;
      while (true) {
        if (i == 3) { break; }
        i += 1;
      }
      engine.__capture(i);
    `);
    expect(calls[0][1][0]).toBe(3);
  });

  it('while with continue', () => {
    const { calls } = runWithCapture(`
      let i = 0;
      let sum = 0;
      while (i < 5) {
        i += 1;
        if (i == 3) { continue; }
        sum += i;
      }
      engine.__capture(sum);
    `);
    // sum = 1+2+4+5 = 12 (skips 3)
    expect(calls[0][1][0]).toBe(12);
  });

  it('while false condition never executes', () => {
    const { calls } = runWithCapture(`
      let x = 0;
      while (false) {
        x = 99;
      }
      engine.__capture(x);
    `);
    expect(calls[0][1][0]).toBe(0);
  });
});

// ================================================================
// For loops
// ================================================================
describe('For loops', () => {
  it('basic for loop (sum)', () => {
    const { calls } = runWithCapture(`
      let sum = 0;
      for (let i = 1; i <= 10; i += 1) {
        sum += i;
      }
      engine.__capture(sum);
    `);
    expect(calls[0][1][0]).toBe(55);
  });

  it('for with break', () => {
    const { calls } = runWithCapture(`
      let last = 0;
      for (let i = 0; i < 100; i += 1) {
        if (i == 5) { break; }
        last = i;
      }
      engine.__capture(last);
    `);
    expect(calls[0][1][0]).toBe(4);
  });

  it('for with continue', () => {
    const { calls } = runWithCapture(`
      let sum = 0;
      for (let i = 0; i < 5; i += 1) {
        if (i == 2) { continue; }
        sum += i;
      }
      engine.__capture(sum);
    `);
    // 0+1+3+4 = 8
    expect(calls[0][1][0]).toBe(8);
  });

  it('nested for loops', () => {
    const { calls } = runWithCapture(`
      let count = 0;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          count += 1;
        }
      }
      engine.__capture(count);
    `);
    expect(calls[0][1][0]).toBe(9);
  });
});

// ================================================================
// Switch
// ================================================================
describe('Switch', () => {
  it('matches correct case', () => {
    const { calls } = runWithCapture(`
      let x = 2;
      let result = 0;
      switch (x) {
        case 1:
          result = 10;
          break;
        case 2:
          result = 20;
          break;
        case 3:
          result = 30;
          break;
      }
      engine.__capture(result);
    `);
    expect(calls[0][1][0]).toBe(20);
  });

  it('falls through to default', () => {
    const { calls } = runWithCapture(`
      let x = 99;
      let result = 0;
      switch (x) {
        case 1:
          result = 10;
          break;
        default:
          result = -1;
          break;
      }
      engine.__capture(result);
    `);
    expect(calls[0][1][0]).toBe(-1);
  });

  it('break exits switch', () => {
    const { calls } = runWithCapture(`
      let x = 1;
      let result = 0;
      switch (x) {
        case 1:
          result = 10;
          break;
        case 2:
          result = 20;
          break;
      }
      engine.__capture(result);
    `);
    expect(calls[0][1][0]).toBe(10);
  });
});

// ================================================================
// Functions
// ================================================================
describe('Functions', () => {
  it('basic function call', () => {
    const { calls } = runWithCapture(`
      function greet(): string {
        return "hi";
      }
      engine.__capture(greet());
    `);
    expect(calls[0][1][0]).toBe('hi');
  });

  it('function with arguments', () => {
    const { calls } = runWithCapture(`
      function add(a: number, b: number): number {
        return a + b;
      }
      engine.__capture(add(3, 4));
    `);
    expect(calls[0][1][0]).toBe(7);
  });

  it('recursive function (factorial)', () => {
    const { calls } = runWithCapture(`
      function fact(n: number): number {
        if (n <= 1) { return 1; }
        return n * fact(n - 1);
      }
      engine.__capture(fact(5));
    `);
    expect(calls[0][1][0]).toBe(120);
  });

  it('forward reference', () => {
    const { calls } = runWithCapture(`
      engine.__capture(double(5));
      function double(x: number): number {
        return x * 2;
      }
    `);
    expect(calls[0][1][0]).toBe(10);
  });

  it('nested function calls', () => {
    const { calls } = runWithCapture(`
      function square(x: number): number {
        return x * x;
      }
      function sumOfSquares(a: number, b: number): number {
        return square(a) + square(b);
      }
      engine.__capture(sumOfSquares(3, 4));
    `);
    expect(calls[0][1][0]).toBe(25);
  });

  it('function returns null implicitly', () => {
    const { calls } = runWithCapture(`
      function doNothing(): void {
      }
      engine.__capture(doNothing());
    `);
    expect(calls[0][1][0]).toBe(null);
  });
});

// ================================================================
// Arrays & Objects
// ================================================================
describe('Arrays & Objects', () => {
  it('creates and accesses array', () => {
    const { calls } = runWithCapture(`
      let arr = [10, 20, 30];
      engine.__capture(arr[1]);
    `);
    expect(calls[0][1][0]).toBe(20);
  });

  it('sets array element', () => {
    const { calls } = runWithCapture(`
      let arr = [1, 2, 3];
      arr[1] = 99;
      engine.__capture(arr[1]);
    `);
    expect(calls[0][1][0]).toBe(99);
  });

  it('creates and accesses object', () => {
    const { calls } = runWithCapture(`
      let obj = { name: "Alice", age: 30 };
      engine.__capture(obj.name);
    `);
    expect(calls[0][1][0]).toBe('Alice');
  });

  it('sets object field', () => {
    const { calls } = runWithCapture(`
      let obj = { x: 1 };
      obj.x = 42;
      engine.__capture(obj.x);
    `);
    expect(calls[0][1][0]).toBe(42);
  });
});

// ================================================================
// HOST_CALL
// ================================================================
describe('HOST_CALL', () => {
  it('calls host function', () => {
    const { calls } = runWithCapture(`
      engine.showText("hello");
    `);
    expect(calls[0]).toEqual(['showText', ['hello']]);
  });

  it('uses host return value', () => {
    let captured: Value = null;
    const host: HostAPI = {
      call(name: string, args: Value[]) {
        if (name === 'getHP') return 100;
        if (name === '__capture') captured = args[0];
        return null;
      },
    };
    runSource(`
      let hp = engine.getHP();
      engine.__capture(hp);
    `, host);
    expect(captured).toBe(100);
  });

  it('AWAIT pauses and resumes', () => {
    const host: HostAPI = {
      call(name: string, args: Value[]) {
        if (name === '__capture') return args[0];
        return null;
      },
    };
    const mod = emitIR(parse(tokenize(`
      let x = await engine.getInput();
      engine.__capture(x);
    `)));
    const vm = new VM(mod, host);
    const r1 = vm.run();
    expect(r1.status).toBe('await');
    expect(vm.done).toBe(false);

    const r2 = vm.resume("user_choice");
    // VM continues, captures the value
    expect(r2.status).toBe('done');
  });
});

// ================================================================
// Error handling
// ================================================================
describe('Error handling', () => {
  it('includes source line in VMError', () => {
    try {
      runSource(`let x = 10 / 0;`);
      expect.fail('Should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(VMError);
      expect((e as VMError).sourceLine).toBeGreaterThan(0);
    }
  });

  it('includes call trace in VMError', () => {
    try {
      runSource(`
        function boom(): number {
          return 1 / 0;
        }
        boom();
      `);
      expect.fail('Should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(VMError);
      const trace = (e as VMError).callTrace;
      expect(trace).toContain('boom');
    }
  });

  it('throws on instruction budget exceeded', () => {
    const mod = emitIR(parse(tokenize(`
      while (true) {
        let x = 1;
      }
    `)));
    const vm = new VM(mod, nullHost, { maxInstructions: 100 });
    expect(() => vm.run()).toThrow('Instruction budget exceeded');
  });
});

// ================================================================
// Save / Load
// ================================================================
describe('Save / Load', () => {
  it('captures state snapshot', () => {
    const host: HostAPI = {
      call() { return null; },
    };
    const mod = emitIR(parse(tokenize(`
      let x = 42;
      await engine.pause();
    `)));
    const vm = new VM(mod, host);
    vm.run(); // pauses at AWAIT

    const state = vm.getState();
    expect(state.done).toBe(false);
    // x should be in the call frame locals
    const locals = state.callStack[0]?.locals ?? {};
    expect(locals['x']).toBe(42);
  });

  it('restores state and continues execution', () => {
    let captured: Value = null;
    const host: HostAPI = {
      call(name: string, args: Value[]) {
        if (name === '__capture') captured = args[0];
        return null;
      },
    };

    const source = `
      let x = 10;
      await engine.wait();
      x += 5;
      engine.__capture(x);
    `;
    const mod = emitIR(parse(tokenize(source)));

    // Run until AWAIT
    const vm1 = new VM(mod, host);
    vm1.run();
    const state = vm1.getState();

    // Create new VM, load state, resume
    const vm2 = new VM(mod, host);
    vm2.loadState(state);
    vm2.resume(null);

    expect(captured).toBe(15);
  });
});

// ================================================================
// Integration tests
// ================================================================
describe('Integration', () => {
  it('VN dialogue simulation', () => {
    const { calls } = runWithCapture(`
      let speaker = "Alice";
      engine.showText(speaker + ": Hello!");
      engine.showText(speaker + ": How are you?");
    `);
    expect(calls).toHaveLength(2);
    expect(calls[0][1][0]).toBe('Alice: Hello!');
    expect(calls[1][1][0]).toBe('Alice: How are you?');
  });

  it('HP calculation', () => {
    const { calls } = runWithCapture(`
      let baseHP = 100;
      let level = 5;
      let hp = baseHP + level * 10;
      engine.__capture(hp);
    `);
    expect(calls[0][1][0]).toBe(150);
  });

  it('loop aggregation', () => {
    const { calls } = runWithCapture(`
      let total = 0;
      let prices = [100, 200, 350, 50];
      for (let i = 0; i < 4; i += 1) {
        total += prices[i];
      }
      engine.__capture(total);
    `);
    expect(calls[0][1][0]).toBe(700);
  });

  it('function + control flow combined', () => {
    const { calls } = runWithCapture(`
      function clamp(val: number, min: number, max: number): number {
        if (val < min) { return min; }
        if (val > max) { return max; }
        return val;
      }

      engine.__capture(clamp(-5, 0, 100));
      engine.__capture(clamp(50, 0, 100));
      engine.__capture(clamp(200, 0, 100));
    `);
    expect(calls[0][1][0]).toBe(0);
    expect(calls[1][1][0]).toBe(50);
    expect(calls[2][1][0]).toBe(100);
  });

  it('array push method', () => {
    const { calls } = runWithCapture(`
      let arr = [1, 2];
      arr.push(3);
      engine.__capture(arr[2]);
    `);
    expect(calls[0][1][0]).toBe(3);
  });

  it('object nested access', () => {
    const { calls } = runWithCapture(`
      let player = { name: "Hero", stats: { hp: 100, mp: 50 } };
      engine.__capture(player.stats.hp);
    `);
    expect(calls[0][1][0]).toBe(100);
  });

  it('ternary expression', () => {
    const { calls } = runWithCapture(`
      let x = 10;
      let result = x > 5 ? "big" : "small";
      engine.__capture(result);
    `);
    expect(calls[0][1][0]).toBe('big');
  });

  it('complex: fibonacci via loop', () => {
    const { calls } = runWithCapture(`
      function fib(n: number): number {
        let a = 0;
        let b = 1;
        for (let i = 0; i < n; i += 1) {
          let tmp = b;
          b = a + b;
          a = tmp;
        }
        return a;
      }
      engine.__capture(fib(10));
    `);
    expect(calls[0][1][0]).toBe(55);
  });
});
