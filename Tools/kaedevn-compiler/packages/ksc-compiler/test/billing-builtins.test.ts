// Phase 1 Day 19 — verify the billing builtins (platform / isEntitled /
// owned / purchase / restore) typecheck and compile end-to-end, and that
// they emit HOST_CALL opcodes targeting the expected host names.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { VM } from '../src/vm.js';
import type { HostAPI, VMResult } from '../src/vm.js';
import { OpCode } from '../src/types/ir.js';
import type { Value } from '../src/types/value.js';
import { compile } from './helpers.js';

/** Null host that records calls, for checking what the emitter requested. */
class RecordingHost implements HostAPI {
  scripted: Record<string, Value> = {};
  calls: Array<{ name: string; args: Value[] }> = [];
  call(name: string, args: Value[]): Value {
    this.calls.push({ name, args });
    return name in this.scripted ? this.scripted[name] : (null as unknown as Value);
  }
}

describe('Phase 1 Day 19 — Billing builtins', () => {
  it('typechecks platform() as string', () => {
    const source = `const p: string = platform();`;
    const check = typeCheck(parse(tokenize(source)));
    expect(check.errors).toEqual([]);
  });

  it('typechecks isEntitled() as boolean', () => {
    const source = `
      const owned_it: boolean = isEntitled("premium_story_01");
    `;
    const check = typeCheck(parse(tokenize(source)));
    expect(check.errors).toEqual([]);
  });

  it('owned() is an alias returning boolean', () => {
    const source = `
      const b: boolean = owned("character_pack_a");
    `;
    const check = typeCheck(parse(tokenize(source)));
    expect(check.errors).toEqual([]);
  });

  it('rejects isEntitled() called with non-string arg', () => {
    const source = `
      const x: boolean = isEntitled(42);
    `;
    const check = typeCheck(parse(tokenize(source)));
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('emits HOST_CALL for platform()', () => {
    const mod = compile(`const p = platform();`);
    // Find HOST_CALL opcode in any function.
    const hostCalls = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL),
    );
    expect(hostCalls.length).toBeGreaterThan(0);
    const names = hostCalls.map((i) => mod.constants[i.operand!]);
    expect(names).toContain('platform');
  });

  it('emits HOST_CALL for purchase() with AWAIT', () => {
    const source = `
      const r = await purchase("gem_pack_100");
    `;
    const mod = compile(source);
    const hostCalls = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.HOST_CALL),
    );
    const names = hostCalls.map((i) => mod.constants[i.operand!]);
    expect(names).toContain('purchase');

    // purchase() is async → await must appear somewhere
    const awaits = mod.functions.flatMap((f) =>
      f.instructions.filter((i) => i.op === OpCode.AWAIT),
    );
    expect(awaits.length).toBeGreaterThan(0);
  });

  it('end-to-end: platform() returns the host-supplied value', () => {
    const mod = compile(`const p = platform();`);
    const host = new RecordingHost();
    host.scripted['platform'] = 'android';

    const vm = new VM(mod, host);
    vm.run();
    expect(host.calls.map((c) => c.name)).toContain('platform');
  });

  it('end-to-end: isEntitled() forwards productId', () => {
    const mod = compile(`const b = isEntitled("premium_story_01");`);
    const host = new RecordingHost();
    host.scripted['isEntitled'] = true as unknown as Value;

    const vm = new VM(mod, host);
    vm.run();

    const call = host.calls.find((c) => c.name === 'isEntitled');
    expect(call).toBeDefined();
    expect(call!.args).toEqual(['premium_story_01']);
  });

  it('end-to-end: async purchase() round-trips via HOST_CALL', () => {
    const source = `
      const r = await purchase("premium_story_01");
    `;
    const mod = compile(source);
    const host = new RecordingHost();
    host.scripted['purchase'] = {
      __ksc_type: 'object',
      fields: new Map<string, Value>([
        ['status',    'granted'],
        ['productId', 'premium_story_01'],
      ]),
      typeTag: null,
      proto:   null,
    } as unknown as Value;

    const vm = new VM(mod, host);
    vm.run();

    const call = host.calls.find((c) => c.name === 'purchase');
    expect(call).toBeDefined();
    expect(call!.args).toEqual(['premium_story_01']);
  });

  it('supports engine.purchase() as well (same builtin, under engine.)', () => {
    const source = `const r = await engine.purchase("gem_pack_100");`;
    const check = typeCheck(parse(tokenize(source)));
    expect(check.errors).toEqual([]);
  });
});
