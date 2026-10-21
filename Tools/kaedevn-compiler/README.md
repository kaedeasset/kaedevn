# kaedevn-compiler — KaedeVN の台本のコンパイラ

KaedeVN の台本（KS・KSC）を、UE の KaedeVnCore が実行する形（Op IR の `scenario.json`）にする TypeScript のコード。KaedeVN の同梱 exe 3 本（`Plugins/KaedeVN/ThirdParty/Win64/`）は、ここから作る。

**ソースの正はここ。** 2026-10-15 に kaedevn-monorepo（commit `d66168d7`）から写し、以後はこのリポジトリで更新する（monorepo の同じ部分は更新しない）。ライセンスは MIT。

## 中身

| 置き場 | 何か |
|---|---|
| `packages/compiler`（`@kaedevn/compiler`） | KS の字句・構文・検査・Op IR への変換、ファイルをまたぐリンク（`filesToKs`）、ブロック JSON → KS（`blocksToKs`）、KS → KSC、ティラノスクリプトの読み込み、CLI |
| `packages/ksc-compiler`（`@kaedevn/ksc-compiler`） | KSC（スクリプト言語）の字句・構文・型検査・IR・VM |
| `packages/core`（`@kaedevn/core`） | コンパイラが使う型だけ（Op IR とタイムライン）。monorepo の `packages/core` から 2 ファイルだけを写した。実行時のコードは無い |
| `scripts/build/` | exe の入口（`ks-to-native.mjs`・`blocks-to-ks.mjs`）と、Node の単体 exe（SEA）を作る脚本 |

`kaedevn-ksc-service.exe` の入口は `Tools/ksc-service`（同じソースをここから読む）。

## 使い方

Node 22 以上。

```
npm install
npm run build             # core（型）→ ksc-compiler → compiler の dist
npm test                  # compiler と ksc-compiler の試験（vitest）
npm run exe:ks-compile    # → scripts/build/dist/kaedevn-ks-compile.exe
npm run exe:blocks2ks     # → scripts/build/dist/kaedevn-blocks2ks.exe
```

できた exe を `Plugins/KaedeVN/ThirdParty/Win64/` へ写し、`SHA256SUMS.txt` を直す（手順は同じフォルダの `README.md`）。exe は git に入れない（1 本 80MB）。公開するときは GitHub の Releases に置く。

## ライセンス

MIT（`packages/*/LICENSE`）。
