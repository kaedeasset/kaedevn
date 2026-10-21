/** 試験で共通に使う compile。型検査の誤りは expect で失敗させる（失敗の扱いを 1 つにする）。 */
import { expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { typeCheck } from '../src/checker.js';
import { emitIR, type EmitOptions } from '../src/emitter.js';
import type { IRModule } from '../src/types/ir.js';

/** 字句 → 構文 → 型検査 → IR。型検査に誤りがあれば試験を落とす。 */
export function compile(source: string): IRModule {
  const ast = parse(tokenize(source));
  const check = typeCheck(ast);
  expect(check.errors).toEqual([]);
  return emitIR(ast);
}

/** 型検査を通さずに IR まで（emitter だけを試すとき）。 */
export function emitOnly(source: string, options?: EmitOptions): IRModule {
  return emitIR(parse(tokenize(source)), undefined, options);
}
