// Phase 2 #1 — Input builtins (pressed / justPressed / justReleased / axis /
// pointer) typecheck and emit HOST_CALL.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import { OpCode } from '../src/types/ir.js';
import type { Value } from '../src/types/value.js';
import { compile } from './helpers.js';

/**
 * Mirror of native InputHostBinding for parity:
 *   pressed(action)      → bool
 *   justPressed(action)  → bool
 *   justReleased(action) → bool
 *   axis(name)           → number (-1..+1)
 *   pointer()            → { x, y, down }
 *
 * Action 名は Action enum メンバ名と一致 ("OK", "Back", "MapUp" ...)。
 */
class FakeInputHost implements HostAPI {
  calls: Array<{ name: string; args: Value[] }> = [];
  held = new Set<string>();
  justPressedSet = new Set<string>();
  justReleasedSet = new Set<string>();
  pointerState = { x: 0, y: 0, down: false };

  call(name: string, args: Value[]): Value {
    this.calls.push({ name, args });
    switch (name) {
      case 'pressed':
        return this.held.has(args[0] as string);
      case 'justPressed':
        return this.justPressedSet.has(args[0] as string);
      case 'justReleased':
        return this.justReleasedSet.has(args[0] as string);
      case 'axis': {
        const n = args[0] as string;
        if (n === 'horizontal') {
          return (this.held.has('MapRight') ? 1 : 0) - (this.held.has('MapLeft') ? 1 : 0);
        }
        if (n === 'vertical') {
          return (this.held.has('MapDown') ? 1 : 0) - (this.held.has('MapUp') ? 1 : 0);
        }
        return 0;
      }
      case 'pointer':
        return { ...this.pointerState } as unknown as Value;
    }
    return null as unknown as Value;
  }
}

describe('Phase 2 #1 — Input builtins', () => {
  it('typechecks pressed("OK")', () => {
    const check = typeCheck(parse(tokenize(`pressed("OK");`)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks justPressed / justReleased', () => {
    const c1 = typeCheck(parse(tokenize(`justPressed("Interact");`)));
    expect(c1.errors).toEqual([]);
    const c2 = typeCheck(parse(tokenize(`justReleased("Back");`)));
    expect(c2.errors).toEqual([]);
  });

  it('rejects pressed() with no args', () => {
    const c = typeCheck(parse(tokenize(`pressed();`)));
    expect(c.errors.length).toBeGreaterThan(0);
  });

  it('rejects pressed() with number arg', () => {
    const c = typeCheck(parse(tokenize(`pressed(0);`)));
    expect(c.errors.length).toBeGreaterThan(0);
  });

  it('typechecks axis("horizontal")', () => {
    const c = typeCheck(parse(tokenize(`const v: number = axis("horizontal");`)));
    expect(c.errors).toEqual([]);
  });

  it('typechecks pointer() returning object with x/y/down', () => {
    const c = typeCheck(parse(tokenize(`
      const p = pointer();
      const x: number = p.x;
      const y: number = p.y;
      const d: boolean = p.down;
    `)));
    expect(c.errors).toEqual([]);
  });

  it('emits HOST_CALL for all 5 input builtins', () => {
    const mod = compile(`
      pressed("OK");
      justPressed("Interact");
      justReleased("Back");
      axis("horizontal");
      pointer();
    `);
    const hostCalls = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL),
    );
    const names = hostCalls.map((i) => mod.constants[i.operand!]);
    expect(names).toContain('pressed');
    expect(names).toContain('justPressed');
    expect(names).toContain('justReleased');
    expect(names).toContain('axis');
    expect(names).toContain('pointer');
  });

  it('engine.pressed() also works', () => {
    const c = typeCheck(parse(tokenize(`engine.pressed("OK");`)));
    expect(c.errors).toEqual([]);
  });

  it('end-to-end: pressed via FakeInputHost', () => {
    const mod = compile(`
      const a: boolean = pressed("OK");
      const b: boolean = pressed("Back");
    `);
    const host = new FakeInputHost();
    host.held.add('OK');
    const vm = new VM(mod, host);
    vm.run();

    const okCall = host.calls.find((c) => c.name === 'pressed' && c.args[0] === 'OK');
    const backCall = host.calls.find((c) => c.name === 'pressed' && c.args[0] === 'Back');
    expect(okCall).toBeDefined();
    expect(backCall).toBeDefined();
  });

  it('end-to-end: axis returns number via FakeInputHost', () => {
    const mod = compile(`const h: number = axis("horizontal");`);
    const host = new FakeInputHost();
    host.held.add('MapRight');
    const vm = new VM(mod, host);
    vm.run();

    const c = host.calls.find((c) => c.name === 'axis');
    expect(c?.args).toEqual(['horizontal']);
  });
});
