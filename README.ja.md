# KaedeVN

Unreal Engine 5 用のビジュアルノベルエンジン（プラグイン）と、その見本のプロジェクトです。MIT ライセンスで、無料で使えます。

英語版は [README.md](README.md)。**この日本語版が正**で、英語版はその訳です。

- リポジトリ: <https://github.com/kaedeasset/kaedevn>
- 作者: kaedeasset（<https://kaedeasset.com/>）
- 対応: Unreal Engine 5.8・Windows（MSVC 14.51）。実行時は Windows と Android で確かめています

## 中身

| 置き場 | 何か |
|---|---|
| `Plugins/KaedeVN/` | プラグイン本体。モジュールは `KaedeVnCore`（再生の中心・エンジン非依存）・`KaedeKsc`（KSC の VM）・`KaedeVnUI`（Slate の描画）・`KaedeVnHost`（GameInstance・GameMode・PlayerController）・`KaedeShaders`（画面フィルタのシェーダ）の 5 つ。どれも Runtime 型。自動試験のソースも入っています |
| `Tools/kaedevn-compiler/` | 台本のコンパイラのソース（TypeScript）。KS・KSC の台本を `scenario.json`（Op IR）にします |
| `KaedeVnSample.uproject`・`Source/`・`Config/`・`Content/`・`Game/` | 見本のプロジェクト。短いノベル「枯れた泉の守り人」ほかの見本の作品が入っています |

ノベルエディタと KS 台本エディタ（Editor 型のモジュール `KaedeVnEditor`）は、このリポジトリには入っていません。Fab と、Epic の GitHub の Unreal Engine のフォークで配ります（UE の EULA で、エディタのツールの配り方が決まっているため）。

## 入れ方

1. このリポジトリを取ります。
   ```
   git clone https://github.com/kaedeasset/kaedevn.git
   ```
2. KaedeVN は MomijiUI（画面の JSON とその Slate の描画）を使います。<https://github.com/kaedeasset/momiji-ui> の `Plugins/MomijiUI/` を、見本のプロジェクトの `Plugins/MomijiUI/` に入れます。
   ```
   git clone https://github.com/kaedeasset/momiji-ui.git ../momiji-ui
   xcopy /E /I ..\momiji-ui\Plugins\MomijiUI Plugins\MomijiUI
   ```
3. 台本のコンパイラの exe を、GitHub の Releases（<https://github.com/kaedeasset/kaedevn/releases>）から取り、`Plugins/KaedeVN/ThirdParty/Win64/` に置きます。ソースから作るなら `Tools/kaedevn-compiler/README.md` の手順で作ります。手順は `Plugins/KaedeVN/ThirdParty/Win64/README.md` にもあります。
4. `KaedeVnSample.uproject` を右クリックして **Generate Visual Studio project files** を選び、`.uproject` を開きます（組み立てを促されたら組み立てます）。

自分のプロジェクトに入れるときは、`Plugins/KaedeVN/` と `Plugins/MomijiUI/` をそのプロジェクトの `Plugins/` に写し、*Edit → Plugins* で KaedeVN を有効にします。作品のデータ（`Game/` の中）の置き場は *Project Settings > Plugins > KaedeVN* の `WorkRoot` で変えられます。

## 最小の使い方

1. 見本のプロジェクトを開き、Play を押します。`Lvl_Sample2D` で見本の作品が始まります。クリック・Enter・Space で読み進め、矢印キーで選択肢を選びます。
2. 台本は `Game/ks-sample/scenario/*.ks`（1 ページ 1 ファイルのテキスト）です。書き換えたら、台本のコンパイラで `scenario.json` にします。
   ```
   Plugins\KaedeVN\ThirdParty\Win64\kaedevn-ks-compile.exe Game\ks-sample
   ```
3. 台本の書き方の例:
   ```ks
   @bg bg_spring_dry
   #ルカ
   ……泉が、枯れている。
   @l
   ```

もっと詳しい手順（見本を置く → 書き換える → 遊ぶ → EXE にする）は導入ガイド [Plugins/KaedeVN/Docs/kaedevn-guide.ja.md](Plugins/KaedeVN/Docs/kaedevn-guide.ja.md) の §1、ブロック・命令・検査・設定の全部はリファレンス [Plugins/KaedeVN/Docs/kaedevn-reference.ja.md](Plugins/KaedeVN/Docs/kaedevn-reference.ja.md) にあります（ノベルエディタはこのリポジトリに入っていないので、エディタの手順は Fab で入れたときのものです）。

## 試験

自動試験のソースは各モジュールの `Private/*Tests.cpp` などにあります。見本のプロジェクトをエディタで開き、*Tools → Session Frontend → Automation* で `Kaede` を選んで回します。コマンドで回すときは:

```
UnrealEditor-Cmd.exe KaedeVnSample.uproject -ExecCmds="Automation RunTests Kaede; Quit" -unattended -nullrhi
```

台本のコンパイラの試験は `Tools/kaedevn-compiler` で `npm install` のあと `npm test` です。

## Fab と、有料の商品

- Fab の商品ページ: 準備中
- KaedeVN と MomijiUI は無料です。kaedeasset は、これを土台にした有料の商品を作っています。いまの柱は **KaedeRPG**（RPG 制作ツール。Unreal Engine のプラグイン。ノベルゲームエンジンを同梱）です。案内は <https://kaedeasset.com/> にあります。

## ライセンス

KaedeVN のソースは MIT です（[LICENSE](LICENSE)。© 2026 kaedeasset）。

MIT でないもの・別のライセンスのもの:

| もの | ライセンス | 置き場 |
|---|---|---|
| 見本の作品の画像（背景・立ち絵・タイトル・UI のアイコン） | CC0 1.0（生成 AI で作ったもの） | `Game/assets/`・`Game/ui/`。詳しくは [Game/LICENSE-ASSETS.md](Game/LICENSE-ASSETS.md) |
| 書体 BIZ UDPゴシック・BIZ UDP明朝・Yomogi・DotGothic16 | SIL Open Font License 1.1 | MomijiUI に同梱（このリポジトリには入っていません） |
| 台本のコンパイラの exe（Releases に置くもの） | 中の Node.js は MIT ほか（Node.js のライセンス） | `Plugins/KaedeVN/ThirdParty/Win64/README.md` |

台本のコンパイラのソース（`Tools/kaedevn-compiler/`）は MIT です。

"Unreal" と "Unreal Engine" は Epic Games, Inc. の商標です。KaedeVN は Epic Games とは関係のない、非公式のプラグインです。
