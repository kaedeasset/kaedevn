// ks-to-native.mjs → 単一 exe（kaedevn-ks-compile.exe）ビルダー。
// UE プラグイン同梱用のスタンドアロン KS コンパイラを作る。手順は sea-exe.mjs。
//
// Usage:
//   node scripts/build/make-ks-compile-exe.mjs
//
// 出力: scripts/build/dist/kaedevn-ks-compile.exe
//   （UE 側へは手動コピー: Plugins/KaedeVN/ThirdParty/Win64/kaedevn-ks-compile.exe）

import { buildSeaExe } from './sea-exe.mjs';

await buildSeaExe({
  entry: 'ks-to-native.mjs',
  bundle: 'ks-to-native.bundle.cjs',
  seaConfig: 'sea-config.json',
  blob: 'sea-prep.blob',
  exe: 'kaedevn-ks-compile.exe',
});
