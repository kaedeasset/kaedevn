// stdlib — deterministic pure-math intrinsics (floor / ceil / round / trunc /
// abs / sign / sqrt / min / max / clamp). They typecheck as bare calls, emit
// HOST_CALL, and are intercepted IN-VM (never reaching the host). Semantics are
// pinned and MUST match the C++ VM (KscVM.cpp tryStdlib) — see the parity suite
// (tests/parity/sources/t-stdlib.ksc) for the cross-VM byte-equality check.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import { OpCode } from '../src/types/ir.js';
import type { Value } from '../src/types/value.js';
import { compile } from './helpers.js';

// Records setVar writes; throws if any stdlib name leaks through to the host.
class RecordingHost implements HostAPI {
  vars = new Map<string, number>();
  call(name: string, args: Value[]): Value {
    if (name === 'setVar') {
      this.vars.set(args[0] as string, args[1] as number);
      return null as unknown as Value;
    }
    throw new Error(`host received unexpected call '${name}' (stdlib must not reach host)`);
  }
}

// Run `let r = <expr>; engine.setVar("r", r);` and return the recorded r.
function evalExpr(expr: string): number {
  const mod = compile(`let r: number = ${expr};\nengine.setVar("r", r);`);
  const host = new RecordingHost();
  new VM(mod, host).run();
  return host.vars.get('r')!;
}

describe('stdlib — typecheck & emit', () => {
  it('bare stdlib calls typecheck', () => {
    const check = typeCheck(parse(tokenize(`
      let a: number = floor(1.5);
      let b: number = min(3, max(1, 2));
      let c: number = clamp(5, 0, 10);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects string argument', () => {
    const check = typeCheck(parse(tokenize(`let a: number = floor("x");`)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('rejects wrong arg count', () => {
    const check = typeCheck(parse(tokenize(`let a: number = clamp(5, 0);`)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('emits HOST_CALL for stdlib names', () => {
    const mod = compile(`let a: number = floor(1.2); let b: number = min(1, 2);`);
    const names = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL).map((i) => mod.constants[i.operand!]),
    );
    expect(names).toContain('floor');
    expect(names).toContain('min');
  });
});

describe('stdlib — rounding family', () => {
  it('floor', () => { expect(evalExpr('floor(3.7)')).toBe(3); expect(evalExpr('floor(-3.2)')).toBe(-4); });
  it('ceil',  () => { expect(evalExpr('ceil(3.2)')).toBe(4);  expect(evalExpr('ceil(-3.7)')).toBe(-3); });
  it('trunc', () => { expect(evalExpr('trunc(3.9)')).toBe(3); expect(evalExpr('trunc(-3.9)')).toBe(-3); });
  // round = floor(x + 0.5): half toward +Inf (NOT Math.round on negatives)
  it('round half toward +Inf', () => {
    expect(evalExpr('round(2.5)')).toBe(3);
    expect(evalExpr('round(-2.5)')).toBe(-2);
    expect(evalExpr('round(2.4)')).toBe(2);
  });
});

describe('stdlib — numeric', () => {
  it('abs',  () => { expect(evalExpr('abs(-9)')).toBe(9); expect(evalExpr('abs(9)')).toBe(9); });
  it('sign', () => {
    expect(evalExpr('sign(-42)')).toBe(-1);
    expect(evalExpr('sign(0)')).toBe(0);
    expect(evalExpr('sign(7)')).toBe(1);
  });
  it('sqrt', () => { expect(evalExpr('sqrt(9)')).toBe(3); expect(evalExpr('sqrt(2)')).toBeCloseTo(Math.SQRT2, 12); });
  it('min/max', () => {
    expect(evalExpr('min(4, 9)')).toBe(4);
    expect(evalExpr('max(4, 9)')).toBe(9);
    expect(evalExpr('min(-1, -5)')).toBe(-5);
  });
  it('clamp', () => {
    expect(evalExpr('clamp(-5, 0, 10)')).toBe(0);
    expect(evalExpr('clamp(15, 0, 10)')).toBe(10);
    expect(evalExpr('clamp(5, 0, 10)')).toBe(5);
  });
});

describe('stdlib — composition & host isolation', () => {
  it('nests and composes', () => {
    expect(evalExpr('floor(sqrt(abs(-144)))')).toBe(12);
    expect(evalExpr('max(min(5, 3), 1)')).toBe(3);
  });

  it('NaN propagates (sqrt of negative)', () => {
    expect(Number.isNaN(evalExpr('sqrt(-1)'))).toBe(true);
  });

  it('does not delegate stdlib to the host', () => {
    // RecordingHost throws on any non-setVar call; a clean run proves
    // floor/min/etc were handled in-VM.
    const mod = compile(`
      let a: number = floor(1.9);
      let b: number = clamp(a, 0, 1);
      engine.setVar("b", b);
    `);
    const host = new RecordingHost();
    expect(() => new VM(mod, host).run()).not.toThrow();
    expect(host.vars.get('b')).toBe(1);
  });
});
