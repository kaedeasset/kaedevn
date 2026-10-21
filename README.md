# KaedeVN

A visual novel engine (plugin) for Unreal Engine 5, with a sample project. MIT licensed and free to use.

Japanese: [README.ja.md](README.ja.md). **The Japanese version is the original**; this English version is its translation.

- Repository: <https://github.com/kaedeasset/kaedevn>
- Author: kaedeasset (<https://kaedeasset.com/>)
- Requires Unreal Engine 5.8 and Windows (MSVC 14.51). The runtime is verified on Windows and Android

## What is in this repository

| Location | What it is |
|---|---|
| `Plugins/KaedeVN/` | The plugin. Five modules: `KaedeVnCore` (the engine-agnostic play session), `KaedeKsc` (the KSC VM), `KaedeVnUI` (Slate rendering), `KaedeVnHost` (GameInstance / GameMode / PlayerController) and `KaedeShaders` (screen filter shaders). All are Runtime modules. The automated test sources are included |
| `Tools/kaedevn-compiler/` | Source of the script compiler (TypeScript). It turns KS / KSC scripts into `scenario.json` (Op IR) |
| `KaedeVnSample.uproject`, `Source/`, `Config/`, `Content/`, `Game/` | The sample project, with the short novel *枯れた泉の守り人* and other sample works |

The novel editor and the KS script editor (the Editor module `KaedeVnEditor`) are not in this repository. They are distributed through Fab and the Unreal Engine fork on Epic's GitHub, because the Unreal Engine EULA restricts where editor tools may be distributed.

## Installation

1. Clone this repository.
   ```
   git clone https://github.com/kaedeasset/kaedevn.git
   ```
2. KaedeVN uses MomijiUI (screen JSON and its Slate renderer). Put `Plugins/MomijiUI/` from <https://github.com/kaedeasset/momiji-ui> into the sample project's `Plugins/MomijiUI/`.
   ```
   git clone https://github.com/kaedeasset/momiji-ui.git ../momiji-ui
   xcopy /E /I ..\momiji-ui\Plugins\MomijiUI Plugins\MomijiUI
   ```
3. Download the script compiler executables from GitHub Releases (<https://github.com/kaedeasset/kaedevn/releases>) and put them in `Plugins/KaedeVN/ThirdParty/Win64/`. To build them from source, follow `Tools/kaedevn-compiler/README.md`. The steps are also in `Plugins/KaedeVN/ThirdParty/Win64/README.md`.
4. Right-click `KaedeVnSample.uproject`, choose **Generate Visual Studio project files**, then open the `.uproject` (build when prompted).

To use KaedeVN in your own project, copy `Plugins/KaedeVN/` and `Plugins/MomijiUI/` into that project's `Plugins/` and enable KaedeVN in *Edit → Plugins*. The folder that holds a work's data (`Game/` here) is set by `WorkRoot` in *Project Settings > Plugins > KaedeVN*.

## Minimal usage

1. Open the sample project and press Play. The sample work starts in `Lvl_Sample2D`. Click, Enter or Space advances the text; the arrow keys pick a choice.
2. The script is `Game/ks-sample/scenario/*.ks` (plain text, one file per page). After editing it, compile it to `scenario.json` with the script compiler.
   ```
   Plugins\KaedeVN\ThirdParty\Win64\kaedevn-ks-compile.exe Game\ks-sample
   ```
3. A script looks like this:
   ```ks
   @bg bg_spring_dry
   #ルカ
   ……泉が、枯れている。
   @l
   ```

The full walkthrough (place the sample → edit → play → package an EXE) is §1 of the setup guide [Plugins/KaedeVN/Docs/kaedevn-guide.md](Plugins/KaedeVN/Docs/kaedevn-guide.md), and every block, command, check and setting is in the reference [Plugins/KaedeVN/Docs/kaedevn-reference.md](Plugins/KaedeVN/Docs/kaedevn-reference.md). (The novel editor is not in this repository, so the editor steps are the ones for a Fab install.)

## Tests

The automated test sources are in each module (`Private/*Tests.cpp` and similar). Open the sample project in the editor, go to *Tools → Session Frontend → Automation*, select `Kaede` and run. From the command line:

```
UnrealEditor-Cmd.exe KaedeVnSample.uproject -ExecCmds="Automation RunTests Kaede; Quit" -unattended -nullrhi
```

The script compiler's tests: `npm install`, then `npm test` in `Tools/kaedevn-compiler`.

## Fab and paid products

- Fab product page: coming soon
- KaedeVN and MomijiUI are free. kaedeasset builds paid products on top of them; the main one today is **KaedeRPG** (an RPG creation tool for Unreal Engine that bundles this novel engine). See <https://kaedeasset.com/>.

## License

The KaedeVN source is MIT ([LICENSE](LICENSE), © 2026 kaedeasset).

Things that are not MIT or carry their own license:

| What | License | Where |
|---|---|---|
| Sample images (backgrounds, sprites, title, UI icons) | CC0 1.0 (generative-AI content) | `Game/assets/`, `Game/ui/`. Details: [Game/LICENSE-ASSETS.md](Game/LICENSE-ASSETS.md) |
| Fonts BIZ UDPGothic, BIZ UDPMincho, Yomogi, DotGothic16 | SIL Open Font License 1.1 | Bundled with MomijiUI (not in this repository) |
| Script compiler executables (attached to Releases) | The embedded Node.js runtime is MIT and others (Node.js license) | `Plugins/KaedeVN/ThirdParty/Win64/README.md` |

The script compiler source (`Tools/kaedevn-compiler/`) is MIT.

"Unreal" and "Unreal Engine" are trademarks of Epic Games, Inc. KaedeVN is an independent, unofficial plugin and is not affiliated with or endorsed by Epic Games.
