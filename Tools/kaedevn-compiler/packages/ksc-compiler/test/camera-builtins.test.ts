// Phase 1 #3 — Camera builtins (setCamera / getCamera / cameraFollow /
// cameraTarget) typecheck and emit HOST_CALL.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { VM } from '../src/vm.js';
import type { HostAPI } from '../src/vm.js';
import { OpCode } from '../src/types/ir.js';
import type { Value } from '../src/types/value.js';
import { compile } from './helpers.js';

class FakeCameraHost implements HostAPI {
  calls: Array<{ name: string; args: Value[] }> = [];
  cam = { x: 0, y: 0, zoom: 1, rotation: 0 };
  followTarget: number | null = null;

  call(name: string, args: Value[]): Value {
    this.calls.push({ name, args });
    switch (name) {
      case 'setCamera':
        this.cam.x = args[0] as number;
        this.cam.y = args[1] as number;
        if (args.length >= 3) this.cam.zoom = args[2] as number;
        if (args.length >= 4) this.cam.rotation = args[3] as number;
        return true;
      case 'getCamera':
        return { ...this.cam } as unknown as Value;
      case 'cameraFollow':
        this.followTarget = args[0] === null ? null : (args[0] as number);
        return true;
      case 'cameraTarget':
        return this.followTarget as unknown as Value;
    }
    return null as unknown as Value;
  }
}

describe('Phase 1 #3 — Camera builtins', () => {
  it('typechecks setCamera with 2 args', () => {
    const check = typeCheck(parse(tokenize(`setCamera(100, 200);`)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks setCamera with 4 args', () => {
    const check = typeCheck(parse(tokenize(`setCamera(0, 0, 2.0, 0.5);`)));
    expect(check.errors).toEqual([]);
  });

  it('rejects setCamera with string arg', () => {
    const check = typeCheck(parse(tokenize(`setCamera("left", 0);`)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('typechecks cameraFollow with number handle', () => {
    const check = typeCheck(parse(tokenize(`
      const e = spawn();
      cameraFollow(e);
    `)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks cameraFollow with null', () => {
    const check = typeCheck(parse(tokenize(`cameraFollow(null);`)));
    expect(check.errors).toEqual([]);
  });

  it('emits HOST_CALL for setCamera / getCamera / cameraFollow', () => {
    const mod = compile(`
      const e = spawn();
      setCamera(50, 60);
      const cs = getCamera();
      cameraFollow(e);
      cameraFollow(null);
    `);
    const hostCalls = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL),
    );
    const names = hostCalls.map((i) => mod.constants[i.operand!]);
    expect(names).toContain('setCamera');
    expect(names).toContain('getCamera');
    expect(names).toContain('cameraFollow');
  });

  it('engine.setCamera() also works', () => {
    const check = typeCheck(parse(tokenize(`engine.setCamera(0, 0);`)));
    expect(check.errors).toEqual([]);
  });

  it('end-to-end: setCamera then getCamera via FakeCameraHost', () => {
    const mod = compile(`
      setCamera(123, 456, 2.5, 1.0);
      const cs = getCamera();
    `);
    const host = new FakeCameraHost();
    const vm = new VM(mod, host);
    vm.run();

    const setC = host.calls.find((c) => c.name === 'setCamera');
    expect(setC?.args).toEqual([123, 456, 2.5, 1.0]);
    expect(host.cam.x).toBe(123);
    expect(host.cam.zoom).toBe(2.5);
  });
});
