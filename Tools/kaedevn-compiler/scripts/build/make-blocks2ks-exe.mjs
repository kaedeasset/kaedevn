// blocks-to-ks.mjs → 単一 exe（kaedevn-blocks2ks.exe）ビルダー。手順は sea-exe.mjs。
//
// Usage:
//   node scripts/build/make-blocks2ks-exe.mjs
// 出力: scripts/build/dist/kaedevn-blocks2ks.exe
//   （UE 同梱先: Plugins/KaedeVN/ThirdParty/Win64/kaedevn-blocks2ks.exe）

import { buildSeaExe } from './sea-exe.mjs';

await buildSeaExe({
  entry: 'blocks-to-ks.mjs',
  bundle: 'blocks-to-ks.bundle.cjs',
  seaConfig: 'sea-config-blocks2ks.json',
  blob: 'sea-prep-blocks2ks.blob',
  exe: 'kaedevn-blocks2ks.exe',
});
