# KaedeVN — Setup guide

This guide is for KaedeVN 0.2.0 (2026-10-21).

KaedeVN is a free plugin for making visual novels inside Unreal Engine. This guide takes you from installing it on Fab to running the sample work and packaging it as a Windows game.

- Every block, KS script command, check and setting is described one by one in the [Reference](kaedevn-reference.md).
- What changed in each version is in the [Changelog](kaedevn-changelog.md).
- [日本語](kaedevn-guide.ja.md)

The editor's labels are currently in Japanese. This guide gives each label as "English meaning (Japanese label)" so you can find it on screen.

![The title screen of the sample work "枯れた泉の守り人" (The Keeper of the Dried Spring)](images/kaedevn/title.png)

---

## Contents

1. [Your first path: from installing to packaging](#1-your-first-path-from-installing-to-packaging)
2. [What the plugin can do](#2-what-the-plugin-can-do)
3. [What you need](#3-what-you-need)
4. [The work folder](#4-the-work-folder)
5. [Game controls](#5-game-controls)
6. [Writing in text (KS scripts)](#6-writing-in-text-ks-scripts)
7. [What it cannot do yet](#7-what-it-cannot-do-yet)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Your first path: from installing to packaging

This is the order for someone using KaedeVN in UE (Unreal Engine) for the first time, from installing it on Fab to packaging the sample work. Follow it from top to bottom and you can reach the end without reading the other chapters. Read the other chapters later, when you build your own work, and only the parts you need.

**First, the overall order.** KaedeVN is not a standalone app; it is a tool that runs inside the UE editor. So there is no step called "launch KaedeVN". You open a project in UE and open the novel editor from a menu (1.5). This guide says "launch" for starting a program (the launcher, UE, a packaged game) and "open" for bringing up a window or a work inside a running program (a project, the novel editor, a work).

| Step | What to do | Where | When it is done |
|---|---|---|---|
| 1.1 | Get KaedeVN and MomijiUI on Fab | Fab and the launcher | KaedeVN and MomijiUI are installed in UE |
| 1.2 | Install UE 5.8 and Visual Studio | The launcher and Microsoft's installer | You are ready to create a project |
| 1.3 | Create a C++ project and enable KaedeVN | UE's Project Browser and the editor | A project with KaedeVN opens |
| 1.4 | Place the sample work | The novel editor | The sample *枯れた泉の守り人* opens |
| 1.5 | Learn the novel editor's screen | The novel editor | You know what the four panes do |
| 1.6 | Change one line and save | The novel editor | The episode file is rewritten |
| 1.7 | Build and ▶ Play | The novel editor | You can play the sample inside the editor |
| 1.8 | Fix reported issues | The novel editor | No issues are reported |
| 1.9 | Package the game | The UE editor | A Windows exe is created |

From the second time on, open the project you created in 1.3 and only do **Tools → KaedeVN → KaedeVN ノベルエディタ** (1.5). Steps 1.1 to 1.4 are needed only once.

### 1.1 Get KaedeVN and MomijiUI on Fab

KaedeVN draws its screens with another free plugin, **MomijiUI**. Get both.

1. Sign in to Fab (fab.com) with your Epic Games account and choose "Add to My Library" on the KaedeVN page. Do the same for MomijiUI. Both are free.
2. Both appear in the Fab section of **Unreal Engine → Library** in the Epic Games Launcher (the launcher). Press **Install to Engine** for each and choose **5.8**. The plugins are installed under `<UE folder>\Engine\Plugins\Marketplace\`.

If UE 5.8 is not installed yet, do step 1 of 1.2 first and come back.

### 1.2 Install UE 5.8 and Visual Studio

1. In the launcher's **Unreal Engine → Library**, press **+** next to the engine versions, choose **5.8** and press **Install**.
2. Get the installer of **Visual Studio Community** (free) from Microsoft's website, run it, and install the workload **Game development with C++**. Use **the latest 2022 (17.14) or the latest 2026**: UE 5.8 refuses some older versions (2022 17.13 and earlier, and the first releases of 2026). If it is already installed, press **Update** in the Visual Studio Installer. KaedeVN is a C++ plugin, so you create the project as C++ (1.3), and packaging compiles the plugin's code into your game (1.9). That is why you need it.

### 1.3 Create a C++ project and enable KaedeVN

1. Press **Launch** for 5.8 in the launcher.
2. In the Project Browser, choose **Games → Blank** and select **C++**. Use **only letters, digits and `_`** in the project name (for example `MyNovel`) and press **Create**. Visual Studio compiles the project's code and the editor opens.
3. In the editor, open **Edit → Plugins**, find **KaedeVN** and tick it. When a window asks whether to enable MomijiUI, which KaedeVN needs, press **Yes**.
4. You are told a restart is needed; restart the editor and open the same project.

Installing a plugin in the engine is not enough; you enable it for each project. You do this only once, right after creating the project.

### 1.4 Place the sample work

1. Choose the menu **Tools → KaedeVN → KaedeVN ノベルエディタ** (the novel editor). The novel editor opens as a tab. It works whichever map is open.
2. Press **Place the sample (見本を置く)** at the top. The sample work *枯れた泉の守り人* ("The Keeper of the Dried Spring", one chapter, one episode) that ships with the plugin is copied into the project's `Game` folder (the work folder, §4) and opened. Files you already have are never overwritten.
3. If **枯れた泉の守り人** is shown in the **Work (作品:)** box at the top left, it is placed.

### 1.5 Learn the novel editor's screen

The novel editor has four panes.

| Pane | What is there |
|---|---|
| ① Left | The tree of **chapters (folders) → episodes (files)** in the work |
| ② Middle | The **list of blocks** in the selected episode (lines, backgrounds, sprites, branches and so on) |
| ③ Top right | The **fields** of the selected block |
| ④ Bottom right | The **preview** (redrawn as soon as you change a field) |

Open the chapter "01_第1章" in ① and select the episode "01_枯れた泉"; its blocks appear in ②.

![The novel editor: ① the chapter and episode tree, ② the blocks (a line selected), ③ the fields, ④ the preview](images/kaedevn/editor-novel.png)

### 1.6 Change one line and save

1. Select a `text` block (a line) in ②.
2. Rewrite **Body (本文)** in ③. The preview in ④ changes at once. **Speaker, empty for narration (話者(空=地の文))** is the name of the person who says the line.
3. Save with **Ctrl+S** (or **Save (保存)**). Along with the episode file (`.json`), the same content is written as text scripts (`.ks`, `.ksc`) in the same folder.

You can add blocks with **+ Block (＋ブロック)** (it adds one after the selected block). There are 7 kinds: line (`text`), background (`bg`), sprite (`ch`), variable (`set_var`), jump (`jump`), branch (`if`) and choice (`choice`). **Ctrl+Z** / **Ctrl+Y** undo and redo.

### 1.7 Build and ▶ Play

1. Press **Build (ビルド)**. The whole work (in chapter order, then episode order) is compiled into `Game/works/fantasy_block_demo/scenario.json` and the checks run.
2. Press **▶ Play (▶ プレイ)**. It builds and then starts the sample inside the editor (PIE). The map that is open now is fine.
3. Press **Start (はじめる)** on the title screen, and advance with a click, **Enter** or **Space** (the sample is one short episode with a background, a sprite and four lines). When you have seen the line you changed in 1.6, press **Stop** (■) in the editor's toolbar to go back.

![Playing the sample: background, character sprite, name box and text](images/kaedevn/play.png)

### 1.8 Fix reported issues

Building checks for things that compile but break when played (a missing image, an empty line, a jump to an episode that does not exist, and so on: 15 kinds). Anything found is listed at the bottom of the novel editor. **Click a row and the editor opens that episode and selects that block.** Fix the field in ③ and press **Build** again. Issues never stop the build. The unchanged sample reports none.

![The list of build issues: a copy of the sample with two mistakes (a mistyped background id and an empty line) was built, and the first issue was clicked to select its block](images/kaedevn/editor-build-checks.png)

### 1.9 Package the game

When the sample plays in the editor, package it as a Windows game. The settings are needed only once.

1. **Make the game's map**: choose **File → New Level → Empty Level**, then **File → Save Current Level** and save it under `Content` (for example `NovelMap`).
2. **Make KaedeVN the game's framework**: in **Edit → Project Settings → Maps & Modes**, set **Default GameMode** to `KaedeVnGameMode` and **Game Default Map** to the map from step 1. This GameMode connects the novel's screens and controls (keyboard, mouse, gamepad).
3. **Put the work folder into the game**: open `Config/DefaultGame.ini` in your project folder with Notepad, add these 2 lines at the end and save. Without them the packaged game starts but finds no scripts.

   ```ini
   [/Script/UnrealEd.ProjectPackagingSettings]
   +DirectoriesToAlwaysStageAsUFS=(Path="../Game")
   ```

4. **Choose the work the game starts**: in the project folder's `Game`, create a folder named `projects` and, in it, a file `projects.json` with this content (UTF-8). The packaged game plays the first work in this list.

   ```json
   {
     "projects": [
       { "id": "fantasy_block_demo", "title": "枯れた泉の守り人", "scenario": "works/fantasy_block_demo/scenario.json" }
     ]
   }
   ```

5. Press **Build** in the novel editor once more to refresh `scenario.json`.
6. Choose **Platforms → Windows → Package Project** and select an output folder. For a release build, set the packaging configuration in the same menu to **Shipping**. Visual Studio compiles the plugin's code into your game.
7. Launch the exe in the output folder. It starts at the sample's title screen.

A packaged game writes its logs and saves to `%LOCALAPPDATA%\<project name>\Saved`, not next to the exe.

For your own work, create it with **New work (作品を新規作成)** in the novel editor, then edit, play and package it in the same order as 1.6 to 1.9 (replace the id, title and `scenario` in the list of step 4 with your work's).

---

## 2. What the plugin can do

**Only what works in UE is listed.** Commands you can write in a script but that do nothing in UE yet are in §7.

| Area | What you can do |
|---|---|
| Novel editor | Build a work as work › chapter › episode › block. 7 kinds of blocks: line, background, sprite, variable, jump, branch, choice. A preview that redraws as soon as you change a field. Undo / redo, per episode. Chapters are folders and episodes are files, so the structure is readable outside the editor too. The work's screen size (720p or 1080p) |
| Build checks | 15 kinds of reports on things that compile but break when played (a missing image, an empty line or choice label, a jump to an episode that does not exist, duplicate ids and so on). Click a row to go to that block. The build is never stopped |
| KS scripts | Plain-text scripts (`.ks`), one file per episode, with commands, lines, speakers, labels, variables, choices and branches. Saving in the novel editor also writes the same content as `.ks` |
| KS script editor | Shows the script's lines as a tree, with the selected line's fields, a preview and checks (8 kinds). The KS script editor never rewrites your text: for KS scripts the text files are the source of truth |
| Bundled compiler | `kaedevn-ks-compile.exe` (KS script → `scenario.json`), used by the KS script editor's build, and `kaedevn-blocks2ks.exe` (blocks → KS text), used when the novel editor saves. No external tools, no network access. The novel editor compiles blocks into `scenario.json` itself |
| Picture effects | Backgrounds (with a dissolve), sprites (three positions, expression changes, moves), free sprites (pictures anywhere that you can move, fade and scale), text at a set position, overlays (rain, fog, frames and so on), hiding or fading whole layers, and layer transitions |
| Screen effects | Color filters, shake, flash, fade to and from black or white, a single-color mask, camera moves (zoom and pan), and timelines (several moves arranged along time) |
| Flow | Lines and narration, text reveal, line and page breaks, waiting for a click or for a time, choices, variables and branches, jumps, calls and returns, and KSC (small scripts inside a script: flags, item counts, arithmetic) |
| Game screens | Title, menu, table of contents, save, load, manual and config (the sample's 7 screens; all are MomijiUI JSON, so each work can change them). Auto, skip, quick save and load. Of the config items, UE applies 4: text speed, typeface, window size and color theme |
| Controls | Keyboard, mouse and gamepad (§5). The plugin binds them with Enhanced Input, so there is nothing to wire up in your project |
| Packaging | Windows games. The game framework (GameInstance, GameMode, PlayerController) is the plugin's `KaedeVnHost` |

A work is JSON and text scripts in the **work folder** (§4). You can see the differences in Git.

| | | |
|---|---|---|
| ![Choices](images/kaedevn/choice.png) | ![Screen filter (sepia)](images/kaedevn/filter.png) | ![KS script editor](images/kaedevn/editor-ks.png) |
| Choices | Screen filter (sepia) | KS script editor (script tree, preview and fields; the error mark on the added line `@bg bg_typo` is an example) |
| ![Menu](images/kaedevn/menu.png) | ![Save](images/kaedevn/save.png) | ![Config](images/kaedevn/config.png) |
| Menu | Save | Config |

The choice and filter pictures were taken with a choice and a filter added after the sample's episode (the sample's one episode does not have them).

---

## 3. What you need

- Unreal Engine 5.8 and Windows (64-bit)
- **the latest Visual Studio 2022 (17.14) or the latest Visual Studio 2026** with the workload **Game development with C++** (for creating a C++ project and for packaging; §1.2)
- **MomijiUI** (a free plugin, a separate Fab listing; it is enabled together with KaedeVN)

---

## 4. The work folder

KaedeVN reads a work's data from one folder, the **work folder**. Its place is `WorkRoot` in **Edit → Project Settings → Plugins → KaedeVN**; the default is `Game`, directly under the project folder.

| Path | What it holds |
|---|---|
| `works/<work id>/work.json` | The work's title and the order of its chapters |
| `works/<work id>/<chapter folder>/<episode>.json` | The episode's list of blocks. Saving also writes the same content as `.ks` and `.ksc` next to it |
| `works/<work id>/scenario.json` | The build output, which the game plays (do not edit it by hand) |
| `ui/` | The game screens (MomijiUI JSON: title, menu, table of contents, save, load, manual, config) |
| `assets.json` | Image id → image file. Blocks and scripts refer to images by id |
| `assets/` | The image files (the sample has two backgrounds and two sprites) |
| `projects/projects.json` | The list of works the packaged game plays (step 4 of §1.9) |

- When you package, the whole folder goes into the game (the lines of step 3 of §1.9; if you change `WorkRoot`, point `Path` to the same place).
- To add an image, put the file in `assets/` and add one line `"<id>": "<path from the project folder>"` to `assets.json`.

---

## 5. Game controls

The same in ▶ Play and in a packaged game.

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Advance, confirm | Click, **Enter**, **Space** | A / ✕ |
| Move the selection | Arrow keys | D-pad, left stick |
| Cancel, back | **Esc**, **Backspace** | B / ○ |
| Auto | **A** | L1 |
| Skip | **Ctrl** (left) | R1 |
| Quick save / load | **F5** / **F9** | Y / △, X / □ |
| Menu | — | Start / + |

---

## 6. Writing in text (KS scripts)

Instead of building in the novel editor, you can write a text script (a KS script). Each episode is one `.ks` file, with one command or line per text line.

```
; title: 枯れた泉
@bg forest
#ナレーション
ルカは、いつもの足取りで村の中央にある泉へと向かっていた。
@l
#ルカ
……泉が、枯れている。
@p
@jump next
```

| Line | Meaning |
|---|---|
| `; …` | A comment (not shown in the game). `; title:` at the top is the episode's title |
| `@bg forest` | Change the background to the image with id `forest` in `assets.json` |
| `#ルカ` | Make the following text a line spoken by "ルカ" (`#` alone means narration) |
| A text line | A line or narration |
| `@l`, `@p` | Wait for a click (`@p` also clears the text and starts a new page) |
| `@jump next` | Jump to the label `*next` |

You can edit KS scripts in **Tools → KaedeVN → KaedeVN KS台本エディタ** (the KS script editor), looking at the lines as a tree. This menu opens a "KaedeVN KS script project" asset in your project (a data asset that points to a script folder). A project you just set up from Fab has no such asset, so the menu only shows "KaedeVN 台本プロジェクトが見つかりません" (no script project found) and opens nothing (§7). Today, the reliable use is to read or copy the `.ks` that the novel editor writes when you save. All commands and their arguments are in §4 of the [Reference](kaedevn-reference.md), and the KS script editor is in §5.

---

## 7. What it cannot do yet

- Works are made only in the Windows editor (not in the Mac or Linux editor). The packaged games we have checked are Windows games.
- **The editor's labels are currently in Japanese.** The English guide and the English reference give the English meaning of each label.
- **Sound does not play yet.** BGM, sound-effect and voice commands can be written and build fine, but do nothing in a UE game. The same goes for Live2D, VRM, particle and RPG map commands (the list of names is in §4.3 of the reference).
- Of the config screen's items, a UE game applies 4: text speed, typeface, window size and color theme. You can choose the others on the screen, but they are not used yet.
- Conditions on KS choices (`"…" if (…) {`) do not work yet (the choice is always shown).
- There is no button yet to create the asset the KS script editor opens (a KaedeVN KS script project), and this guide does not yet describe starting a work from KS scripts alone (§6).
- The novel editor has 7 kinds of blocks. Effects such as screen filters, overlays and shakes are written in KS scripts (§6).

---

## 8. Troubleshooting

| When | Where to look |
|---|---|
| There is no "KaedeVN" in the menu | Whether the plugin is enabled (**Edit → Plugins**). After enabling it, restart the editor (§1.3) |
| "Place the sample" shows no work | Whether the work folder (`WorkRoot`) is writable, and whether `Game/works/fantasy_block_demo/` exists in the project folder |
| An image does not show | Whether the image id is in `assets.json` and the file is at that path (the build check reports "アセットが見つかりません", asset not found) |
| ▶ Play starts nothing, or another screen appears | Whether the build failed ("ビルド失敗" in the status line at the top), and whether the `PreviewMap` setting points to a map with its own GameMode (empty means KaedeVN plays on the map that is open) |
| The packaged game has no script, or a demo other than the sample starts | The UFS lines in `Config/DefaultGame.ini` (step 3 of §1.9) and `Game/projects/projects.json` (step 4). After fixing either, package again |
| Controls do nothing in the packaged game, or no novel appears | Whether **Default GameMode** is `KaedeVnGameMode` (step 2 of §1.9) |
| Packaging says the code cannot be compiled | Whether Visual Studio and the workload **Game development with C++** are installed (§1.2) |
| You want to see logs or saves | For a packaged game, `%LOCALAPPDATA%\<project name>\Saved`. For the editor, the project's `Saved/Logs` |
| You do not understand a build check message | §6.1 of the reference gives the meaning and the fix for each message |
