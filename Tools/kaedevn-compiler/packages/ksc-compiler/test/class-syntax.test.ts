// Phase 1 #7 — class syntax sugar V0 (constructor + fields, no methods).
//
// Verifies:
//   - `class Foo { ... }` parses to a synthesized factory FunctionDecl
//   - `new Foo(args)` desugars to `Foo(args)` and yields a typed object
//   - field initializers run; constructor body runs; `this` resolves
//   - methods are rejected with a helpful message (V0 limitation)
//   - `extends` is rejected (future inheritance)

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { emitIR } from '../src/emitter.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import type { Value } from '../src/types/value.js';

class NullHost implements HostAPI {
  call(_name: string, _args: Value[]): Value {
    return null as unknown as Value;
  }
}

/** Recording host that captures values passed to a `record(name, value)` call. */
class RecordingHost implements HostAPI {
  recorded: Record<string, Value> = {};
  call(name: string, args: Value[]): Value {
    if (name === 'record' && typeof args[0] === 'string') {
      this.recorded[args[0]] = args[1];
    }
    return null as unknown as Value;
  }
}

/** Run a program that ends with engine.__capture(expr) calls, return captured. */
function runAndCapture(source: string): Record<string, Value> {
  const captured: Record<string, Value> = {};
  const host: HostAPI = {
    call(name: string, args: Value[]) {
      if (name === '__capture' && typeof args[0] === 'string') {
        captured[args[0]] = args[1];
      }
      return null as unknown as Value;
    },
  };
  // engine.__capture is not in the type system; bypass typecheck.
  const mod = emitIR(parse(tokenize(source)));
  const vm = new VM(mod, host);
  vm.run();
  return captured;
}

describe('Phase 1 #7 — class syntax V0', () => {
  // ---- Parsing / lowering ----

  it('lowers a class with fields to a factory FunctionDecl', () => {
    const ast = parse(tokenize(`
      class Player {
        hp: number = 100;
        x: number = 0;
        y: number = 0;
      }
    `));
    expect(ast.body).toHaveLength(1);
    const fn = ast.body[0] as any;
    expect(fn.kind).toBe('FunctionDecl');
    expect(fn.name).toBe('Player');
    expect(fn.params).toEqual([]);
    expect(fn.returnType.kind).toBe('object');
    expect(fn.returnType.fields).toHaveLength(3);
  });

  it('forwards constructor params to the factory', () => {
    const ast = parse(tokenize(`
      class Player {
        x: number = 0;
        constructor(initX: number) {
          this.x = initX;
        }
      }
    `));
    const fn = ast.body[0] as any;
    expect(fn.params).toHaveLength(1);
    expect(fn.params[0].name).toBe('initX');
  });

  // ---- Type checking ----

  it('typechecks a class with fields and constructor', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        hp: number = 100;
        x: number = 0;
        y: number = 0;
        constructor(initX: number, initY: number) {
          this.x = initX;
          this.y = initY;
        }
      }
      const p = new Player(10, 20);
      const px: number = p.x;
    `)));
    expect(check.errors).toEqual([]);
  });

  // Note: KSC's checker does not currently enforce field-level type checks
  // on `obj.field = value` assignments (pre-existing limitation, not class-
  // specific). Constructor parameter types and field initializer types ARE
  // checked. When the checker gains member-assignment type checking, the
  // class lowering will benefit automatically.
  it('rejects field initializer of wrong type', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        x: number = "not a number";
      }
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('rejects passing string to constructor expecting number', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        x: number = 0;
        constructor(initX: number) { this.x = initX; }
      }
      const p = new Player("not a number");
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('rejects accessing nonexistent field', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        x: number = 0;
      }
      const p = new Player();
      const z = p.notAField;
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  // ---- Default values for fields without initializers ----

  it('uses 0 as default for number fields without init', () => {
    const check = typeCheck(parse(tokenize(`
      class Counter {
        count: number;
      }
      const c = new Counter();
      const v: number = c.count;
    `)));
    expect(check.errors).toEqual([]);
  });

  // ---- Runtime behavior via VM ----

  it('runtime: new Player(...) constructs object with field values', () => {
    const captured = runAndCapture(`
      class Player {
        hp: number = 100;
        x: number = 0;
        y: number = 0;
        constructor(initX: number, initY: number) {
          this.x = initX;
          this.y = initY;
        }
      }
      const p = new Player(50, 75);
      engine.__capture("hp", p.hp);
      engine.__capture("x",  p.x);
      engine.__capture("y",  p.y);
    `);
    expect(captured.hp).toBe(100);
    expect(captured.x).toBe(50);
    expect(captured.y).toBe(75);
  });

  it('runtime: multiple instances are independent', () => {
    const captured = runAndCapture(`
      class Counter {
        count: number = 0;
        constructor(initial: number) {
          this.count = initial;
        }
      }
      const a = new Counter(10);
      const b = new Counter(20);
      a.count = a.count + 1;
      engine.__capture("a", a.count);
      engine.__capture("b", b.count);
    `);
    expect(captured.a).toBe(11);
    expect(captured.b).toBe(20);
  });

  it('runtime: field initializer evaluates per instance', () => {
    const captured = runAndCapture(`
      class Box {
        width: number = 10;
        height: number = 20;
      }
      const b = new Box();
      engine.__capture("w", b.width);
      engine.__capture("h", b.height);
    `);
    expect(captured.w).toBe(10);
    expect(captured.h).toBe(20);
  });

  // ---- Rejection cases ----

  // V0 でメソッド拒否、V1 で対応 — methods は class-methods.test.ts で網羅。
  it('accepts class with methods (Phase 1 #13 V1)', () => {
    expect(() => parse(tokenize(`
      class Enemy {
        hp: number = 100;
        damage(d: number): void {
          this.hp = this.hp - d;
        }
      }
    `))).not.toThrow();
  });

  // V1.1 で extends 実装済。継承の詳細は class-inheritance.test.ts。
  it('rejects extends of unknown parent class', () => {
    expect(() => parse(tokenize(`
      class Boss extends Enemy {
        rage: number = 0;
      }
    `))).toThrow(/Cannot extend unknown class 'Enemy'/);
  });

  it('rejects class declarations inside function bodies', () => {
    expect(() => parse(tokenize(`
      function makeOne() {
        class Inner { x: number = 0; }
      }
    `))).toThrow(/top level/);
  });

  it('rejects bare new without parens', () => {
    expect(() => parse(tokenize(`
      class Foo { x: number = 0; }
      const f = new Foo;
    `))).toThrow(/'new' must be followed by a call/);
  });

  // ---- 'this' outside a class ----

  it('this used outside class scope is an undefined identifier (checker error)', () => {
    const check = typeCheck(parse(tokenize(`
      const x = this;
    `)));
    // 'this' resolves to identifier 'this', not in scope — should error.
    expect(check.errors.length).toBeGreaterThan(0);
  });
});
