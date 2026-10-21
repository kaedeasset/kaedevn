// Phase 1 #5 — Collision builtins typecheck and emit HOST_CALL.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import { OpCode } from '../src/types/ir.js';
import type { Value } from '../src/types/value.js';
import { compile } from './helpers.js';

class FakeCollisionHost implements HostAPI {
  calls: Array<{ name: string; args: Value[] }> = [];
  private nextHandle = 1;

  call(name: string, args: Value[]): Value {
    this.calls.push({ name, args });
    switch (name) {
      case 'spawn':
        return this.nextHandle++;
      case 'setCollider':
      case 'removeCollider':
      case 'hasCollider':
      case 'overlap':
        return true;
      case 'aabbQuery':
        return 42;  // pretend something matched
    }
    return null as unknown as Value;
  }
}

describe('Phase 1 #5 — Collision builtins', () => {
  it('typechecks setCollider with 3 args', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      setCollider(e, 40, 60);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks setCollider with tag', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      setCollider(e, 40, 60, "enemy");
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects setCollider with number tag', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      setCollider(e, 40, 60, 42);
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('typechecks overlap', () => {
    const check = typeCheck(parse(tokenize(`
      const a = spawn();
      const b = spawn();
      const hit: boolean = overlap(a, b);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks aabbQuery returning union', () => {
    // The union return type means this should typecheck even when assigned
    // to a variable; we don't enforce explicit type annotation here.
    const check = typeCheck(parse(tokenize(`
      const found = aabbQuery(0, 0, 100, 100, "enemy");
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects aabbQuery missing required args', () => {
    const check = typeCheck(parse(tokenize(`
      aabbQuery(0, 0);
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('emits HOST_CALL for collision functions', () => {
    const mod = compile(`
      const e = spawn();
      setCollider(e, 40, 60, "enemy");
      const live = hasCollider(e);
      const found = aabbQuery(0, 0, 100, 100);
      removeCollider(e);
    `);
    const hostCalls = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL),
    );
    const names = hostCalls.map((i) => mod.constants[i.operand!]);
    expect(names).toContain('setCollider');
    expect(names).toContain('hasCollider');
    expect(names).toContain('aabbQuery');
    expect(names).toContain('removeCollider');
  });

  it('engine.overlap() also works', () => {
    const check = typeCheck(parse(tokenize(`
      const a = spawn();
      const b = spawn();
      engine.overlap(a, b);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('end-to-end: setCollider records args via FakeCollisionHost', () => {
    const mod = compile(`
      const e = spawn();
      setCollider(e, 40, 60, "wall");
    `);
    const host = new FakeCollisionHost();
    const vm = new VM(mod, host);
    vm.run();

    const sc = host.calls.find((c) => c.name === 'setCollider');
    expect(sc?.args).toEqual([1, 40, 60, 'wall']);
  });
});
