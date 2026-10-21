// Phase 1 #4 — Tween builtins typecheck and emit HOST_CALL.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import { OpCode } from '../src/types/ir.js';
import type { Value } from '../src/types/value.js';
import { compile } from './helpers.js';

class FakeTweenHost implements HostAPI {
  calls: Array<{ name: string; args: Value[] }> = [];
  private nextHandle = 1;
  private active = new Set<number>();

  call(name: string, args: Value[]): Value {
    this.calls.push({ name, args });
    switch (name) {
      case 'spawn': {
        const h = this.nextHandle++;
        return h;
      }
      case 'tweenTo':
        this.active.add(args[0] as number);
        return true;
      case 'tweenStop':
        return this.active.delete(args[0] as number);
      case 'tweenActive':
        return this.active.has(args[0] as number);
      case 'tweenCount':
        return this.active.size;
    }
    return null as unknown as Value;
  }
}

describe('Phase 1 #4 — Tween builtins', () => {
  it('typechecks tweenTo with 4 args', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      tweenTo(e, 100, 200, 1000);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks tweenTo with easing string', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      tweenTo(e, 100, 200, 1000, "easeInOut");
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects tweenTo with string handle', () => {
    const check = typeCheck(parse(tokenize(`
      tweenTo("home", 100, 200, 1000);
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('rejects tweenTo with number easing', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      tweenTo(e, 100, 200, 1000, 42);
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('typechecks tweenStop / tweenActive', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      const stopped: boolean = tweenStop(e);
      const live: boolean = tweenActive(e);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks tweenCount() returning number', () => {
    const check = typeCheck(parse(tokenize(`const n: number = tweenCount();`)));
    expect(check.errors).toEqual([]);
  });

  it('emits HOST_CALL for tweenTo / tweenStop / tweenActive', () => {
    const mod = compile(`
      const e = spawn();
      tweenTo(e, 100, 200, 1000);
      const a = tweenActive(e);
      tweenStop(e);
    `);
    const hostCalls = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL),
    );
    const names = hostCalls.map((i) => mod.constants[i.operand!]);
    expect(names).toContain('tweenTo');
    expect(names).toContain('tweenActive');
    expect(names).toContain('tweenStop');
  });

  it('engine.tweenTo() also works', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      engine.tweenTo(e, 0, 0, 100);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('end-to-end: tweenTo records args via FakeTweenHost', () => {
    const mod = compile(`
      const e = spawn();
      tweenTo(e, 999, 888, 500, "easeOut");
    `);
    const host = new FakeTweenHost();
    const vm = new VM(mod, host);
    vm.run();

    const call = host.calls.find((c) => c.name === 'tweenTo');
    expect(call?.args).toEqual([1, 999, 888, 500, 'easeOut']);
  });
});
