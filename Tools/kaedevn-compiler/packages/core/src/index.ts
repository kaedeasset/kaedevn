// index.ts — コンパイラが使う型だけを出す（Op IR とタイムライン）。
//
// 元は kaedevn-monorepo の packages/core（エンジン全体）。コンパイラが使うのは型だけなので、
// その 2 ファイルだけを写した（2026-10-15）。実行時のコードは持たない。
export type { Op, CompiledScenario, ChAnimParams, Direction } from "./types/Op.js";
export type * from "./timeline/types.js";
