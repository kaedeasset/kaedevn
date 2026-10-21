// Phase 1 #13 V1 — class methods + function-typed annotations.
//
// 検証:
//   - 関数型 annotation `(d: number) => void` がパースできる
//   - class { method(args): T { ... } } がパースできる
//   - method 内の `this.field` が型チェック通る
//   - new C().method() が動作（VM の CALL_METHOD で this 自動 bind）
//   - method 経由の状態変更が次回呼び出しでも見える

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
  const mod = emitIR(parse(tokenize(source)));
  const vm = new VM(mod, host);
  vm.run();
  return captured;
}

// ===========================================================================
// Function-type annotation
// ===========================================================================

describe('Phase 1 #13 V1 — function type annotation', () => {
  it('parses (a: number) => boolean as a type', () => {
    const check = typeCheck(parse(tokenize(`
      const f: (a: number) => boolean = null;
    `)));
    // Assignability for null to function-typed var may fail; just check the
    // function-type itself parsed without errors at parse time.
    expect(() => parse(tokenize(`
      type Pred = (a: number) => boolean;
    `))).not.toThrow();
    void check;
  });

  it('parses zero-arg function type', () => {
    expect(() => parse(tokenize(`
      type Action = () => void;
    `))).not.toThrow();
  });

  it('parses multi-arg function type', () => {
    expect(() => parse(tokenize(`
      type BinOp = (a: number, b: number) => number;
    `))).not.toThrow();
  });

  it('rejects malformed function type (missing arrow)', () => {
    expect(() => parse(tokenize(`
      type Bad = (a: number) number;
    `))).toThrow();
  });
});

// ===========================================================================
// Class methods — parse + typecheck
// ===========================================================================

describe('Phase 1 #13 V1 — class methods', () => {
  it('lowers a class with one method to factory + method top-level fn', () => {
    const ast = parse(tokenize(`
      class Enemy {
        hp: number = 100;
        damage(d: number): void {
          this.hp = this.hp - d;
        }
      }
    `));
    // Expect 2 top-level statements: __Enemy_damage__ and Enemy.
    expect(ast.body.length).toBe(2);
    const fnNames = (ast.body as any[]).map(s => s.name);
    expect(fnNames).toContain('__Enemy_damage__');
    expect(fnNames).toContain('Enemy');
  });

  it('typechecks method calling this.field', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        hp: number = 100;
        damage(d: number): void {
          this.hp = this.hp - d;
        }
      }
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects method body using this.unknownField', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        hp: number = 100;
        broken(): void {
          this.notAField;
        }
      }
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('typechecks instance.method(args) call', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        hp: number = 100;
        damage(d: number): void {
          this.hp = this.hp - d;
        }
      }
      const p = new Player();
      p.damage(10);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects method call with wrong arg type', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        hp: number = 100;
        damage(d: number): void { this.hp = this.hp - d; }
      }
      const p = new Player();
      p.damage("ten");
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('typechecks method return value', () => {
    const check = typeCheck(parse(tokenize(`
      class Player {
        hp: number = 100;
        getHp(): number { return this.hp; }
      }
      const p = new Player();
      const h: number = p.getHp();
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks multiple methods on same class', () => {
    const check = typeCheck(parse(tokenize(`
      class Counter {
        count: number = 0;
        increment(): void { this.count = this.count + 1; }
        decrement(): void { this.count = this.count - 1; }
        value(): number { return this.count; }
      }
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks method with multiple parameters', () => {
    const check = typeCheck(parse(tokenize(`
      class Vec2 {
        x: number = 0;
        y: number = 0;
        add(dx: number, dy: number): void {
          this.x = this.x + dx;
          this.y = this.y + dy;
        }
      }
    `)));
    expect(check.errors).toEqual([]);
  });
});

// ===========================================================================
// Runtime behavior — methods modify state, calls work via CALL_METHOD
// ===========================================================================

describe('Phase 1 #13 V1 — class method runtime', () => {
  it('runtime: method modifies this.field', () => {
    const captured = runAndCapture(`
      class Counter {
        count: number = 0;
        increment(): void { this.count = this.count + 1; }
      }
      const c = new Counter();
      c.increment();
      c.increment();
      c.increment();
      engine.__capture("count", c.count);
    `);
    expect(captured.count).toBe(3);
  });

  it('runtime: method returns value', () => {
    const captured = runAndCapture(`
      class Player {
        hp: number = 100;
        damage(d: number): number {
          this.hp = this.hp - d;
          return this.hp;
        }
      }
      const p = new Player();
      const remaining = p.damage(40);
      engine.__capture("remaining", remaining);
      engine.__capture("final_hp", p.hp);
    `);
    expect(captured.remaining).toBe(60);
    expect(captured.final_hp).toBe(60);
  });

  it('runtime: method on multiple instances are independent', () => {
    const captured = runAndCapture(`
      class Counter {
        count: number = 0;
        increment(): void { this.count = this.count + 1; }
      }
      const a = new Counter();
      const b = new Counter();
      a.increment();
      a.increment();
      b.increment();
      engine.__capture("a", a.count);
      engine.__capture("b", b.count);
    `);
    expect(captured.a).toBe(2);
    expect(captured.b).toBe(1);
  });

  it('runtime: method can read and write multiple fields', () => {
    const captured = runAndCapture(`
      class Vec2 {
        x: number = 0;
        y: number = 0;
        translate(dx: number, dy: number): void {
          this.x = this.x + dx;
          this.y = this.y + dy;
        }
      }
      const v = new Vec2();
      v.translate(10, 20);
      v.translate(5, 5);
      engine.__capture("x", v.x);
      engine.__capture("y", v.y);
    `);
    expect(captured.x).toBe(15);
    expect(captured.y).toBe(25);
  });

  it('runtime: constructor + method work together', () => {
    const captured = runAndCapture(`
      class Player {
        hp: number = 0;
        constructor(initHp: number) {
          this.hp = initHp;
        }
        damage(d: number): void {
          this.hp = this.hp - d;
        }
      }
      const p = new Player(150);
      p.damage(50);
      engine.__capture("hp", p.hp);
    `);
    expect(captured.hp).toBe(100);
  });

  it('runtime: method calling another method via this', () => {
    const captured = runAndCapture(`
      class Calc {
        value: number = 10;
        double(): void { this.value = this.value * 2; }
        quadruple(): void {
          this.double();
          this.double();
        }
      }
      const c = new Calc();
      c.quadruple();
      engine.__capture("v", c.value);
    `);
    expect(captured.v).toBe(40);
  });
});

// V1.1 で extends 実装済。継承の詳細は class-inheritance.test.ts。
