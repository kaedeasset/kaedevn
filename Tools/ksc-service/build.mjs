import { build } from 'esbuild';
import { inject } from 'postject';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
// コンパイラのソースは Tools/kaedevn-compiler（2026-10-15 に kaedevn-monorepo から写し、以後こちらが正）
const upstream = path.resolve(here, '../kaedevn-compiler');
if (!fs.existsSync(path.join(upstream, 'packages/ksc-compiler/src/index.ts'))) throw new Error(`コンパイラのソースが無い: ${upstream}`);
const out = path.join(here, 'build'); fs.mkdirSync(out, { recursive: true });
// 版はコンパイラのソースとサービスの中身から作る（exe と .version.json の照合に使うだけ）
const srcFiles = [
  ...fs.readdirSync(path.join(upstream, 'packages/ksc-compiler/src'), { recursive: true }).filter((f) => f.endsWith('.ts')).sort().map((f) => path.join(upstream, 'packages/ksc-compiler/src', f)),
  path.join(upstream, 'packages/compiler/src/parser/parseKsCommandLine.ts'),
  path.join(upstream, 'packages/compiler/src/registry/commandRegistry.ts'),
  path.join(here, 'service.mjs'),
];
const hash = createHash('sha256');
for (const f of srcFiles) hash.update(fs.readFileSync(f));
const revision = 'src-' + hash.digest('hex').slice(0, 24);
const bundle = path.join(out, 'service.cjs');
await build({ entryPoints: [path.join(here, 'service.mjs')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs',
  alias: {
    '@kaedevn/ksc-compiler': path.join(upstream, 'packages/ksc-compiler/src/index.ts'),
    'kaede-ks-command': path.join(upstream, 'packages/compiler/src/parser/parseKsCommandLine.ts'),
    'kaede-command-registry': path.join(upstream, 'packages/compiler/src/registry/commandRegistry.ts'),
  }, define: { KSC_COMPILER_REVISION: JSON.stringify(revision) } });
if (process.argv.includes('--sea')) {
  const blob = path.join(out, 'sea.blob');
  const config = path.join(out, 'sea.json');
  fs.writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  const exe = path.resolve(here, '../../Plugins/KaedeVN/ThirdParty/Win64/kaedevn-ksc-service.exe');
  fs.copyFileSync(process.execPath, exe);
  await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  fs.writeFileSync(exe + '.version.json', JSON.stringify({ protocol: 'ksc-compile/1', compilerRevision: revision }, null, 2) + '\n');
}
console.log(`Built existing compiler ${revision}`);
