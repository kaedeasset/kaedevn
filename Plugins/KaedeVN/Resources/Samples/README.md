# KaedeVN sample work

`Game/` in this folder is a short sample visual novel, *枯れた泉の守り人*
("The Keeper of the Dried Spring", one chapter, one episode), laid out the way
KaedeVN expects a work folder (`WorkRoot`, `Game` by default):

| Path | What it is |
|---|---|
| `Game/works/fantasy_block_demo/` | The work: `work.json` and one chapter folder with one episode (blocks) |
| `Game/ui/` | The game screens (title, menu, table of contents, save, load, manual, config) |
| `Game/assets.json` | Image ids → files (the paths start at the project folder) |
| `Game/assets/` | Two backgrounds and two character sprites |

## Place it in your project

1. Open the novel editor: **Tools → KaedeVN → KaedeVN ノベルエディタ**.
2. Press **見本を置く** ("Place the sample") at the top.
   It copies `Game/` into your work folder (`WorkRoot` in
   **Project Settings → Plugins → KaedeVN**). Files you already have are never
   overwritten; `assets.json` only gets the ids it does not have yet.
3. The work combo shows **枯れた泉の守り人**. Press **▶ プレイ** to build and play it.

▶ プレイ opens the map in `PreviewMap` (when it is empty or the map does not
exist, the map that is open now). If your project has not set a game instance
class, it plays with KaedeVN's own game mode, so nothing has to be set up first.

You can also copy `Game/` by hand into the project folder (with the default
`WorkRoot`). If your `WorkRoot` is not `Game`, use the button: it rewrites the
paths in `assets.json` to your work folder.

The images are covered by [LICENSE-ASSETS.md](LICENSE-ASSETS.md).

---

## 日本語

このフォルダの `Game/` は短い見本のノベル『枯れた泉の守り人』（1 章 1 話）です。KaedeVN の作品の置き場（`WorkRoot`・既定は `Game`）と同じ並びにしてあります。

| 場所 | 中身 |
|---|---|
| `Game/works/fantasy_block_demo/` | 作品（`work.json` と、章のフォルダ 1 つ・話 1 つのブロック） |
| `Game/ui/` | ゲームの画面（タイトル・メニュー・目次・セーブ・ロード・解説書・コンフィグ） |
| `Game/assets.json` | 絵の id → ファイル（パスはプロジェクトのフォルダから） |
| `Game/assets/` | 背景 2 枚と立ち絵 2 枚 |

### プロジェクトに置く

1. **Tools → KaedeVN → KaedeVN ノベルエディタ** を開く。
2. 上の **見本を置く** を押す。`Game/` を作品の置き場（**プロジェクト設定 → Plugins → KaedeVN** の `WorkRoot`）へ写します。前からあるファイルは上書きしません。`assets.json` には、まだ無い id だけを足します。
3. 作品の欄に **枯れた泉の守り人** が出ます。**▶ プレイ** でビルドして遊べます。

▶ プレイは `PreviewMap` のマップを開きます（空か、そのマップが無いときは、今開いているマップ）。プロジェクトに GameInstance のクラスを設定していなければ KaedeVN の GameMode で遊ぶので、先に設定することはありません。

既定の `WorkRoot` なら、`Game/` を手でプロジェクトのフォルダへ写しても同じです。`WorkRoot` が `Game` でなければボタンを使ってください（`assets.json` のパスを作品の置き場に合わせて書き換えます）。

絵のライセンスは [LICENSE-ASSETS.md](LICENSE-ASSETS.md) です。
