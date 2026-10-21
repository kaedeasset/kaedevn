# KaedeVN リファレンス

この説明書は KaedeVN 0.2.0（2026-10-21）のものです。

Unreal Engine の中でノベルゲームを作るプラグイン KaedeVN の、ノベルエディタのブロック・KS 台本の命令・検査・設定の項目を全部引ける説明書です。載せているのは UE で動く範囲だけで、台本に書けても UE で何もしない命令は §4.3 に名前だけを並べています。

- 入れてから見本を動かし、書き出すまでの手順は[導入ガイド](kaedevn-guide.ja.md)にあります。初めての人はそちらから読んでください。
- [English](kaedevn-reference.md)

---

## 目次

1. [このリファレンスの読み方](#1-このリファレンスの読み方)
2. [ノベルエディタの画面](#2-ノベルエディタの画面)
3. [ブロック](#3-ブロック)
4. [KS 台本](#4-ks-台本)
5. [KS 台本エディタ](#5-ks-台本エディタ)
6. [検査](#6-検査)
7. [設定](#7-設定)
8. [書き出し](#8-書き出し)
9. [モジュールとファイル](#9-モジュールとファイル)
10. [まだできないこと](#10-まだできないこと)
11. [同梱物の権利](#11-同梱物の権利)

---

## 1. このリファレンスの読み方

### 1.1 開く

- ノベルエディタ: レベルエディタのメニューの **Tools → KaedeVN → KaedeVN ノベルエディタ**。どのマップを開いていても使えます。
- KS 台本エディタ: **Tools → KaedeVN → KaedeVN KS台本エディタ**、またはコンテンツブラウザで *KaedeVN KS台本プロジェクト* のアセットをダブルクリック。
- プロジェクトの設定: **Edit → Project Settings → Plugins → KaedeVN**（§7.1）。

### 1.2 用語

| 用語 | 意味 |
|---|---|
| 作品 | 1 本のノベル。作品の置き場（§7.1 の `WorkRoot`）の `works/<作品の id>/` の 1 フォルダ |
| 章 | 作品の中のフォルダ（`01_第1章` など）。並びは `work.json` の `chapters` |
| 話 | 章の中の 1 ファイル（`01_枯れた泉.json`）。中身はブロックの列 |
| ブロック | ノベルエディタで置く 1 つの部品（台詞・背景・立ち絵・分岐など。§3） |
| KS 台本 | 文字で書く台本（`.ks`）。1 行に 1 つ、命令か台詞を書く（§4） |
| KSC | KS 台本の中で使える小さなスクリプト（`.ksc`。§4.4） |
| Op | ビルドで作る `scenario.json` の 1 命令。ゲームはこの列を頭から再生する |
| 素材の id | 絵を指す名前。`assets.json` が id から絵のファイルを引く |

### 1.3 表の読み方

- §3〜§7 の表は、源（プラグインのソースと同梱のコンパイラ）から脚本が作っています。項目の数と名前は、この版のプラグインと同じです。
- 「欄」の列はエディタに出る名前です。エディタの表示はいまは日本語です。
- 「出る Op」は、そのブロックや命令がビルドで作る Op の名前です。ゲームが動かないときに `scenario.json` を見る手がかりになります。
- 命令の書き方の `<…>` は書く値、`[…]` は省いてよい部分です。`fade=500` の形の引数は、`fade 500` と空白で分けても同じです。

## 2. ノベルエディタの画面

### 2.1 4 つの区画

| 区画 | 何があるか |
|---|---|
| ① 左 | 作品の中の **章（フォルダ）→ 話（ファイル）** の木。右クリックで章と話を足す・名前を替える・消す |
| ② 中 | 選んだ話の **ブロックの列** |
| ③ 右上 | 選んだブロックの **欄**（§3） |
| ④ 右下 | **プレビュー**（欄を直すとすぐ描き直す） |

上の段には、作品を選ぶ欄（作品:）と、作品の画面の大きさ（解像度: `720p`・`1080p`）、ボタンが並びます。

![ノベルエディタの 4 つの区画（見本の話の台詞を選んだ所）](images/kaedevn/editor-novel.png)


### 2.2 ボタンとキー

| ボタン・キー | 何をするか |
|---|---|
| 新規 | 作品を作る（題を入れる） |
| 見本を置く | 同梱の見本の作品「枯れた泉の守り人」を作品の置き場へ写して開く。前からあるファイルは上書きしない（`assets.json` には、まだ無い id だけを足す） |
| ＋ブロック | 選んだブロックの次にブロックを足す。選んだのが `if`・`choice`・選択肢なら、その中に足す |
| 複製・削除・↑・↓ | ブロックを写す・消す・並べ替える |
| ↶・↷（Ctrl+Z・Ctrl+Y） | 元に戻す・やり直す。履歴は話ごとで、別の話を開くと消える |
| 保存（Ctrl+S） | 話を保存する。同じフォルダに、同じ中身の KS 台本（`.ks`）と KSC（`.ksc`）も書く |
| ビルド | 作品全部（章の順 → 話の順）を `works/<作品の id>/scenario.json` に組み、検査（§6.1）を回す |
| ▶ プレイ | ビルドしてから PIE で遊ぶ。マップは設定の `PreviewMap`（空なら今開いているマップ） |

ビルドの検査の指摘は下の一覧に出ます。行を押すと、その話を開いてそのブロックを選びます。

## 3. ブロック

ノベルエディタの ＋ブロック で置けるブロックと、その欄です。`option`（選択肢）は `choice` の中にだけ置けます。

<!-- kaedevn-ref:begin blocks -->
#### `text`（テキスト）

台詞か地の文を 1 つ出し、クリックを待つ。

| 欄（エディタの名前） | 鍵 | 何を書くか |
|---|---|---|
| 話者(空=地の文) | `speaker` | 話者の名前。空なら地の文。 |
| 本文 | `body` | 本文（複数行も可）。空だとビルドの検査が指摘する。 |

出る Op: `TEXT_APPEND`・`WAIT_CLICK`

#### `bg`（背景）

背景を替える。

| 欄（エディタの名前） | 鍵 | 何を書くか |
|---|---|---|
| 背景アセット | `assetId` | 背景の素材。`assets.json` の背景から選ぶ。 |

出る Op: `BG_SET`

#### `ch`（立ち絵）

立ち絵を出す、または消す。

| 欄（エディタの名前） | 鍵 | 何を書くか |
|---|---|---|
| 立ち絵アセット | `charAssetId` | 立ち絵の素材。`assets.json` の立ち絵から選ぶ。 |
| 位置(L/C/R) | `pos` | 立ち位置。`L`・`C`・`R`。 |
| 表示 | `visible` | 入れれば出す・外せば消す。 |

出る Op: `CH_HIDE`・`CH_SET`

#### `set_var`（変数設定）

変数に入れる・足す・引く。

| 欄（エディタの名前） | 鍵 | 何を書くか |
|---|---|---|
| 変数名 | `varName` | 変数の名前。 |
| 演算子(=,+,-) | `operator` | `=`（入れる）・`+`（足す）・`-`（引く）。 |
| 値 | `value` | 値。 |

出る Op: `VAR_ADD`・`VAR_SUB`・`VAR_SET`

#### `jump`（ジャンプ）

別の話へ飛ぶ。

| 欄（エディタの名前） | 鍵 | 何を書くか |
|---|---|---|
| 遷移先ページID | `toPageId` | 飛び先の話の id。 |

出る Op: `JUMP`

#### `if`（条件分岐）

条件で分ける。中に「合うとき」と「合わないとき」のブロックを置く。

| 欄（エディタの名前） | 鍵 | 何を書くか |
|---|---|---|
| 条件式 | `condition` | 条件の式（KS の `if` と同じ書き方。§4.1）。 |

出る Op: `JUMP_IF`・`JUMP`

#### `choice`

選択肢を出す。中に「選択肢」を置き、それぞれの中に選んだ後のブロックを置く。

欄なし。

出る Op: `CHOICE`・`JUMP`

#### `option`（選択肢）

選択肢 1 つ（`choice` の中にだけ置ける）。

| 欄（エディタの名前） | 鍵 | 何を書くか |
|---|---|---|
| 選択肢テキスト | `text` | ボタンに出る文。空だとビルドの検査が指摘する。 |
<!-- kaedevn-ref:end blocks -->

## 4. KS 台本

KS 台本は 1 話 1 ファイルの文字の台本です。ノベルエディタで保存すると、ブロックから同じ中身の `.ks` が書かれます。KS 台本エディタで直接書くこともできます（§5）。

```
; title: 枯れた泉
*start
@bg forest fade=500
#ナレーション
ルカは、いつもの足取りで村の中央にある泉へと向かっていた。
@l
@ch luca default center
#ルカ
……泉が、枯れている。
@p
@jump next
```

### 4.1 行の種類

<!-- kaedevn-ref:begin ks-lines -->
| 行の種類 | 書き方 | 何をするか |
|---|---|---|
| `COMMENT` | `; メモ`・`// メモ` | 注釈。ゲームには出ない。先頭の `; title: <題>` は話の題になる。 |
| `COMMAND` | `@bg forest` | 命令。`@` に命令の名前と引数を続ける（§4.2）。知らない名前はビルドで誤り。 |
| `TEXT` | `泉が、枯れている。` | 本文。直前の話者の台詞として出る。`名前：台詞` のように全角のコロンで話者を書いてもよい。 |
| `VAR_SET` | `trust = 1`・`trust += 1`・`trust -= 1` | 変数に入れる・足す・引く。`=` は数・`"文字"`・`true`／`false`、`+=`・`-=` は数だけ。 |
| `CHOICE_START` | `choice {` | 選択肢の始まり。中に選択肢を並べ、`}` で閉じる。 |
| `CHOICE_OPTION` | `"一緒に行く" {` | 選択肢 1 つ。`"` で囲んだ文がボタンになり、選ぶと `{` から `}` までを行う。`if (…)` の条件はまだ効かない（警告が出て、いつも出る）。 |
| `CHOICE_END` | `}` | 選択肢・選択肢 1 つ・`if` の区切りを閉じる。 |
| `IF_START` | `if (trust >= 2) {` | 条件で分ける。条件は `変数`（真なら）・`変数 == 数`（`!=`・`>=`・`<=`・`>`・`<`）・`&&`・`\|\|`・`!`・`( )`。 |
| `IF_ELSE` | `} else {` | 条件に合わないときの側。 |
| `IF_END` | `}` | `if` を閉じる（書き方は `CHOICE_END` と同じ `}`。どちらを閉じるかは中身で決まる）。 |
| `LABEL` | `*start` | ラベル。`@jump`・`@call` の飛び先。名前は話（ファイル）ごとに分けられ、別の話からも飛べる。 |
| `SPEAKER` | `#ルカ`・`#` | 話者。続く本文がこの名前の台詞になる。`#` だけの行で話者を外す（地の文）。 |
<!-- kaedevn-ref:end ks-lines -->

### 4.2 命令

`@` で始まる行です。ここに載せたのは、UE のゲームで絵・文字・流れに効く命令だけです。例の `next` はラベル `*next` の名前です。

<!-- kaedevn-ref:begin ks-commands -->
UE で効く命令は 39 個（別名 2 個を除く）。

| 命令 | 何をするか | 出る Op |
|---|---|---|
| `@bg` | 背景を替える。 | `BG_SET`・`BG_CLEAR` |
| `@ch` | 立ち絵を出す。 | `CH_SET` |
| `@ch_hide` | 立ち絵を 1 人消す。 | `CH_HIDE` |
| `@ch_clear` | 立ち絵を全部消す。 | `CH_CLEAR` |
| `@ch_expr` | 出ている立ち絵の表情（ポーズ）だけを替える。 | `CH_EXPR` |
| `@ch_move` | 出ている立ち絵を別の立ち位置へ動かす。 | `CH_MOVE` |
| `@text_clear` | 表示中の本文を消す。 | `TEXT_CLEAR` |
| `@sprite` | 絵（スプライト）を 1 枚、決めた位置に出す。 | `SPRITE_SET` |
| `@sprite_move` | 出ているスプライトを動かす・透かす・拡大する。 | `SPRITE_MOVE` |
| `@sprite_hide` | スプライトを 1 枚消す。 | `SPRITE_HIDE` |
| `@sprite_clear` | スプライトを全部（または片方のレイヤだけ）消す。 | `SPRITE_CLEAR` |
| `@text` | メッセージ枠の外の、決めた位置に文字を出す（場所の名前・日付など）。 | `TEXT_SPRITE_SET` |
| `@ui_show` | MomijiUI の画面（作品の `ui/<id>.json`）を出す。 | `UI_SHOW` |
| `@ui_hide` | `@ui_show` で出した画面を閉じる。 | `UI_HIDE` |
| `@layer` | 背景・立ち絵・重ね絵のレイヤを、まとめて隠す・透かす。 | `LAYER_SET` |
| `@transition` | レイヤの切り替えの溶けこみを始める。 | `TRANSITION` |
| `@wait_transition` | `@transition` が終わるまで待つ。 | `WAIT_TRANSITION` |
| `@mask` | 画面全体を 1 色で覆う（暗転の幕など）。 | `MASK_SET` |
| `@mask_clear` | `@mask` の幕を外す。 | `MASK_CLEAR` |
| `@wait_camera` | `@camera` の動きが終わるまで待つ。 | `WAIT_CAMERA` |
| `@wait` | 決めた時間だけ待つ（クリックでは飛ばせない）。 | `WAIT_MS` |
| `@timeline_play` | タイムライン（複数の動きを時間に沿って並べた演出）を再生し、終わるまで待つ。 | `TIMELINE_PLAY` |
| `@filter`（別名 `@screenFilter`） | 画面全体に色のフィルタをかける。 | `SCREEN_FILTER` |
| `@filter_clear`（別名 `@screenFilterClear`） | 画面のフィルタを外す。 | `SCREEN_FILTER_CLEAR` |
| `@shake` | 画面を揺らす。 | `SHAKE` |
| `@flash` | 画面を一瞬白く光らせる。 | `FLASH` |
| `@fade_black` | 画面を黒へ暗くする（暗転）。 | `FADE_BLACK` |
| `@fade_white` | 画面を白へ飛ばす。 | `FADE_WHITE` |
| `@black_in` | 黒い画面から絵へ明ける。 | `BLACK_IN` |
| `@white_in` | 白い画面から絵へ戻す。 | `WHITE_IN` |
| `@overlay` | 画面の前に絵を重ねる（雨・霧・枠など）。 | `OVERLAY_SET` |
| `@overlay_hide` | 重ねた絵を消す。 | `OVERLAY_HIDE` |
| `@camera` | 画面のカメラを動かす（寄る・ずらす）。 | `CAMERA_SET` |
| `@call` | ラベルへ飛び、そこで `@return` に来たら、この行の次へ戻る（サブルーチン）。 | `CALL` |
| `@return` | `@call` で来た所へ戻る。 | `RETURN` |
| `@jump` | ラベルへ飛ぶ。 | `JUMP` |
| `@l` | クリックを待つ（本文は消さない）。 | `WAIT_CLICK` |
| `@p` | クリックを待ち、本文を消して次のページにする。 | `PAGE` |
| `@r` | 本文を改行する。 | `TEXT_NL` |

#### `@bg`

背景を替える。id を書かない `@bg` だけの行は、背景を消す（`BG_CLEAR`）。

書き方: `@bg <id> [fade=<ms>|slide_left=<ms>|slide_right=<ms>] [x=<n>] [y=<n>] [s=<scale>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `id` | 効く | 背景の素材の id（`assets.json` の鍵）。 |
| `fade` | 効く | 前の背景から溶けるように替える時間（ミリ秒）。 |
| `slide_left` | 効かない | 左へ滑らせて替える。UE では滑らず、書いた時間（ミリ秒）の溶けこみになる。 |
| `slide_right` | 効かない | 右へ滑らせて替える。UE では滑らず、書いた時間（ミリ秒）の溶けこみになる。 |
| `x` | 効かない | 横にずらす量。UE では効かない。 |
| `y` | 効かない | 縦にずらす量。UE では効かない。 |
| `s` | 効かない | 拡大率。UE では効かない。 |

例:

```
@bg forest fade=500
@bg
```

出る Op: `BG_SET`・`BG_CLEAR`

#### `@ch`

立ち絵を出す。同じ名前の立ち絵が出ていれば、ポーズと位置を差し替える。

書き方: `@ch <name> <pose> <pos> [fade=<ms>] [x=<n>] [y=<n>] [s=<scale>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `name` | 効く | 立ち絵の素材の id（`assets.json` の鍵）。 |
| `pose` | 効く | ポーズの名前（見本では `default`）。 |
| `pos` | 効く | 立ち位置。`left`・`center`・`right`（1 文字の `L`・`C`・`R` も可）。 |
| `fade` | 効く | 現れる時間（ミリ秒）。 |
| `x` | 効かない | 横にずらす量。UE では効かない（立ち位置で決まる）。 |
| `y` | 効かない | 縦にずらす量。UE では効かない。 |
| `s` | 効かない | 拡大率。UE では効かない。 |

例:

```
@ch luca default center fade=300
```

出る Op: `CH_SET`

#### `@ch_hide`

立ち絵を 1 人消す。

書き方: `@ch_hide <name> [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `name` | 効く | 消す立ち絵の id。 |
| `fade` | 効かない | 消える時間。UE では効かない（すぐ消える）。 |

例:

```
@ch_hide luca fade=300
```

出る Op: `CH_HIDE`

#### `@ch_clear`

立ち絵を全部消す。

書き方: `@ch_clear [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `fade` | 効かない | 消える時間。UE では効かない（すぐ消える）。 |

例:

```
@ch_clear fade=300
```

出る Op: `CH_CLEAR`

#### `@ch_expr`

出ている立ち絵の表情（ポーズ）だけを替える。位置はそのまま。

書き方: `@ch_expr <name> <expression> [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `name` | 効く | 立ち絵の id。 |
| `expression` | 効く | 新しい表情（ポーズ）の名前。 |
| `fade` | 効く | 切り替わる時間（ミリ秒）。 |

例:

```
@ch_expr luca default fade=200
```

出る Op: `CH_EXPR`

#### `@ch_move`

出ている立ち絵を別の立ち位置へ動かす。動いている間も本文は進められる。

書き方: `@ch_move <name> <pos> [<ms>|time=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `name` | 効く | 立ち絵の id。 |
| `pos` | 効く | 行き先。`left`・`center`・`right`（`L`・`C`・`R` も可）。 |
| `ms` | 効く | 動く時間（ミリ秒）。書かなければ 500。 |
| `time` | 効く | 動く時間（ミリ秒）。`<ms>` と同じ。 |

例:

```
@ch_move luca left time=500
```

出る Op: `CH_MOVE`

#### `@text_clear`

表示中の本文を消す。クリックは待たない（`@p` と違い、すぐ次の行へ進む）。

書き方: `@text_clear [all|current|target=all|target=current]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `all` | 効く | 本文と、まだ表示していない本文の続きも消す（既定）。 |
| `current` | 効く | 表示中の本文だけを消す。 |
| `target` | 効く | `all` か `current` を `target=` で書く形。 |

例:

```
@text_clear all
```

出る Op: `TEXT_CLEAR`

#### `@sprite`

絵（スプライト）を 1 枚、決めた位置に出す。看板・小物・図などに使う。

書き方: `@sprite <id> <storage> [layer=front|back] [x=<n>] [y=<n>] [opacity=<0-1>] [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `id` | 効く | このスプライトの名前（`@sprite_move`・`@sprite_hide` で指す）。 |
| `storage` | 効く | 絵の素材の id（`assets.json` の鍵）。 |
| `layer` | 効く | `front`（立ち絵の前）か `back`（立ち絵の後ろ）。既定 `front`。 |
| `x` | 効く | 左からの位置（論理ピクセル）。 |
| `y` | 効く | 上からの位置（論理ピクセル）。 |
| `opacity` | 効く | 不透明度（0〜1）。既定 1。 |
| `fade` | 効く | 現れる時間（ミリ秒）。 |

例:

```
@sprite sign 01KSHMK3T7F6PTKTEX6DW06WZ7 layer=front x=100 y=80 fade=300
```

出る Op: `SPRITE_SET`

#### `@sprite_move`

出ているスプライトを動かす・透かす・拡大する。書かない引数は今の値のまま。

書き方: `@sprite_move <id> [x=<n>] [y=<n>] [opacity=<0-1>] [scale=<scale>] [time=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `id` | 効く | `@sprite` で付けた名前。 |
| `x` | 効く | 行き先の横の位置（論理ピクセル）。 |
| `y` | 効く | 行き先の縦の位置（論理ピクセル）。 |
| `opacity` | 効く | 行き先の不透明度（0〜1）。 |
| `scale` | 効く | 行き先の拡大率。 |
| `time` | 効く | 動く時間（ミリ秒）。 |

例:

```
@sprite_move sign x=400 time=500
```

出る Op: `SPRITE_MOVE`

#### `@sprite_hide`

スプライトを 1 枚消す。

書き方: `@sprite_hide <id> [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `id` | 効く | `@sprite` で付けた名前。 |
| `fade` | 効く | 消える時間（ミリ秒）。 |

例:

```
@sprite_hide sign fade=300
```

出る Op: `SPRITE_HIDE`

#### `@sprite_clear`

スプライトを全部（または片方のレイヤだけ）消す。

書き方: `@sprite_clear [layer=front|back] [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `layer` | 効く | 消すレイヤ。書かなければ両方。 |
| `fade` | 効く | 消える時間（ミリ秒）。 |

例:

```
@sprite_clear fade=300
```

出る Op: `SPRITE_CLEAR`

#### `@text`

メッセージ枠の外の、決めた位置に文字を出す（場所の名前・日付など）。

書き方: `@text <id> "<text>" [x=<n>] [y=<n>] [size=<n>] [color=#rrggbb] [bold=true] [layer=front|back] [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `id` | 効く | この文字の名前（同じ名前で出し直すと置き換わる。`@sprite_hide` で消せる）。 |
| `text` | 効く | 出す文字。`"` で囲む。`\n` で改行。 |
| `x` | 効く | 左からの位置（論理ピクセル）。 |
| `y` | 効く | 上からの位置（論理ピクセル）。 |
| `size` | 効く | 文字の大きさ。既定 24。 |
| `color` | 効く | 文字の色（`#rrggbb`）。 |
| `bold` | 効く | `true` で太字。 |
| `layer` | 効く | `front` か `back`。既定 `front`。 |
| `fade` | 効く | 現れる時間（ミリ秒）。 |

例:

```
@text place "Chapter 1" x=40 y=40 size=32 color=#ffffff
```

出る Op: `TEXT_SPRITE_SET`

#### `@ui_show`

MomijiUI の画面（作品の `ui/<id>.json`）を出す。

書き方: `@ui_show <screenId> [wait=true]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `screenId` | 効く | 画面の名前（`ui/` の中のファイル名から `.json` を除いたもの）。 |
| `wait` | 効く | `true` で、画面が閉じる（ボタンが押される）まで台本を止める。書かなければ止めずに進む。 |

例:

```
@ui_show menu wait=true
```

出る Op: `UI_SHOW`

#### `@ui_hide`

`@ui_show` で出した画面を閉じる。

書き方: `@ui_hide`

引数なし。

例:

```
@ui_hide
```

出る Op: `UI_HIDE`

#### `@layer`

背景・立ち絵・重ね絵のレイヤを、まとめて隠す・透かす。

書き方: `@layer name=<layer> [visible=true|false] [opacity=<0-1>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `name` | 効く | `background`（`bg`）・`character`（`ch`）・`overlay`（`front`・`sprite`）。ほかの名前は何もしない。 |
| `visible` | 効く | `false` で隠す・`true` で出す。 |
| `opacity` | 効く | レイヤの不透明度（0〜1）。 |

例:

```
@layer name=character visible=false
```

出る Op: `LAYER_SET`

#### `@transition`

レイヤの切り替えの溶けこみを始める。待たずに次へ進むので、終わりを待つには `@wait_transition` を続ける。

書き方: `@transition [target=<layer>] [type=fade] [time=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `target` | 効く | 対象のレイヤ（`@layer` の name と同じ名前）。既定 `overlay`。 |
| `type` | 効かない | 種類。UE では効かない（いつも溶けこみ）。 |
| `time` | 効く | かかる時間（ミリ秒）。 |

例:

```
@transition target=background type=fade time=800
```

出る Op: `TRANSITION`

#### `@wait_transition`

`@transition` が終わるまで待つ。

書き方: `@wait_transition [target=<layer>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `target` | 効く | 待つレイヤ。書かなければ、いちばん新しい切り替え。 |

例:

```
@wait_transition target=background
```

出る Op: `WAIT_TRANSITION`

#### `@mask`

画面全体を 1 色で覆う（暗転の幕など）。

書き方: `@mask [color=#rrggbb] [opacity=<0-1>] [time=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `color` | 効く | 幕の色。既定は黒（`#000000`）。 |
| `opacity` | 効く | 幕の不透明度（0〜1）。既定 1。 |
| `time` | 効く | 幕が下りる時間（ミリ秒）。 |

例:

```
@mask color=#000000 opacity=1 time=500
```

出る Op: `MASK_SET`

#### `@mask_clear`

`@mask` の幕を外す。

書き方: `@mask_clear [time=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `time` | 効く | 幕が上がる時間（ミリ秒）。 |

例:

```
@mask_clear time=500
```

出る Op: `MASK_CLEAR`

#### `@wait_camera`

`@camera` の動きが終わるまで待つ。

書き方: `@wait_camera`

引数なし。

例:

```
@wait_camera
```

出る Op: `WAIT_CAMERA`

#### `@wait`

決めた時間だけ待つ（クリックでは飛ばせない）。

書き方: `@wait <sec>`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `sec` | 効く | 待つ秒数（小数も可。`sec=1.5` の形でもよい）。 |

例:

```
@wait 1.5
```

出る Op: `WAIT_MS`

#### `@timeline_play`

タイムライン（複数の動きを時間に沿って並べた演出）を再生し、終わるまで待つ。`scenario.json` と同じフォルダの `timelines.json` から id で引く。無い id は何もせず先へ進む。

書き方: `@timeline_play <timelineId>`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `timelineId` | 効く | タイムラインの id。 |
| `id` | 効く | `id=<timelineId>` の形でも書ける。 |

例:

```
@timeline_play opening
```

出る Op: `TIMELINE_PLAY`

#### `@filter`

画面全体に色のフィルタをかける。UE で効く名前は `grayscale`（`mono`）・`sepia`・`warm`（`morning`）・`cool`（`night`）。

別名: `@screenFilter`（同じ働き）。

書き方: `@filter <type> [<intensity>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `type` | 効く | フィルタの名前（上の 4 つ）。`sepia=0.7` のように強さを `=` で付けてもよい。 |
| `intensity` | 効く | 強さ（0〜1）。既定 1。 |
| `tiling` | 効かない | 絵を敷き詰めるフィルタ用の印。UE では効かない（`key=値` の追加の項目も、UE では使わない）。 |

例:

```
@filter sepia 0.8
```

出る Op: `SCREEN_FILTER`

#### `@filter_clear`

画面のフィルタを外す。

別名: `@screenFilterClear`（同じ働き）。

書き方: `@filter_clear`

引数なし。

例:

```
@filter_clear
```

出る Op: `SCREEN_FILTER_CLEAR`

#### `@shake`

画面を揺らす。揺れ終わるまで待つ。

書き方: `@shake [<intensity>] [<duration>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `intensity` | 効く | 揺れの幅（論理ピクセル・整数）。既定 5。`intensity=8` の形でもよい。 |
| `duration` | 効く | 揺れる時間（ミリ秒）。既定 300。`duration=400` の形でもよい。 |

例:

```
@shake 8 400
```

出る Op: `SHAKE`

#### `@flash`

画面を一瞬白く光らせる。終わるまで待つ。

書き方: `@flash [<duration>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `duration` | 効く | 光る時間（ミリ秒）。既定 200。`duration=` の形でもよい。 |

例:

```
@flash 200
```

出る Op: `FLASH`

#### `@fade_black`

画面を黒へ暗くする（暗転）。終わるまで待つ。戻すのは `@black_in`。

書き方: `@fade_black [<duration>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `duration` | 効く | 暗くなる時間（ミリ秒）。既定 500。 |

例:

```
@fade_black 500
```

出る Op: `FADE_BLACK`

#### `@fade_white`

画面を白へ飛ばす。終わるまで待つ。戻すのは `@white_in`。

書き方: `@fade_white [<duration>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `duration` | 効く | 白くなる時間（ミリ秒）。既定 500。 |

例:

```
@fade_white 500
```

出る Op: `FADE_WHITE`

#### `@black_in`

黒い画面から絵へ明ける。終わるまで待つ。

書き方: `@black_in [<duration>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `duration` | 効く | 明ける時間（ミリ秒）。既定 500。 |

例:

```
@black_in 500
```

出る Op: `BLACK_IN`

#### `@white_in`

白い画面から絵へ戻す。終わるまで待つ。

書き方: `@white_in [<duration>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `duration` | 効く | 戻る時間（ミリ秒）。既定 500。 |

例:

```
@white_in 500
```

出る Op: `WHITE_IN`

#### `@overlay`

画面の前に絵を重ねる（雨・霧・枠など）。同じ id を出し直すと、位置と倍率を差し替える。

書き方: `@overlay <id> [fade=<ms>] [x=<n>] [y=<n>] [s=<scale>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `id` | 効く | 重ねる絵の素材の id（`assets.json` の鍵）。 |
| `fade` | 効く | 現れる時間（ミリ秒）。 |
| `x` | 効く | 横にずらす量（論理ピクセル）。 |
| `y` | 効く | 縦にずらす量（論理ピクセル）。 |
| `s` | 効く | 拡大率（1 が等倍）。 |

例:

```
@overlay rain fade=300
```

出る Op: `OVERLAY_SET`

#### `@overlay_hide`

重ねた絵を消す。id を書かなければ全部。

書き方: `@overlay_hide [<id>] [fade=<ms>]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `id` | 効く | 消す絵の id。 |
| `fade` | 効く | 消える時間（ミリ秒）。 |

例:

```
@overlay_hide rain fade=300
```

出る Op: `OVERLAY_HIDE`

#### `@camera`

画面のカメラを動かす（寄る・ずらす）。待たずに次へ進むので、終わりを待つには `@wait_camera` を続ける。

書き方: `@camera [x=<n>] [y=<n>] [zoom=<scale>] [time=<ms>] [reset]`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `x` | 効く | 横の位置（論理ピクセル）。書かなければ今のまま。 |
| `y` | 効く | 縦の位置（論理ピクセル）。書かなければ今のまま。 |
| `zoom` | 効く | 寄りの倍率（1 が等倍）。 |
| `time` | 効く | 動く時間（ミリ秒）。 |
| `reset` | 効く | 初めの位置と倍率へ戻す（ほかの引数より先に効く）。 |
| `pivotX` | 効かない | 寄るときの中心の横の位置。UE では効かない。 |
| `pivotY` | 効かない | 寄るときの中心の縦の位置。UE では効かない。 |
| `easing` | 効かない | 動きの緩急の名前。UE では効かない（一定の動き）。 |
| `shake` | 効かない | カメラの揺れ。UE では効かない（揺らすのは `@shake`）。 |

例:

```
@camera zoom=1.5 x=100 y=0 time=800
```

出る Op: `CAMERA_SET`

#### `@call`

ラベルへ飛び、そこで `@return` に来たら、この行の次へ戻る（サブルーチン）。

書き方: `@call <label>`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `label` | 効く | 飛び先のラベルの名前（`*` を付けない）。 |

例:

```
@call next
```

出る Op: `CALL`

#### `@return`

`@call` で来た所へ戻る。`@call` で来ていなければ台本を終える。

書き方: `@return`

引数なし。

例:

```
@return
```

出る Op: `RETURN`

#### `@jump`

ラベルへ飛ぶ。別の話（別のファイル）のラベルへも飛べる。

書き方: `@jump <label>`

| 引数 | UE で | 何を書くか |
|---|---|---|
| `label` | 効く | 飛び先のラベルの名前（`*` を付けない）。 |

例:

```
@jump next
```

出る Op: `JUMP`

#### `@l`

クリックを待つ（本文は消さない）。本文の行の終わりに `@l` と続けて書くこともできる。

書き方: `@l`

引数なし。

例:

```
@l
```

出る Op: `WAIT_CLICK`

#### `@p`

クリックを待ち、本文を消して次のページにする。

書き方: `@p`

引数なし。

例:

```
@p
```

出る Op: `PAGE`

#### `@r`

本文を改行する。

書き方: `@r`

引数なし。

例:

```
@r
```

出る Op: `TEXT_NL`
<!-- kaedevn-ref:end ks-commands -->

### 4.3 UE ではまだ動かない命令

次の命令は、台本に書けばビルドは通りますが、UE のゲームでは何も起きません（Live2D・VRM・粒子・RPG のマップなど、ほかの再生のための命令と、まだ UE で音を鳴らしていない音の命令）。UE の再生がこれを読み飛ばしても、台本はそのまま先へ進みます。

<!-- kaedevn-ref:begin ks-ignored -->
37 個。台本に書いてもコンパイルは通るが、UE のゲームでは何も起きない。

| 命令 | 出る Op | UE での扱い | 元の用途 |
|---|---|---|---|
| `@ch_anim` | `CH_ANIM` | UE の再生が受け取って何もしない | 立ち絵の連番の絵を動かす（旧ブラウザ版の機能）。 |
| `@ch_lip` | `CH_LIP` | UE の再生が知らない Op（読み飛ばす） | 口の動き（口パク）を切り替える（Live2D・VRM 用）。 |
| `@ch_motion` | `CH_MOTION` | UE の再生が知らない Op（読み飛ばす） | 立ち絵のモデルにモーションをさせる（Live2D・VRM 用）。 |
| `@ch_param` | `CH_PARAM` | UE の再生が知らない Op（読み飛ばす） | 立ち絵のモデルの値を 1 つ動かす（Live2D 用）。 |
| `@ch_state` | `CH_STATE` | UE の再生が知らない Op（読み飛ばす） | 立ち絵の重ねた部品の状態を替える（目・口などの差分用）。 |
| `@live2d` | `LIVE2D_SET` | UE の再生が受け取って何もしない | Live2D のモデルを出す。 |
| `@live2d_hide` | `LIVE2D_HIDE` | UE の再生が受け取って何もしない | Live2D のモデルを消す。 |
| `@live2d_motion` | `LIVE2D_MOTION` | UE の再生が受け取って何もしない | Live2D のモデルにモーションをさせる。 |
| `@live2d_expression` | `LIVE2D_EXPRESSION` | UE の再生が受け取って何もしない | Live2D のモデルの表情を替える。 |
| `@particle` | `PARTICLE_EMIT` | UE の再生が受け取って何もしない | 粒子の演出（花びら・火の粉など）を出す。 |
| `@particle_stop` | `PARTICLE_STOP` | UE の再生が受け取って何もしない | 粒子の演出を止める。 |
| `@effect` | `EFFECT_PLAY` | UE の再生が知らない Op（読み飛ばす） | 演出の定義ファイル（effect.json）を再生する。 |
| `@slash` | `SLASH_EMIT` | UE の再生が知らない Op（読み飛ばす） | 斬撃の軌跡を描く演出。 |
| `@color_adjust` | `COLOR_ADJUST` | UE の再生が受け取って何もしない | 画面の明るさ・コントラスト・彩度・色温度を変える。 |
| `@bgm` | `BGM_PLAY` | UE の再生は名前や色を覚える（セーブに入る）だけで、音も絵も出ない | BGM を流す。 |
| `@bgm_stop` | `BGM_STOP` | UE の再生は名前や色を覚える（セーブに入る）だけで、音も絵も出ない | BGM を止める。 |
| `@se` | `SE_PLAY` | UE の再生の受け口の中身が空（何もしない） | 効果音を鳴らす。 |
| `@se_stop` | `SE_STOP` | UE の再生に受け口が無い（既定の空のまま） | 効果音を止める。 |
| `@voice` | `VOICE_PLAY` | UE の再生の受け口の中身が空（何もしない） | 声を鳴らす。 |
| `@wait_voice_end` | `WAIT_VOICE_END` | UE の再生が受け取って何もしない | 声が鳴り終わるまで待つ。 |
| `@battle` | `BATTLE_START` | UE の再生に処理が無い（読み飛ばす） | 戦闘を始める（RPG 用。KaedeRPG の物語の話が使う）。 |
| `@filter_mix` | `FILTER_MIX` | UE の再生に処理が無い（読み飛ばす） | フィルタを重ねてかける。 |
| `@map_load` | `MAP_LOAD` | UE の再生が受け取って何もしない | マップを開く（RPG 用）。 |
| `@map_exit` | `MAP_EXIT` | UE の再生が受け取って何もしない | マップを出る（RPG 用）。 |
| `@player_move` | `PLAYER_MOVE` | UE の再生が受け取って何もしない | 主人公を歩かせる（RPG 用）。 |
| `@event_move` | `EVENT_MOVE` | UE の再生が受け取って何もしない | マップの上のイベントを動かす（RPG 用）。 |
| `@item_add` | `ITEM_ADD` | UE の再生が受け取って何もしない | 持ち物を増やす（RPG 用）。 |
| `@item_remove` | `ITEM_REMOVE` | UE の再生が受け取って何もしない | 持ち物を減らす（RPG 用）。 |
| `@layout_set` | `LAYOUT_SET` | UE の再生が受け取って何もしない | 画面の配置を切り替える（旧ブラウザ版の機能）。 |
| `@call_template` | `CALL_TEMPLATE` | UE の再生が受け取って何もしない | 共通の場面（テンプレート）を呼ぶ（旧ブラウザ版の機能）。 |
| `@scroll_text` | `SCROLL_TEXT` | UE の再生が受け取って何もしない | 文字を下から上へ流す（スタッフロールなど）。 |
| `@sceneMode` | `SCENE_MODE` | UE の再生に受け口が無い（既定の空のまま） | 2D と 3D モデル（VRM）の表示を切り替える。 |
| `@text_style` | `TEXT_STYLE` | UE の再生は名前や色を覚える（セーブに入る）だけで、音も絵も出ない | メッセージ枠と名前枠の色を替える。 |
| `@vrmShow` | `VRM_SHOW` | UE の再生に受け口が無い（既定の空のまま） | VRM の 3D モデルを出す。 |
| `@vrmHide` | `VRM_HIDE` | UE の再生に受け口が無い（既定の空のまま） | VRM のモデルを消す。 |
| `@vrmExpression` | `VRM_EXPRESSION` | UE の再生に受け口が無い（既定の空のまま） | VRM のモデルの表情を替える。 |
| `@vrmPose` | `VRM_POSE` | UE の再生に受け口が無い（既定の空のまま） | VRM のモデルの姿勢を替える。 |
<!-- kaedevn-ref:end ks-ignored -->

### 4.4 KSC

`.ksc` の中で呼べる関数のうち、UE の再生が受け取るものです。ここに無い関数は、UE では呼んでも何もせずに先へ進みます。

<!-- kaedevn-ref:begin ksc-builtins -->
35 個（うち 5 個は UE では何も出ない）。

| 関数 | 引数 | 待つか | UE で | 何をするか |
|---|---|---|---|---|
| `showDialogue` | speaker, lines | 待つ | 効く | 台詞を出し、クリックを待つ。`lines` の各行を改行でつないで出す。 |
| `setBg` | name, effect | 待つ | 効く | 背景を替える。`effect` に `fade`・`slide_left`・`slide_right` のどれかを書くと 0.5 秒で替わる（UE ではどれも溶けこみ）。 |
| `showChar` | name, pose, position, fadeMs | 待つ | 効く | 立ち絵を出す（`@ch` と同じ）。 |
| `showCharAnim` | name, pose, position | 待つ | 効く | UE では動く絵にならず、`showChar` と同じ止まった立ち絵になる。 |
| `hideChar` | name, fadeMs | 待つ | 効く | 立ち絵を 1 人消す。 |
| `clearChars` | fadeMs | 待つ | 効く | 立ち絵を全部消す。 |
| `moveChar` | name, position, time | 待つ | 効く | 立ち絵を動かす（`@ch_move` と同じ。待たない）。 |
| `playBgm` | name, vol, fadeMs | すぐ | 何も出ない | BGM を流す。UE ではいまは曲の名前を覚えるだけで、鳴らない。 |
| `stopBgm` | — | すぐ | 何も出ない | BGM を止める（UE では覚えた曲の名前を消すだけ）。 |
| `fadeBgm` | time | 待つ | 何も出ない | BGM を消していく（UE では `stopBgm` と同じ）。 |
| `playSe` | name, vol | すぐ | 何も出ない | 効果音を鳴らす。UE ではいまは何もしない。 |
| `playVoice` | name | すぐ | 何も出ない | 声を鳴らす。UE ではいまは何もしない。 |
| `showChoice` | options | 待つ | 効く | 選択肢を出し、選んだ番号（0 から）を返す。 |
| `waitForClick` | — | 待つ | 効く | クリックを待つ。 |
| `wait` | ms | 待つ | 効く | 決めた時間（ミリ秒）だけ待つ。 |
| `setFlag` | key, val | すぐ | 効く | 旗（名前つきの値）を立てる。 |
| `getFlag` | key | すぐ | 効く | 旗の値を返す。無ければ空。 |
| `giveItem` | id, n | すぐ | 効く | 持ち物の数を増やす（台本の中だけの数え）。 |
| `takeItem` | id, n | すぐ | 効く | 持ち物の数を減らす。足りなければ減らさず false を返す。 |
| `hasItem` | id | すぐ | 効く | 持ち物が 1 つ以上あれば true。 |
| `screenFilter` | type, intensity | すぐ | 効く | 画面のフィルタをかける（`@filter` と同じ）。 |
| `filter` | type, intensity | すぐ | 効く | `screenFilter` の別名。 |
| `screenFilterClear` | — | すぐ | 効く | 画面のフィルタを外す。 |
| `filter_clear` | — | すぐ | 効く | `screenFilterClear` の別名。 |
| `shake` | intensity, durationMs | 待つ | 効く | 画面を揺らし、終わるまで待つ。 |
| `floor` | x | すぐ | 効く | 小数を切り下げる。 |
| `ceil` | x | すぐ | 効く | 小数を切り上げる。 |
| `round` | x | すぐ | 効く | 四捨五入する。 |
| `trunc` | x | すぐ | 効く | 小数の部分を捨てる。 |
| `abs` | x | すぐ | 効く | 絶対値。 |
| `sign` | x | すぐ | 効く | 正なら 1・0 なら 0・負なら -1。 |
| `sqrt` | x | すぐ | 効く | 平方根。 |
| `min` | a, b | すぐ | 効く | 小さいほう。 |
| `max` | a, b | すぐ | 効く | 大きいほう。 |
| `clamp` | x, lo, hi | すぐ | 効く | `lo` 以上 `hi` 以下に収める。 |
<!-- kaedevn-ref:end ksc-builtins -->

## 5. KS 台本エディタ

### 5.1 画面

KS 台本エディタは、台本の行を木で見せ、選んだ行の欄・プレビュー・検査（§6.2）を並べる画面です。

- 行の種類は 6 つ: 空行・注釈（`;`）・ラベル（`*`）・タグ（`@` の命令）・話者（`#`）・本文。
- 本文と話者の行には専用の欄があります。タグの行は、下の表のタグなら専用の欄、ほかのタグとラベル・注釈は「行テキスト」の欄で 1 行をそのまま直します。
- 欄を直しても、その行のほかの引数（知らない `key=value`）は消えずに残ります。エディタはほかの行と整形に手を触れません（台本の正は文字のファイル）。
- ＋行追加・行削除・↑・↓・＋ページ・ページ削除・保存・ビルド（`kaedevn-ks-compile.exe` で `scenario.json` に組む）。

![KS 台本エディタ。左が台本の木（足した無い絵の行 `@bg bg_typo` に付いた検査の印は例）・中がプレビュー・右が選んだ行の欄](images/kaedevn/editor-ks.png)


### 5.2 専用の欄のあるタグ

<!-- kaedevn-ref:begin ks-editor-tags -->
| タグ | 欄（エディタの名前） | 何を書くか |
|---|---|---|
| `@bg` | 背景slug | 背景（`@bg`）。素材の候補から選べる。 |
| `@ch` | キャラslug・表情・位置(left/center/right) | 立ち絵（`@ch`）。キャラ・表情・位置。 |
| `@jump` | ジャンプ先 | ジャンプ（`@jump`）の飛び先。 |
| `@sprite_clear` | レイヤ(空=全部)・フェードms | スプライトを全部消す（`@sprite_clear`）。レイヤとフェード。 |
| `@text_clear` | 対象(all/current) | 本文を消す（`@text_clear`）。対象。 |
| `@ch_expr` | キャラslug・表情・フェードms | 表情の差し替え（`@ch_expr`）。キャラ・表情・フェード。 |
| `@text` | id・本文・X・Y・文字サイズ・色(#rrggbb)・太字(true/空)・レイヤ(front/back)・フェードms | 決めた位置の文字（`@text`）。id・本文・位置・大きさ・色・太字・レイヤ・フェード。 |
| `@sprite` | id（move/hideの対象名）・画像slug・レイヤ(front/back)・X・Y・不透明度(0..1)・フェードms | スプライト（`@sprite`）。id・絵・レイヤ・位置・不透明度・フェード。 |
| `@sprite_move` | id・X（空=現在値）・Y（空=現在値）・不透明度(0..1)・拡大率・所要ms | スプライトを動かす（`@sprite_move`）。空の欄は今の値のまま。 |
| `@sprite_hide` | id・フェードms | スプライトを消す（`@sprite_hide`）。 |
| `@timeline_play` | タイムラインid | タイムラインの再生（`@timeline_play`）。 |
| `@wait` | 待ち時間ms | 待つ（`@wait`）。欄はミリ秒で、行には秒で書かれる。 |
| `@ch_hide` | キャラslug・フェードms | 立ち絵を消す（`@ch_hide`）。 |
| `@ch_move` | キャラslug・位置(left/center/right)・所要ms | 立ち絵を動かす（`@ch_move`）。 |
| `@mask` | 色(#rrggbb)・不透明度(0..1)・所要ms | 幕（`@mask`）。色・不透明度・時間。 |
| `@mask_clear` | 所要ms | 幕を外す（`@mask_clear`）。 |
| `@transition` | 対象レイヤ・種類(fade)・所要ms | 切り替えの溶けこみ（`@transition`）。 |
| `@layer` | レイヤ名(background/character/overlay)・表示(true/false)・不透明度(0..1) | レイヤを隠す・透かす（`@layer`）。 |
| `@se` | SE slug | 効果音（`@se`）。UE ではまだ鳴らない（§4.3）。 |
| `@call` | 呼び出し先 | サブルーチンの呼び出し（`@call`）の飛び先。 |
| `@ch_clear` | フェードms | 立ち絵を全部消す（`@ch_clear`）。 |
| `@wait_transition` | 対象レイヤ(空=直近) | 切り替えの終わりを待つ（`@wait_transition`）。 |
| `@shake` | 強さ(論理px)・所要ms | 画面を揺らす（`@shake`）。強さと時間。 |
<!-- kaedevn-ref:end ks-editor-tags -->

## 6. 検査

### 6.1 ビルドの検査

ノベルエディタのビルドが見る点です。どれもビルドは止めません（組めて、遊ぶとおかしくなる所を知らせます）。素材が見つからない検査は、作品の `assets.json` を読めたときだけ働きます。

![ビルドの指摘の一覧（見本の写しに誤りを 2 つ入れてビルドし、1 つ目の指摘を押した所）](images/kaedevn/editor-build-checks.png)


<!-- kaedevn-ref:begin build-checks -->
15 種。

| 出る文 | 意味と直し方 |
|---|---|
| 話/ページ id が重複しています: "<名前>"（jump は最初の1つにしか飛べません） | 2 つの話が同じ id を持っている。jump は最初の話にしか着かない。片方の話の id を替える。 |
| jump 先の話が見つかりません: "<名前>"（シナリオ終端へ解決されます） | ジャンプ先の話が無い。遊ぶとそこで終わる。ジャンプの「遷移先ページID」を、ある話の id に直す。 |
| 内部ラベル未解決: <名前>（コンパイラ不具合の可能性） | エディタの中で作る飛び先が見つからない（エディタの不具合の疑い）。話を保存し直してもう一度ビルドし、残れば不具合として知らせる。 |
| ブロックid が重複しています: "<名前>" | 2 つのブロックが同じ id を持っている。片方を消して作り直す。 |
| 本文が空です（クリック待ちだけが挟まります） | テキストのブロックの本文が空。遊ぶと何も出ないままクリックを待つ。本文を書くか、ブロックを消す。 |
| 変数名が未指定です（この代入は効きません） | 変数設定のブロックに変数の名前が無い。名前を書く。 |
| jump 先が未指定です（シナリオ終端へ飛びます） | ジャンプのブロックに飛び先が無い。遊ぶとそこで終わる。飛び先の話を選ぶ。 |
| 条件が空です（分岐が意図どおりに働きません） | 条件分岐のブロックに条件が無い。条件の式を書く。 |
| 選択肢がありません（実行時に進行不能になる可能性） | 選択肢のブロックの中に選択肢が 1 つも無い。遊ぶと先へ進めなくなる。選択肢を足す。 |
| 選択肢のテキストが空です（選べない選択肢になります） | 選択肢の文が空。ボタンに何も出ない。文を書く。 |
| 未対応のブロック種別です: "<名前>"（このブロックは出力されません） | ノベルエディタが組めない種類のブロックがある（古い作品の効果・画面フィルター・オーバーレイなど）。遊ぶときは飛ばされる。消すか、KS で同じことを書く。 |
| 背景アセットが未指定です（背景が変わりません） | 背景のブロックで素材が選ばれていない。素材を選ぶ。 |
| 背景アセットが見つかりません: "<名前>"（実行時に背景が出ません） | 背景の素材の id が `assets.json` に無い。`assets.json` に足すか、ある素材を選ぶ。 |
| 立ち絵アセットが未指定です | 立ち絵のブロックで素材が選ばれていない。素材を選ぶ。 |
| 立ち絵アセットが見つかりません: "<名前>"（実行時に立ち絵が出ません） | 立ち絵の素材の id が `assets.json` に無い。`assets.json` に足すか、ある素材を選ぶ。 |
<!-- kaedevn-ref:end build-checks -->

### 6.2 KS の検査

KS 台本エディタが行ごとに付ける印です。エラーはビルドか遊ぶときに壊れる所、警告は画面が崩れる所、情報は誤りではないが気を付ける所です。

<!-- kaedevn-ref:begin ks-lint -->
8 種。

| 重さ | 出る文 | 意味と直し方 |
|---|---|---|
| エラー | 未定義のアセットslug: <名前> | `@bg` などの素材の名前が、作品の素材の一覧に無い。名前を直すか素材を足す。 |
| エラー | 未定義のキャラslug: <名前> | `@ch` のキャラの名前が素材の一覧に無い。 |
| 警告 | スロット衝突: <名前> は <名前> が使用中 | その立ち位置には別のキャラが出ている。先に消すか別の位置にする。 |
| 警告 | 同時立ち絵が3体を超過（<数>体） | 立ち絵が 4 人以上同時に出ている（立ち位置は 3 つ）。 |
| エラー | ジャンプ先ファイルが存在しない: <名前> | `@jump` の飛び先のファイルが無い。 |
| エラー | ジャンプ先ラベルが <名前> に無い: <名前> | 飛び先のファイルにそのラベルが無い。 |
| エラー | ファイル内ラベルが無い: <名前> | 同じファイルの中にそのラベルが無い。 |
| 情報 | 次ファイルへ立ち絵<数>体を持ち越し（演出継続として合法） | 話の終わりで立ち絵が出たまま次の話へ続く。誤りではない（わざとなら直さなくてよい）。 |
<!-- kaedevn-ref:end ks-lint -->

## 7. 設定

### 7.1 プロジェクトの設定

**Edit → Project Settings → Plugins → KaedeVN**。既定はプラグインの `Config/DefaultKaedeVN.ini` にあり、プロジェクトの `Config/DefaultKaedeVN.ini` で上書きします。

<!-- kaedevn-ref:begin settings -->
| 項目 | 既定 | 何を書くか |
|---|---|---|
| `WorkRoot` | `Game` | 作品のデータ（`works/`・`ui/`・`assets.json`・台本）の置き場。プロジェクトの直下からの相対（絶対でもよい）。書き出しでは、この置き場を UFS に入れる（§8）。 |
| `PreviewMap` | 空 | ノベルエディタの ▶ プレイで開くマップ（例 `/Game/Map/MyNovelMap`）。空なら今開いているマップで遊ぶ。 |
<!-- kaedevn-ref:end settings -->

### 7.2 作品のデータの鍵

作品の置き場の中のファイルです（見本の作品から拾った鍵）。ノベルエディタの「解像度」を選ぶと、`work.json` に画面の大きさ（`screen`）が書かれ、ビルドで `scenario.json` に渡ります。

<!-- kaedevn-ref:begin work-keys -->
| ファイル | 鍵 | 何を書くか |
|---|---|---|
| `work.json` | `id` | 作品の id（フォルダ名と同じにする）。 |
| `work.json` | `title` | 作品の題。 |
| `work.json` | `chapters` | 章のフォルダの名前を、並べる順に。 |
| `work.json` | `assets` | 作品だけで使う素材の一覧（見本では空。素材は `assets.json` に書く）。 |
| `work.json` | `schemaVersion` | 形の版（いまは 2）。手で変えない。 |
| `<話>.json` | `id` | 話の id（ジャンプの飛び先に使う）。 |
| `<話>.json` | `name` | 話の名前（エディタの木に出る）。 |
| `<話>.json` | `blocks` | ブロックの列（§3）。 |
| `assets.json` | `<素材の id>` | 素材の id → 絵のファイルの道（プロジェクトの直下からの相対。例 `Game/assets/bg/forest.png`）。 |
<!-- kaedevn-ref:end work-keys -->

### 7.3 ゲームのコンフィグ画面

見本の作品のコンフィグ画面（`ui/config.json`）の項目です。画面は MomijiUI の JSON なので、作品ごとに項目を増やし・減らせます。

<!-- kaedevn-ref:begin config-items -->
17 項目。UE のゲームが反映するのは 4 項目で、残りは画面で選べるが UE のゲームは使わない。

| 項目 | タブ | 取りうる値 | UE が反映するか | 何を変えるか |
|---|---|---|---|---|
| `msgSpeed` | テキスト | 0〜1（つまみ） | 反映する | 文字の出る速さ。 |
| `autoSpeed` | テキスト | 0〜1（つまみ） | 使わない | オートで次へ進むまでの間。 |
| `msgWinOpacity` | テキスト | 0〜1（つまみ） | 使わない | メッセージ枠の濃さ。 |
| `skipUnread` | テキスト | 入・切 | 使わない | まだ読んでいない文もスキップするか。 |
| `fontSize` | テキスト | 小・中・大（左から 0〜2） | 使わない | 文字の大きさ。 |
| `fontFace` | テキスト | ゴシック・明朝（左から 0〜1） | 反映する | 書体（ゴシック・明朝）。 |
| `masterVol` | 音声 | 0〜1（つまみ） | 使わない | 全体の音量。 |
| `bgmVol` | 音声 | 0〜1（つまみ） | 使わない | BGM の音量。 |
| `seVol` | 音声 | 0〜1（つまみ） | 使わない | 効果音の音量。 |
| `voiceVol` | 音声 | 0〜1（つまみ） | 使わない | 声の音量。 |
| `stopVoiceOnAdvance` | 音声 | 入・切 | 使わない | 次へ進んだら声を止めるか。 |
| `fullscreen` | 表示 | 入・切 | 使わない | 全画面にするか。 |
| `resolution` | 表示 | 720p・900p・1080p（左から 0〜2） | 反映する | 窓の大きさ。 |
| `textArea` | 表示 | 標準・広い（左から 0〜1） | 使わない | 本文の枠の広さ。 |
| `autosave` | システム | 入・切 | 使わない | 自動でセーブするか。 |
| `lang` | システム | 日本語・English（左から 0〜1） | 使わない | 画面の言語。 |
| `uiTheme` | システム | atelier・midnight・sakura（左から 0〜2） | 反映する | 画面の配色。 |
<!-- kaedevn-ref:end config-items -->

## 8. 書き出し

- ゲームの土台は `KaedeVnHost` モジュールの GameInstance・GameMode・PlayerController です。GameInstance を設定していないプロジェクトでも、GameMode を `KaedeVnGameMode` にすれば、PlayerController がノベルの画面を載せます。操作（進む・選ぶ・戻る・オート・スキップ・クイックセーブ／ロード・メニュー）は Enhanced Input でプラグインが割り当てます。
- 作品の置き場（§7.1 の `WorkRoot`）を UFS に入れます。既定の `Game` なら、プロジェクトの `Config/DefaultGame.ini` の `[/Script/UnrealEd.ProjectPackagingSettings]` に `+DirectoriesToAlwaysStageAsUFS=(Path="../Game")` の 1 行。この行が無いと、書き出したゲームは起動しても台本が見つかりません。
- 書き出しの命令（RunUAT の BuildCookRun）には `-nodebuginfo` を付けます。付けないと PDB がアーカイブに入り、大きくなります。
- アーカイブの置き場は回ごとに空になりません。大きさを測る前に `Saved/Package` と `Saved/StagedBuilds` を空にします。
- 書き出したゲームのログとセーブは、`.exe` の隣でなく `%LOCALAPPDATA%\<プロジェクト名>\Saved` に書かれます。

## 9. モジュールとファイル

| モジュール | 種類 | 何をするか |
|---|---|---|
| `KaedeVnCore` | Runtime | 再生（Op を頭から実行する・セーブとロード）。描画から切り離してあり、自動試験がある |
| `KaedeKsc` | Runtime | KSC を動かす小さな VM と、その UE の受け口 |
| `KaedeVnUI` | Runtime | ノベルの画面の描画（MomijiUI の上） |
| `KaedeVnHost` | Runtime | 書き出したノベルの GameInstance・GameMode・PlayerController |
| `KaedeShaders` | Runtime（PostConfigInit） | シェーダーの置き場 `/Kaede` |
| `KaedeVnEditor` | Editor | ノベルエディタと KS 台本エディタ。Windows のエディタだけ |

同梱の exe（`ThirdParty/Win64/`。ネットワークには出ない。出所と作り直し方は `ThirdParty/Win64/README.md`、同じ物かは `SHA256SUMS.txt` で確かめる）:

| exe | いつ使うか |
|---|---|
| `kaedevn-ks-compile.exe` | KS 台本エディタのビルド。`.ks` をつないで `scenario.json` に組む |
| `kaedevn-blocks2ks.exe` | ノベルエディタの保存。話のブロックから `.ks`・`.ksc` を書く |
| `kaedevn-ksc-service.exe` | ゲームの中で KSC の命令を組む |

画面の描画と書体は MomijiUI プラグインです（Fab の無料の商品。KaedeVN の `.uplugin` が有効にします）。

## 10. まだできないこと

- 作るのは Windows のエディタだけです（Mac・Linux のエディタでは作れません）。
- エディタの表示は日本語です。このリファレンスの英語版は欄の名前を英語で説明しています。
- §4.3 の命令は UE では何もしません。BGM・効果音・声の命令もその中にあり、いまの UE の再生は音を鳴らしません（BGM の名前はセーブに入りますが、鳴りません）。
- §4.2 の命令でも、引数の表で「効かない」とした引数は UE では使いません（背景と立ち絵の位置ずらし・拡大、背景の滑らせる切り替え、立ち絵が消えるときのフェードなど）。
- コンフィグ画面の項目のうち、UE のゲームが反映するのは §7.3 の表の「反映する」の項目だけです。
- KS の選択肢の条件（`"…" if (…) {`）はまだ効きません。

## 11. 同梱物の権利

- KaedeVN は MIT ライセンスです（© 2026 kaedeasset。プラグインの `LICENSE`）。
- 同梱の exe 3 本は Node.js の単一実行ファイル（Node.js は MIT と、その同梱物のライセンス）に、KaedeVN の MIT のコンパイラを入れたものです（`CREDITS.md`）。
- 書体のファイルは入っていません。文字は MomijiUI の書体（SIL Open Font License 1.1）で描きます。
- 見本の作品の絵（背景 2 枚・立ち絵 2 枚）は作者が Midjourney で作ったもので、CC0 1.0 です。音と書体は入っていません（`Resources/Samples/LICENSE-ASSETS.md`）。
- Unreal と Unreal Engine は Epic Games, Inc. の商標です。KaedeVN は Epic Games と関係のない、独立した非公式のプラグインです。
