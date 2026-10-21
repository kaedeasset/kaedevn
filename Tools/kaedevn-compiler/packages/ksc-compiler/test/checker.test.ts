import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { E } from '../src/checker/errors.js';
import type { TypeCheckError } from '../src/checker/errors.js';

/** ソースコードを型チェックしてエラー一覧を返すヘルパー */
function check(source: string): TypeCheckError[] {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  const result = typeCheck(ast);
  return result.errors;
}

/** エラーなしを期待 */
function expectNoErrors(source: string): void {
  const errors = check(source);
  expect(errors).toEqual([]);
}

/** 特定のエラーコードを期待 */
function expectError(source: string, code: string): void {
  const errors = check(source);
  expect(errors.some(e => e.code === code)).toBe(true);
}

/** エラーコード一覧を期待 */
function expectErrors(source: string, codes: string[]): void {
  const errors = check(source);
  const actual = errors.map(e => e.code);
  expect(actual).toEqual(codes);
}

// =====================================================================
// リテラル型
// =====================================================================
describe('Literal types', () => {
  it('number literal infers number', () => {
    expectNoErrors('let x: number = 42;');
  });

  it('string literal infers string', () => {
    expectNoErrors('let x: string = "hello";');
  });

  it('boolean literal infers boolean', () => {
    expectNoErrors('let x: boolean = true;');
  });

  it('null literal infers null', () => {
    expectNoErrors('let x: null = null;');
  });

  it('template literal infers string', () => {
    expectNoErrors('let x: string = `hello`;');
  });
});

// =====================================================================
// 変数宣言
// =====================================================================
describe('Variable declarations', () => {
  it('type annotation matches init type', () => {
    expectNoErrors('let x: number = 10;');
  });

  it('type annotation mismatch causes error', () => {
    expectError('let x: number = "hello";', E.TYPE_MISMATCH);
  });

  it('const reassign causes error', () => {
    expectError('const x: number = 1; x = 2;', E.CONST_REASSIGN);
  });

  it('undefined variable causes error', () => {
    expectError('let x: number = y;', E.UNDEFINED_VARIABLE);
  });

  it('let reassign is allowed', () => {
    expectNoErrors('let x: number = 1; x = 2;');
  });

  it('infers type from init when no annotation', () => {
    expectNoErrors(`
      let x = 42;
      let y: number = x;
    `);
  });
});

// =====================================================================
// 型注釈
// =====================================================================
describe('Type annotations', () => {
  it('array type annotation', () => {
    expectNoErrors('let xs: number[] = [1, 2, 3];');
  });

  it('union type annotation', () => {
    expectNoErrors('let x: number | string = 42;');
  });

  it('object type annotation', () => {
    expectNoErrors('let p: { x: number; y: number } = { x: 1, y: 2 };');
  });

  it('type alias', () => {
    expectNoErrors(`
      type Result = "win" | "lose";
      let r: Result = "win";
    `);
  });
});

// =====================================================================
// 二項演算子
// =====================================================================
describe('Binary operators', () => {
  it('number + number is valid', () => {
    expectNoErrors('let x: number = 1 + 2;');
  });

  it('string + string is valid', () => {
    expectNoErrors('let x: string = "a" + "b";');
  });

  it('string + number is error', () => {
    expectError(`
      let a: string = "hello";
      let b: number = 1;
      let c = a + b;
    `, E.STRING_NUMBER_ADD);
  });

  it('comparison returns boolean', () => {
    expectNoErrors('let x: boolean = 1 > 2;');
  });

  it('arithmetic returns number', () => {
    expectNoErrors('let x: number = 10 - 3 * 2;');
  });
});

// =====================================================================
// 単項演算子
// =====================================================================
describe('Unary operators', () => {
  it('negation returns number', () => {
    expectNoErrors('let x: number = -42;');
  });

  it('logical not returns boolean', () => {
    expectNoErrors('let x: boolean = !true;');
  });
});

// =====================================================================
// 関数宣言
// =====================================================================
describe('Function declarations', () => {
  it('valid return type', () => {
    expectNoErrors(`
      function add(a: number, b: number): number {
        return a + b;
      }
    `);
  });

  it('return type mismatch', () => {
    expectError(`
      function greet(name: string): number {
        return "hello";
      }
    `, E.RETURN_TYPE_MISMATCH);
  });

  it('void function with no return is valid', () => {
    expectNoErrors(`
      function doSomething(x: number): void {
        let y = x + 1;
      }
    `);
  });

  it('void function with empty return is valid', () => {
    expectNoErrors(`
      function doSomething(x: number): void {
        return;
      }
    `);
  });

  it('return outside function', () => {
    expectError('return 42;', E.RETURN_OUTSIDE_FUNCTION);
  });
});

// =====================================================================
// 呼び出し
// =====================================================================
describe('Call expressions', () => {
  it('valid function call', () => {
    expectNoErrors(`
      function add(a: number, b: number): number {
        return a + b;
      }
      let x: number = add(1, 2);
    `);
  });

  it('argument count mismatch', () => {
    expectError(`
      function add(a: number, b: number): number {
        return a + b;
      }
      add(1);
    `, E.ARG_COUNT_MISMATCH);
  });

  it('argument type mismatch', () => {
    expectError(`
      function add(a: number, b: number): number {
        return a + b;
      }
      add(1, "two");
    `, E.TYPE_MISMATCH);
  });

  it('calling non-function', () => {
    expectError(`
      let x: number = 42;
      x();
    `, E.NOT_CALLABLE);
  });
});

// =====================================================================
// 代入
// =====================================================================
describe('Assignment', () => {
  it('compatible type assignment', () => {
    expectNoErrors(`
      let x: number = 1;
      x = 2;
    `);
  });

  it('incompatible type assignment', () => {
    expectError(`
      let x: number = 1;
      x = "hello";
    `, E.TYPE_MISMATCH);
  });

  it('compound assignment +=', () => {
    expectNoErrors(`
      let x: number = 1;
      x += 2;
    `);
  });
});

// =====================================================================
// メンバー / インデックスアクセス
// =====================================================================
describe('Member and index access', () => {
  it('valid property access', () => {
    expectNoErrors(`
      let obj: { name: string; age: number } = { name: "Alice", age: 30 };
      let n: string = obj.name;
    `);
  });

  it('non-existent property', () => {
    expectError(`
      let obj: { name: string } = { name: "Alice" };
      let x = obj.age;
    `, E.NO_SUCH_PROPERTY);
  });

  it('array index access', () => {
    expectNoErrors(`
      let xs: number[] = [1, 2, 3];
      let x: number = xs[0];
    `);
  });
});

// =====================================================================
// 制御フロー
// =====================================================================
describe('Control flow', () => {
  it('if condition is checked', () => {
    expectNoErrors(`
      let x: number = 10;
      if (x > 5) {
        let y = x + 1;
      }
    `);
  });

  it('block scope: inner variable not visible outside', () => {
    expectError(`
      if (true) {
        let inner: number = 42;
      }
      let x = inner;
    `, E.UNDEFINED_VARIABLE);
  });

  it('for loop scoping', () => {
    expectNoErrors(`
      for (let i: number = 0; i < 10; i += 1) {
        let x: number = i;
      }
    `);
  });

  it('switch statement', () => {
    expectNoErrors(`
      let x: number = 1;
      switch (x) {
        case 1:
          let a: number = 10;
          break;
        case 2:
          let b: number = 20;
          break;
        default:
          break;
      }
    `);
  });
});

// =====================================================================
// スコープ
// =====================================================================
describe('Scoping', () => {
  it('function scope: params visible in body', () => {
    expectNoErrors(`
      function f(x: number): number {
        return x;
      }
    `);
  });

  it('block scope: variables scoped to block', () => {
    expectNoErrors(`
      {
        let x: number = 1;
      }
      {
        let x: string = "hello";
      }
    `);
  });

  it('duplicate declaration in same scope', () => {
    expectError(`
      let x: number = 1;
      let x: number = 2;
    `, E.DUPLICATE_DECLARATION);
  });
});

// =====================================================================
// await
// =====================================================================
describe('Await expressions', () => {
  it('await unwraps Promise', () => {
    expectNoErrors(`
      let result: number = await engine.showChoice([]);
    `);
  });

  it('await on non-Promise is error', () => {
    expectError(`
      let x: number = 42;
      let y = await x;
    `, E.AWAIT_NON_PROMISE);
  });
});

// =====================================================================
// ビルトイン関数
// =====================================================================
describe('Builtin functions (engine)', () => {
  it('engine.playBgm with correct args', () => {
    expectNoErrors('engine.playBgm("battle_theme");');
  });

  it('engine.setBg returns Promise<void>', () => {
    expectNoErrors('await engine.setBg("forest");');
  });

  it('engine.showChar with optional args', () => {
    expectNoErrors('await engine.showChar("hero", "smile");');
  });

  it('engine.wait with number arg', () => {
    expectNoErrors('await engine.wait(1000);');
  });

  // Phase 2 #3 — bare `wait()` is now top-level (frame loops shouldn't need
  // the `engine.` prefix).
  it('bare wait() with number arg', () => {
    expectNoErrors('await wait(16);');
  });

  it('rejects bare wait() with non-number arg', () => {
    const errors = check('await wait("16");');
    expect(errors.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// 統合テスト
// =====================================================================
describe('Integration tests', () => {
  it('realistic KSC program', () => {
    expectNoErrors(`
      type Result = "win" | "lose";

      function checkBattle(troopId: string): void {
        let result: Result = await engine.battleStart(troopId);
      }

      function main(): void {
        await engine.setBg("castle");
        await engine.showChar("hero", "normal", "center");
        engine.playBgm("theme");

        let choice: number = await engine.showChoice([]);
        if (choice == 0) {
          checkBattle("dragon");
        }
      }
    `);
  });

  it('forward reference to function', () => {
    expectNoErrors(`
      function main(): void {
        let x: number = helper(10);
      }

      function helper(n: number): number {
        return n + 1;
      }
    `);
  });

  it('multiple errors collected', () => {
    const errors = check(`
      let x: number = "wrong";
      let y = unknownVar;
      const z: number = 1;
      z = 2;
    `);
    expect(errors.length).toBe(3);
    expect(errors[0].code).toBe(E.TYPE_MISMATCH);
    expect(errors[1].code).toBe(E.UNDEFINED_VARIABLE);
    expect(errors[2].code).toBe(E.CONST_REASSIGN);
  });

  it('dialogue block is always valid', () => {
    expectNoErrors(`
      # hero
      "Hello, world!"
      "How are you?"
    `);
  });
});

// =====================================================================
// Phase 1.5: 追加テスト
// =====================================================================
describe('Phase 1.5 features', () => {
  it('continue statement parses', () => {
    expectNoErrors(`
      for (let i: number = 0; i < 10; i += 1) {
        if (i == 5) {
          continue;
        }
      }
    `);
  });

  it('trailing comma in array', () => {
    expectNoErrors('let xs: number[] = [1, 2, 3,];');
  });

  it('trailing comma in function params', () => {
    expectNoErrors(`
      function f(a: number, b: number,): number {
        return a + b;
      }
    `);
  });

  it('trailing comma in call args', () => {
    expectNoErrors(`
      function f(a: number, b: number): number {
        return a + b;
      }
      f(1, 2,);
    `);
  });

  it('trailing comma in object literal', () => {
    expectNoErrors('let obj: { x: number; y: number } = { x: 1, y: 2, };');
  });

  it('%= compound assignment', () => {
    expectNoErrors(`
      let x: number = 10;
      x %= 3;
    `);
  });

  it('await expression', () => {
    expectNoErrors('await engine.wait(500);');
  });

  it('await in variable init', () => {
    expectNoErrors(`
      let result: number = await engine.showChoice([]);
    `);
  });
});

// =====================================================================
// Phase 2-6 ビルトイン: screenFilter / screenFilterClear / shake / moveChar
// =====================================================================
describe('Phase 2-6 builtin functions', () => {
  it('screenFilter with filter type only', () => {
    expectNoErrors('engine.screenFilter("sepia");');
  });

  it('screenFilter with filter type and intensity', () => {
    expectNoErrors('engine.screenFilter("sepia", 0.5);');
  });

  it('screenFilterClear with no args', () => {
    expectNoErrors('engine.screenFilterClear();');
  });

  it('shake with no args (all optional)', () => {
    expectNoErrors('await engine.shake();');
  });

  it('shake with intensity and duration', () => {
    expectNoErrors('await engine.shake(10, 500);');
  });

  it('moveChar with all required args', () => {
    expectNoErrors('await engine.moveChar("hero", "right", 800);');
  });

  it('moveChar with missing required arg → error', () => {
    expectError('await engine.moveChar("hero");', E.ARG_COUNT_MISMATCH);
  });
});
