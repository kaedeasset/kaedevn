// Phase 1 Day 22 — `===` / `!==` are accepted and fold into `==` / `!=`.
// KSC is statically typed so there is no runtime distinction between
// value equality and identity equality; we just want the lexer to accept
// the TS-familiar spelling.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { emitIR } from '../src/emitter.js';
import { TokenType } from '../src/types/token.js';
import { OpCode } from '../src/types/ir.js';

describe('Phase 1 Day 22 — triple equals', () => {
  it('lexer folds === into Eq token', () => {
    const toks = tokenize('a === b');
    const eqs = toks.filter(t => t.type === TokenType.Eq);
    expect(eqs.length).toBe(1);
  });

  it('lexer folds !== into NotEq token', () => {
    const toks = tokenize('a !== b');
    const neqs = toks.filter(t => t.type === TokenType.NotEq);
    expect(neqs.length).toBe(1);
  });

  it('=== and == produce the same IR', () => {
    const src1 = `const r: boolean = 1 == 2;`;
    const src2 = `const r: boolean = 1 === 2;`;
    const a = emitIR(parse(tokenize(src1)));
    const b = emitIR(parse(tokenize(src2)));

    const ops = (mod: typeof a) =>
      mod.functions.flatMap(f => f.instructions.map(i => i.op));
    expect(ops(a).filter(op => op === OpCode.CMP_EQ))
      .toEqual(ops(b).filter(op => op === OpCode.CMP_EQ));
  });

  it('!== and != produce the same IR', () => {
    const src1 = `const r: boolean = 1 != 2;`;
    const src2 = `const r: boolean = 1 !== 2;`;
    const a = emitIR(parse(tokenize(src1)));
    const b = emitIR(parse(tokenize(src2)));

    const ops = (mod: typeof a) =>
      mod.functions.flatMap(f => f.instructions.map(i => i.op));
    expect(ops(a).filter(op => op === OpCode.CMP_NEQ))
      .toEqual(ops(b).filter(op => op === OpCode.CMP_NEQ));
  });

  it('full purchase flow with === compiles cleanly', () => {
    const src = `
      async function unlockChapter2(): void {
        if (owned("premium_story_01")) { return; }
        const r = await purchase("premium_story_01");
        if (r.status === "granted") { return; }
        if (r.status !== "cancelled") { return; }
      }
    `;
    const check = typeCheck(parse(tokenize(src)));
    expect(check.errors).toEqual([]);
  });

  it('regression: existing == / != tokens still work', () => {
    const src = `
      const a: boolean = 1 == 2;
      const b: boolean = "x" != "y";
    `;
    const check = typeCheck(parse(tokenize(src)));
    expect(check.errors).toEqual([]);
  });
});
