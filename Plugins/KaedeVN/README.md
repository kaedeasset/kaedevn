# KaedeVN

**A visual novel engine and editor for Unreal Engine 5.** Free and MIT licensed.

Build a story from blocks in the native UE **novel editor** (work → chapter →
episode → block, with a live preview and undo), or write it as plain-text
**KS scripts** in the **KS script editor**. Either form becomes a portable
`scenario.json` (the editor compiles blocks itself; a **bundled compiler**
compiles KS scripts), which the runtime plays through a Slate-rendered UI. **Build checks** catch the mistakes that compile fine and
then misbehave at play time, and link straight to the offending block.

> Status: **beta**. Requires **Unreal Engine 5.8** and the free plugin
> **MomijiUI**. Works are made in the **Windows editor only**; create your
> project as a C++ project (packaging needs Visual Studio).

## Documentation

The documentation ships in this plugin's `Docs/` folder:

| Document | English | 日本語 |
|---|---|---|
| Setup guide — install, place the sample, edit, play, package (§1), then features, work folder, controls and KS scripts | [Docs/kaedevn-guide.md](Docs/kaedevn-guide.md) | [Docs/kaedevn-guide.ja.md](Docs/kaedevn-guide.ja.md) |
| Reference — every block, KS command, check and setting | [Docs/kaedevn-reference.md](Docs/kaedevn-reference.md) | [Docs/kaedevn-reference.ja.md](Docs/kaedevn-reference.ja.md) |
| Changelog | [Docs/kaedevn-changelog.md](Docs/kaedevn-changelog.md) | （同じ 1 本） |

**New here? Start with §1 of the setup guide.** The short version: enable
KaedeVN (and MomijiUI), open **Tools → KaedeVN → KaedeVN ノベルエディタ**,
press **見本を置く** (place the sample), then **▶ プレイ** (play).

## What it can do in Unreal Engine

- **Novel editor** — 7 block kinds (`text`, `bg`, `ch`, `set_var`, `jump`,
  `if`, `choice`), live preview, undo / redo, chapters as folders and episodes
  as files. Saving also writes the episode as KS text.
- **KS scripts and the KS script editor** — one plain-text `.ks` file per
  episode; a script tree with fields, preview and 8 line checks. The text files
  are the source of truth: the KS script editor never rewrites your text.
- **15 build checks** — missing images, empty lines or choice labels, jumps to
  episodes that do not exist, duplicate ids and more. Click a report to jump to
  the block.
- **Playback** — the 39 KS commands that run in UE (backgrounds, sprites,
  free sprites, text, overlays, layers, transitions, masks, screen filters,
  shake, flash, fades, camera, timelines, waits, jumps, calls), lines with text
  reveal, choices, variables and branches, KSC scripts, save / load, auto,
  skip and quick save / load, with keyboard, mouse and gamepad.
- **Game screens** — title, menu, table of contents, save, load, manual and
  config, written as MomijiUI JSON.
- **Bundled compiler** — self-contained executables in `ThirdParty/Win64/`
  (`kaedevn-ks-compile.exe` for KS scripts, `kaedevn-blocks2ks.exe` for the
  KS text written on save); no external tools, no network access.

Not yet: sound does not play in UE (BGM, sound-effect and voice commands build
but do nothing), and the editor's labels are Japanese. See §7 of the setup
guide.

## Modules

KaedeVN depends on the **MomijiUI** plugin (screen JSON and its Slate renderer, plus the bundled fonts); install both.

| Module | Type | Role |
|---|---|---|
| `KaedeVnCore` | Runtime | Engine-agnostic play session & op handler (unit-tested). |
| `KaedeKsc` | Runtime | KSC stack VM and its UE host. |
| `KaedeVnUI` | Runtime | Slate rendering of the novel UI (on top of MomijiUI). |
| `KaedeVnHost` | Runtime | Minimal GameInstance / GameMode / PlayerController for a packaged novel. |
| `KaedeShaders` | Runtime (PostConfigInit) | Virtual shader directory `/Kaede`. |
| `KaedeVnEditor` | Editor | Novel editor and KS script editor + bundled compilers. **Windows editor only.** |

The source repository on GitHub (<https://github.com/kaedeasset/kaedevn>) carries the runtime modules only.
The `KaedeVnEditor` module is distributed through Fab and the Unreal Engine
fork on Epic's GitHub.

## License

MIT © 2026 kaedeasset. See [LICENSE](LICENSE).

Third-party components retain their own licenses; see [CREDITS.md](CREDITS.md)
(e.g. [nlohmann/json](https://github.com/nlohmann/json), MIT).

"Unreal" and "Unreal Engine" are trademarks of Epic Games, Inc. KaedeVN is an
independent, unofficial plugin and is not affiliated with or endorsed by Epic
Games.

---

## 日本語

**KaedeVN** は Unreal Engine 5 でノベルゲームを作る、無料（MIT）のプラグインです。UE の**ノベルエディタ**でブロックを並べて組むか（作品 › 章 › 話 › ブロック・プレビュー・元に戻す）、文字の **KS 台本**を **KS 台本エディタ**で書きます。どちらも `scenario.json` になり（ブロックはエディタが組み、KS 台本は**同梱のコンパイラ**が組む）、Slate で描く画面で再生します。**ビルドの検査**が「組めるのに遊ぶとおかしくなる所」を見つけ、指摘からそのブロックへ移れます。

- 説明書はこのプラグインの `Docs/` にあります: **導入ガイド [Docs/kaedevn-guide.ja.md](Docs/kaedevn-guide.ja.md)**（はじめての一本道は §1）・リファレンス [Docs/kaedevn-reference.ja.md](Docs/kaedevn-reference.ja.md)・更新履歴 [Docs/kaedevn-changelog.md](Docs/kaedevn-changelog.md)。英語は `.en.md`。
- 対応: **UE 5.8**・無料のプラグイン **MomijiUI** が要ります。作るのは **Windows のエディタだけ**で、プロジェクトは C++ で作ります（書き出しに Visual Studio が要るため）。いまはベータです。
- UE で動くもの: ブロック 7 種のノベルエディタ・KS 台本と KS 台本エディタ（行の検査 8 種）・ビルドの検査 15 種・UE で動く KS の命令 39 個・選択肢と変数と条件分岐・KSC・セーブとロード・オート・スキップ・ゲームの画面 7 枚（MomijiUI の JSON）・キーボードとマウスとゲームパッド。
- まだできないこと: UE では音が鳴りません（BGM・効果音・声の命令はビルドが通っても何もしない）。エディタの表示は日本語です。詳しくは導入ガイドの §7。
- 同梱の exe（`ThirdParty/Win64/`。KS 台本を組む `kaedevn-ks-compile.exe` と、保存で KS の文字を書く `kaedevn-blocks2ks.exe`）は、外の道具が要らず、ネットワークに出ません。出所は `ThirdParty/Win64/README.md`。
- GitHub のソースのリポジトリ（<https://github.com/kaedeasset/kaedevn>）は Runtime のモジュールだけで、ノベルエディタ（`KaedeVnEditor`）は Fab と Epic の GitHub の UnrealEngine のフォークで配ります。
