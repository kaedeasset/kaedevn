# 同梱exe

このフォルダには3本の exe が入っている。ネットワーク通信は行わない。
変換ツール2本はフォルダを読み書きし、KSCサービスは標準入出力でメモリコンパイルする。同一性は
`SHA256SUMS.txt` で検証できる。

> **exe は git に入っていない**（2026-09-24 から `.gitignore`。1本 80MB で GitHub に置く価値が無く、
> `Tools/kaedevn-compiler` から再生成できる）。クローンした環境では下の再生成手順で作って置く。`SHA256SUMS.txt` は追跡している。
>
> **ソースの正は `Tools/kaedevn-compiler/`**（2026-10-15 に kaedevn-monorepo から写した。以後 monorepo の同じ部分は更新しない）。

## GitHub の Releases から取る（Get the executables from GitHub Releases）

組み立て済みの exe は、KaedeVN の GitHub のリポジトリの Releases（<https://github.com/kaedeasset/kaedevn/releases>）に置く。Fab の梱包には同梱している。

1. 使う版の Release を開き、`kaedevn-ks-compile.exe`・`kaedevn-blocks2ks.exe`・`kaedevn-ksc-service.exe` を取る。
2. このフォルダ（`Plugins/KaedeVN/ThirdParty/Win64/`）に置く。
3. 下の「検証」のとおり `SHA256SUMS.txt` と照らす。

The prebuilt executables are attached to the Releases page of the KaedeVN GitHub repository (<https://github.com/kaedeasset/kaedevn/releases>); the Fab package already bundles them.
Download `kaedevn-ks-compile.exe`, `kaedevn-blocks2ks.exe` and `kaedevn-ksc-service.exe`
from the release you use, put them in this folder, and check them against `SHA256SUMS.txt`
(see 検証 below). You can also build them from `Tools/kaedevn-compiler/` (see 再生成手順).

| exe | 呼ばれる場面 |
|---|---|
| `kaedevn-ks-compile.exe` | KS台本エディタの「ビルド」。`scenario/*.ks` → `scenario.json` / `asset-manifest.json` |
| `kaedevn-blocks2ks.exe` | ノベルエディタの「保存」。話のブロックJSON → `.ks` / `.ksc`（GUIで組んだ作品もテキスト形で残すため） |
| `kaedevn-ksc-service.exe` | UEのADV表示。既存KSコマンドを既存KSCコンパイラでIRへ変換する常駐JSONLサービス。`Tools/ksc-service/build.mjs`で再生成。CLIのadv-simは使用しない |

以下は `kaedevn-ks-compile.exe` についての詳細。`kaedevn-blocks2ks.exe` も同じ Node SEA 方式で、
生成は `Tools/kaedevn-compiler` の `npm run exe:blocks2ks`（下の再生成手順）。

---

# kaedevn-ks-compile.exe（同梱KSコンパイラ）

KaedeVN KSエディタが「ビルド」時に呼ぶスタンドアロンのKSコンパイラ。
KSスクリプト群（`scenario/*.ks`）を実行形式 `scenario.json`（Op IR）と
`asset-manifest.json` にコンパイルする。外部ツール（Node のインストール等）を
不要にするためプラグインに同梱している。

## 何であるか（provenance）

- **中身**: `Tools/kaedevn-compiler/packages/compiler`（`@kaedevn/compiler`。2026-10-15 に kaedevn-monorepo から写した）
  （`filesToKs` リンカ → `compile`）を、`scripts/build/ks-to-native.mjs` を
  エントリに esbuild で単一 CJS へバンドルしたもの。
- **形式**: Node.js **SEA（Single Executable Application, Node 22 公式手順）**。
  実体は `node.exe` のコピーに SEA blob を postject で注入した単一 exe。
  そのため大部分（約 83MB）は Node.js ランタイム本体。
- **生成スクリプト**: `Tools/kaedevn-compiler/scripts/build/make-ks-compile-exe.mjs`
  （esbuild バンドル → `--experimental-sea-config` で blob 生成 →
  node.exe コピー → postject 注入 → スモークテスト）。

## 再生成手順

`Tools/kaedevn-compiler` で:

```
npm install
npm run build              # core（型）→ ksc-compiler → compiler の dist を用意
npm test                   # compiler と ksc-compiler の試験
npm run exe:ks-compile     # → scripts/build/dist/kaedevn-ks-compile.exe
npm run exe:blocks2ks      # → scripts/build/dist/kaedevn-blocks2ks.exe
```

`kaedevn-ksc-service.exe` は `Tools/ksc-service` で `node build.mjs --sea`（同じソースを使う。`.version.json` も書き直す）。

生成物をこのフォルダへ手動コピー:

```
Plugins/KaedeVN/ThirdParty/Win64/kaedevn-ks-compile.exe
```

コピー後、`SHA256SUMS.txt` を更新すること（下記コマンド）:

```powershell
(Get-FileHash .\kaedevn-ks-compile.exe -Algorithm SHA256).Hash
```

## 検証（配布物の同一性確認）

```powershell
# 期待ハッシュと一致するか
$want = (Get-Content .\SHA256SUMS.txt | Select-String 'kaedevn-ks-compile.exe').ToString().Split(' ')[0]
$got  = (Get-FileHash .\kaedevn-ks-compile.exe -Algorithm SHA256).Hash
if ($got -ieq $want) { 'OK' } else { "MISMATCH: $got" }
```

## ライセンス

- **本体の Node.js ランタイム**: Node.js は MIT ライセンス（+ 同梱コンポーネントの
  ライセンス群）。SEA exe は node.exe を含むため Node.js のライセンスが及ぶ。
  詳細は [Node.js LICENSE](https://github.com/nodejs/node/blob/main/LICENSE)。
- **注入コード（`@kaedevn/compiler` とそのバンドル依存）**: 本プロジェクトと同じ
  MIT ライセンス（© 2026 kaedeasset）。バンドルに含まれる npm 依存のライセンス表は
  `Tools/kaedevn-compiler/packages/compiler` の依存関係に従う（実行時依存は最小）。
- プラグイン全体のライセンス方針は `Plugins/KaedeVN/README.md` / `LICENSE` を参照。

> 注: この exe はネットワーク通信を行わず、引数で渡された KS プロジェクトdir を
> 読み、同じフォルダへ `scenario.json` / `asset-manifest.json` を書き出すだけ。
