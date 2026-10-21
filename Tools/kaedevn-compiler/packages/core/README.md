# @kaedevn/core（型だけ）

KaedeVN の台本のコンパイラ（`@kaedevn/compiler`）が使う型だけを置く。Op IR（`src/types/Op.ts`）とタイムライン（`src/timeline/types.ts`）。

元は kaedevn-monorepo の `packages/core`（ブラウザ版のエンジン全体）。コンパイラはそこから型しか使わないので、2026-10-15 にこの 2 ファイルだけを写した。実行時のコードは無い。Op IR の実行は UE の KaedeVnCore（C++）が持つ。
