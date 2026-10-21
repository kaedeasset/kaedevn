// Phase 1 Day 21 — verify `async function` support end-to-end:
// lexer tokenizes `async`, parser reads `async function name() { ... }`,
// checker wraps the return type in Promise<T>, emitter emits normal IR
// (AWAIT/HOST_CALL inside the body work unchanged).

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { emitIR } from '../src/emitter.js';
import { TokenType } from '../src/types/token.js';
import { OpCode } from '../src/types/ir.js';

describe('Phase 1 Day 21 — async function', () => {
  it('lexer recognizes `async` as keyword', () => {
    const toks = tokenize('async function');
    expect(toks[0].type).toBe(TokenType.Async);
    expect(toks[1].type).toBe(TokenType.Function);
  });

  it('parser accepts `async function foo(): T { ... }`', () => {
    const src = `async function pause(): void { }`;
    expect(() => parse(tokenize(src))).not.toThrow();
  });

  it('async function return type is wrapped in Promise', () => {
    const src = `
      async function fetchName(): string {
        return "yoru";
      }
      const name: Promise<string> = fetchName();
    `;
    const check = typeCheck(parse(tokenize(src)));
    expect(check.errors).toEqual([]);
  });

  it('rejects treating async return value as the inner type directly', () => {
    const src = `
      async function fetchName(): string {
        return "yoru";
      }
      const name: string = fetchName();
    `;
    const check = typeCheck(parse(tokenize(src)));
    // Assigning Promise<string> to string should error.
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('await inside async function unwraps Promise', () => {
    const src = `
      async function resolvePurchase(): string {
        const r = await purchase("premium_story_01");
        return r.productId;
      }
      const awaited: Promise<string> = resolvePurchase();
    `;
    const check = typeCheck(parse(tokenize(src)));
    expect(check.errors).toEqual([]);
  });

  it('does NOT double-wrap when author writes Promise<T> explicitly', () => {
    const src = `
      async function manual(): Promise<number> {
        return 42;
      }
      const r: Promise<number> = manual();
    `;
    const check = typeCheck(parse(tokenize(src)));
    expect(check.errors).toEqual([]);
  });

  it('export async function is parsed', () => {
    const src = `
      export async function handleBuy(): void {
        await purchase("gem_pack_100");
      }
    `;
    expect(() => parse(tokenize(src))).not.toThrow();
  });

  it('emitter produces HOST_CALL and AWAIT inside the function body', () => {
    const src = `
      async function buy(): string {
        const r = await purchase("x");
        return r.productId;
      }
      const p: Promise<string> = buy();
    `;
    const mod = emitIR(parse(tokenize(src)));
    const allInst = mod.functions.flatMap((f) => f.instructions);
    expect(allInst.some((i) => i.op === OpCode.HOST_CALL)).toBe(true);
    expect(allInst.some((i) => i.op === OpCode.AWAIT)).toBe(true);
  });

  it('non-async function is unchanged (regression guard)', () => {
    const src = `
      function plain(): number {
        return 1;
      }
      const x: number = plain();
    `;
    const check = typeCheck(parse(tokenize(src)));
    expect(check.errors).toEqual([]);
  });

  it('real-world pattern from 21-ksc-billing-api.md compiles', () => {
    const src = `
      async function unlockChapter2(): void {
        if (owned("premium_story_01")) {
          return;
        }
        const r = await purchase("premium_story_01");
        if (r.status == "granted") {
          return;
        }
      }
    `;
    const check = typeCheck(parse(tokenize(src)));
    expect(check.errors).toEqual([]);
  });
});
