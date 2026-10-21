// node SEA (Single Executable Application, node 22 公式手順) で
// スクリプト 1 本をスタンドアロン exe にする共通の本体。
// make-ks-compile-exe.mjs と make-blocks2ks-exe.mjs が名前だけ変えて呼ぶ。
//
//   1. esbuild で入口のスクリプトを依存込み単一 CJS にバンドル
//      （@kaedevn/compiler は dist ビルド済みであること: npm run build -w @kaedevn/compiler）
//   2. sea-config → node --experimental-sea-config で blob 生成
//   3. 実行中の node.exe をコピー → postject で blob 注入
//   4. スモークテスト（引数なし→rc=1 / usage 表示）
//
// 出力は scripts/build/dist/ の下。UE 側へは手動コピー（Plugins/KaedeVN/ThirdParty/Win64/）。
//
// 注意:
// - SEA 内の require は node ビルトインのみ可。バンドルが node: 以外を
//   require していないかを検証してから blob 化する。
// - postject は Tools/kaedevn-compiler の devDependency（版を固定）。
// - node.exe が署名済みのため postject が署名破壊の警告を出すが動作には影響しない。

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const distDir = path.join(scriptDir, 'dist');

/**
 * @param {object} names scripts/build/ と dist/ の中のファイル名
 * @param {string} names.entry 入口のスクリプト（scripts/build/ の中）
 * @param {string} names.bundle バンドルの出力
 * @param {string} names.seaConfig sea-config の出力
 * @param {string} names.blob blob の出力
 * @param {string} names.exe exe の出力
 */
export async function buildSeaExe(names) {
  const entry = path.join(scriptDir, names.entry);
  const bundle = path.join(distDir, names.bundle);
  const seaConfig = path.join(distDir, names.seaConfig);
  const blob = path.join(distDir, names.blob);
  const exe = path.join(distDir, names.exe);

  const run = (cmd, args, opts = {}) => {
    console.log(`[run] ${cmd} ${args.join(' ')}`);
    execFileSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts });
  };

  fs.mkdirSync(distDir, { recursive: true });

  // 1. esbuild バンドル（Tools/kaedevn-compiler の node_modules の esbuild JS API を使用）
  const { buildSync } = await import('esbuild');
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'info',
  });

  // SEA の require はビルトイン限定 → バンドルに外部 require が残っていたら中断
  const src = fs.readFileSync(bundle, 'utf-8');
  const badRequires = [...src.matchAll(/require\("([^"]+)"\)/g)]
    .map((m) => m[1])
    .filter((id) => !id.startsWith('node:'));
  if (badRequires.length > 0) {
    console.error(`ERROR: バンドルに非ビルトイン require が残存: ${[...new Set(badRequires)].join(', ')}`);
    process.exit(1);
  }

  // 2. SEA blob 生成
  fs.writeFileSync(
    seaConfig,
    JSON.stringify(
      {
        main: path.relative(repoRoot, bundle).replaceAll('\\', '/'),
        output: path.relative(repoRoot, blob).replaceAll('\\', '/'),
        disableExperimentalSEAWarning: true,
      },
      null,
      2,
    ),
  );
  run(process.execPath, ['--experimental-sea-config', seaConfig]);

  // 3. node.exe コピー → postject 注入
  fs.copyFileSync(process.execPath, exe);
  const { inject } = await import('postject');
  await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });

  // 4. スモークテスト: 引数なし → rc=1 で usage
  const smoke = spawnSync(exe, [], { encoding: 'utf-8' });
  if (smoke.status !== 1 || !smoke.stderr.includes('Usage:')) {
    console.error(`ERROR: スモークテスト失敗 rc=${smoke.status}\n${smoke.stderr}`);
    process.exit(1);
  }

  const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
  console.log(`[done] ${exe} (${mb} MB)`);
  console.log(`UE 同梱先: Plugins/KaedeVN/ThirdParty/Win64/${names.exe}`);
}
