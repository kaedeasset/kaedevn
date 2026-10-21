// Phase 1 #13 V1.1 — class extends + super.method() 検証.
//
// V1.1 スコープ:
//   ✅ class Child extends Parent { ... } 単一継承
//   ✅ Child は Parent の field/method を継承（同名で override 可）
//   ✅ super.method(args) で親の対応 method を呼び出し（this auto-bind）
//   ✅ 多段継承（Grandchild extends Child extends Parent）
//   ❌ super(args) コンストラクタ delegation は V1.2 候補
//
// 実装手法: コンパイル時 flatten + hidden `__super_<name>__` field
// （プロトタイプチェーンなし、VM 改修なし、CALL_METHOD で完結）

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { emitIR } from '../src/emitter.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import type { Value } from '../src/types/value.js';

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
// Parsing — extends accepted, unknown parent rejected
// ===========================================================================

describe('Phase 1 #13 V1.1 — extends parsing', () => {
  it('accepts a class with extends after declared parent', () => {
    expect(() => parse(tokenize(`
      class Animal {
        name: string = "";
      }
      class Dog extends Animal {
        breed: string = "";
      }
    `))).not.toThrow();
  });

  it('rejects extends of unknown class', () => {
    expect(() => parse(tokenize(`
      class Dog extends NonExistent {
        breed: string = "";
      }
    `))).toThrow(/Cannot extend unknown class 'NonExistent'/);
  });

  it('rejects extends declared after the child', () => {
    // Order matters — parent must be declared first.
    expect(() => parse(tokenize(`
      class Dog extends Animal {
        breed: string = "";
      }
      class Animal {
        name: string = "";
      }
    `))).toThrow(/Cannot extend unknown class 'Animal'/);
  });

  it('rejects extends as a regular statement (outside class decl)', () => {
    expect(() => parse(tokenize(`
      extends Foo;
    `))).toThrow(/extends/);
  });
});

// ===========================================================================
// Field inheritance + override
// ===========================================================================

describe('Phase 1 #13 V1.1 — field inheritance', () => {
  it('child inherits parent fields', () => {
    const captured = runAndCapture(`
      class Animal {
        name: string = "noname";
        legs: number = 4;
      }
      class Dog extends Animal {
        breed: string = "mutt";
      }
      const d = new Dog();
      engine.__capture("name", d.name);
      engine.__capture("legs", d.legs);
      engine.__capture("breed", d.breed);
    `);
    expect(captured.name).toBe("noname");
    expect(captured.legs).toBe(4);
    expect(captured.breed).toBe("mutt");
  });

  it('child can override field default', () => {
    const captured = runAndCapture(`
      class Animal {
        legs: number = 4;
      }
      class Snake extends Animal {
        legs: number = 0;  // override default
      }
      const s = new Snake();
      engine.__capture("legs", s.legs);
    `);
    expect(captured.legs).toBe(0);
  });
});

// ===========================================================================
// Method inheritance + override
// ===========================================================================

describe('Phase 1 #13 V1.1 — method inheritance', () => {
  it('child inherits parent methods', () => {
    const captured = runAndCapture(`
      class Animal {
        legs: number = 4;
        countLegs(): number { return this.legs; }
      }
      class Dog extends Animal {
        breed: string = "mutt";
      }
      const d = new Dog();
      const n = d.countLegs();
      engine.__capture("legs", n);
    `);
    expect(captured.legs).toBe(4);
  });

  it('child can override parent method', () => {
    const captured = runAndCapture(`
      class Animal {
        speak(): string { return "..."; }
      }
      class Dog extends Animal {
        speak(): string { return "Woof!"; }
      }
      class Cat extends Animal {
        speak(): string { return "Meow!"; }
      }
      const a = new Animal();
      const d = new Dog();
      const c = new Cat();
      engine.__capture("a", a.speak());
      engine.__capture("d", d.speak());
      engine.__capture("c", c.speak());
    `);
    expect(captured.a).toBe("...");
    expect(captured.d).toBe("Woof!");
    expect(captured.c).toBe("Meow!");
  });

  it('child can call super.method to delegate to parent', () => {
    const captured = runAndCapture(`
      class Enemy {
        hp: number = 100;
        damage(d: number): void {
          this.hp = this.hp - d;
        }
      }
      class Boss extends Enemy {
        damage(d: number): void {
          // Half damage — call parent version
          super.damage(d / 2);
        }
      }
      const e = new Enemy();
      const b = new Boss();
      e.damage(40);
      b.damage(40);
      engine.__capture("e_hp", e.hp);
      engine.__capture("b_hp", b.hp);
    `);
    expect(captured.e_hp).toBe(60);   // 100 - 40
    expect(captured.b_hp).toBe(80);   // 100 - (40/2)
  });
});

// ===========================================================================
// super.method outside override
// ===========================================================================

describe('Phase 1 #13 V1.1 — super edge cases', () => {
  it("rejects super.method() outside an extending class", () => {
    expect(() => parse(tokenize(`
      class Foo {
        bar(): void {
          super.baz();
        }
      }
    `))).toThrow(/'super' is only valid/);
  });

  it("rejects bare super() (constructor delegation, V1.2)", () => {
    expect(() => parse(tokenize(`
      class Animal {
        name: string = "";
      }
      class Dog extends Animal {
        constructor() {
          super();
        }
      }
    `))).toThrow(/super\(\.\.\.\)/);
  });
});

// ===========================================================================
// Multi-level inheritance
// ===========================================================================

describe('Phase 1 #13 V1.1 — multi-level inheritance', () => {
  it('grandchild inherits from child and grandparent', () => {
    const captured = runAndCapture(`
      class Animal {
        legs: number = 4;
        species: string = "?";
      }
      class Dog extends Animal {
        species: string = "dog";  // override
        breed: string = "mutt";
      }
      class Puppy extends Dog {
        age: number = 1;
      }
      const p = new Puppy();
      engine.__capture("legs", p.legs);     // from Animal
      engine.__capture("species", p.species); // from Dog (overrides Animal)
      engine.__capture("breed", p.breed);     // from Dog
      engine.__capture("age", p.age);         // from Puppy
    `);
    expect(captured.legs).toBe(4);
    expect(captured.species).toBe("dog");
    expect(captured.breed).toBe("mutt");
    expect(captured.age).toBe(1);
  });

  it('grandchild method override + super.method() chain', () => {
    const captured = runAndCapture(`
      class A {
        identify(): string { return "A"; }
      }
      class B extends A {
        identify(): string {
          // calls A's identify and prefixes
          return "B->" + super.identify();
        }
      }
      class C extends B {
        identify(): string {
          // calls B's identify (which itself calls A's)
          return "C->" + super.identify();
        }
      }
      const c = new C();
      engine.__capture("id", c.identify());
    `);
    // C's identify → "C->" + B's → "C->B->" + A's → "C->B->A"
    expect(captured.id).toBe("C->B->A");
  });
});

// ===========================================================================
// Constructor in child still works (just no super() yet)
// ===========================================================================

describe('Phase 1 #13 V1.1 — constructor with extends', () => {
  it('child constructor can set inherited fields', () => {
    const captured = runAndCapture(`
      class Animal {
        name: string = "";
      }
      class Dog extends Animal {
        breed: string = "";
        constructor(initName: string, initBreed: string) {
          this.name = initName;     // inherited field
          this.breed = initBreed;
        }
      }
      const d = new Dog("Rex", "lab");
      engine.__capture("name", d.name);
      engine.__capture("breed", d.breed);
    `);
    expect(captured.name).toBe("Rex");
    expect(captured.breed).toBe("lab");
  });
});

// ===========================================================================
// Type checking with extends
// ===========================================================================

describe('Phase 1 #13 V1.1 — type checking', () => {
  it('typechecks accessing inherited field on child', () => {
    const check = typeCheck(parse(tokenize(`
      class Animal {
        legs: number = 4;
      }
      class Dog extends Animal {
        breed: string = "";
      }
      const d = new Dog();
      const n: number = d.legs;
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks inherited method call on child', () => {
    const check = typeCheck(parse(tokenize(`
      class Animal {
        legs: number = 4;
        countLegs(): number { return this.legs; }
      }
      class Dog extends Animal {
        breed: string = "";
      }
      const d = new Dog();
      const n: number = d.countLegs();
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects accessing nonexistent field on child', () => {
    const check = typeCheck(parse(tokenize(`
      class Animal { legs: number = 4; }
      class Dog extends Animal { }
      const d = new Dog();
      const x = d.notAField;
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });
});
