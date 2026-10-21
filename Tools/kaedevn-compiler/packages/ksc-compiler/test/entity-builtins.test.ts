// Phase 1 #2 — verify the ECS / entity builtins (spawn / destroy / isAlive /
// setPos / getPos / setSprite / setLayer / entityCount) typecheck, compile
// end-to-end, and emit HOST_CALL targeting the expected host names.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import { OpCode } from '../src/types/ir.js';
import type { Value } from '../src/types/value.js';
import { compile } from './helpers.js';

/** Recording host that mimics EntityHostBinding for parity testing. */
class FakeEntityHost implements HostAPI {
  calls: Array<{ name: string; args: Value[] }> = [];
  private nextHandle = 1;
  private alive = new Set<number>();
  private positions = new Map<number, { x: number; y: number }>();

  call(name: string, args: Value[]): Value {
    this.calls.push({ name, args });
    switch (name) {
      case 'spawn': {
        const h = this.nextHandle++;
        this.alive.add(h);
        const x = typeof args[0] === 'number' ? args[0] : 0;
        const y = typeof args[1] === 'number' ? args[1] : 0;
        this.positions.set(h, { x, y });
        return h;
      }
      case 'destroy': {
        const h = args[0] as number;
        if (!this.alive.has(h)) return false;
        this.alive.delete(h);
        this.positions.delete(h);
        return true;
      }
      case 'isAlive':
        return this.alive.has(args[0] as number);
      case 'setPos': {
        const h = args[0] as number;
        if (!this.alive.has(h)) return false;
        this.positions.set(h, { x: args[1] as number, y: args[2] as number });
        return true;
      }
      case 'getPos': {
        const p = this.positions.get(args[0] as number);
        return p ? ({ x: p.x, y: p.y } as unknown as Value) : (null as unknown as Value);
      }
      case 'setSprite':
        return this.alive.has(args[0] as number);
      case 'setLayer':
        return this.alive.has(args[0] as number);
      case 'entityCount':
        return this.alive.size;
    }
    return null as unknown as Value;
  }
}

describe('Phase 1 #2 — Entity / ECS builtins', () => {
  it('typechecks spawn() returning number', () => {
    const check = typeCheck(parse(tokenize(`const e: number = spawn();`)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks spawn(x, y)', () => {
    const check = typeCheck(parse(tokenize(`const e = spawn(100, 200);`)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks destroy() returning boolean', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      const ok: boolean = destroy(e);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks isAlive() returning boolean', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      const a: boolean = isAlive(e);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks setPos with three numbers', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      const ok: boolean = setPos(e, 50, 60);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects setPos with string coordinate', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      setPos(e, "left", 60);
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('rejects spawn with string', () => {
    const check = typeCheck(parse(tokenize(`spawn("home");`)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('typechecks entityCount() returning number', () => {
    const check = typeCheck(parse(tokenize(`const n: number = entityCount();`)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks setSprite with numeric texture handle', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      setSprite(e, 1);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks setSprite with string asset path (Phase 2 #2)', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      setSprite(e, "hero.png");
    `)));
    expect(check.errors).toEqual([]);
  });

  it('rejects setSprite with non-number / non-string second arg', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      setSprite(e, true);
    `)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('emits HOST_CALL for spawn / setPos / destroy', () => {
    const mod = compile(`
      const e = spawn(10, 20);
      setPos(e, 30, 40);
      destroy(e);
    `);
    const hostCalls = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL),
    );
    const names = hostCalls.map((i) => mod.constants[i.operand!]);
    expect(names).toContain('spawn');
    expect(names).toContain('setPos');
    expect(names).toContain('destroy');
  });

  it('engine.spawn() also works (backwards-compat path)', () => {
    const check = typeCheck(parse(tokenize(`
      const e = engine.spawn();
    `)));
    expect(check.errors).toEqual([]);
  });

  it('end-to-end: spawn → setPos → destroy via FakeEntityHost', () => {
    const mod = compile(`
      const e = spawn(100, 200);
      setPos(e, 300, 400);
      const alive_after = isAlive(e);
      destroy(e);
      const alive_dead = isAlive(e);
    `);
    const host = new FakeEntityHost();
    const vm = new VM(mod, host);
    vm.run();

    const callNames = host.calls.map((c) => c.name);
    expect(callNames).toContain('spawn');
    expect(callNames).toContain('setPos');
    expect(callNames).toContain('isAlive');
    expect(callNames).toContain('destroy');

    // The spawn call should record (100, 200)
    const spawnCall = host.calls.find((c) => c.name === 'spawn');
    expect(spawnCall?.args).toEqual([100, 200]);

    // setPos should record (handle, 300, 400)
    const setPosCall = host.calls.find((c) => c.name === 'setPos');
    expect(setPosCall?.args[1]).toBe(300);
    expect(setPosCall?.args[2]).toBe(400);
  });
});
