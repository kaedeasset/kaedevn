# Third-party components

KaedeVN itself is MIT © 2026 kaedeasset (see [LICENSE](LICENSE)). The components below
are redistributed with the plugin and keep their own licenses.

## Vendored source

KaedeVN vendors no third-party source. It uses
[nlohmann/json](https://github.com/nlohmann/json) (MIT) through its dependency
MomijiUI (a separate free plugin), which vendors it in its
`MomijiUICore` module and lists it in its own notices.

## Executables

The three executables live in `ThirdParty/Win64/` and are verified by
`SHA256SUMS.txt`. The Fab package bundles them; the GitHub source repository does
not (they are attached to its Releases page, <https://github.com/kaedeasset/kaedevn/releases> — see
[`ThirdParty/Win64/README.md`](ThirdParty/Win64/README.md)). None of them performs
any network access.

| Executable | Role |
|---|---|
| `kaedevn-ks-compile.exe` | Links `scenario/*.ks` and compiles to `scenario.json` (Op IR) + `asset-manifest.json`. Called by the KS editor's build. |
| `kaedevn-blocks2ks.exe` | Converts an episode's block JSON to `.ks` / `.ksc`. Called on save in the novel editor, so a graphically authored work also exists as text. |
| `kaedevn-ksc-service.exe` | A resident JSON-lines service that compiles KSC commands to the Op IR at runtime. |

All three are **Node.js Single Executable Applications** (Node 22 official SEA
procedure): a copy of `node.exe` with a bundled CJS blob injected via `postject`.
Most of each file's size is therefore the Node.js runtime itself.

- **Node.js runtime**: MIT, plus the licenses of its own bundled components —
  see [Node.js LICENSE](https://github.com/nodejs/node/blob/main/LICENSE).
- **Injected code** (`@kaedevn/compiler` and related code, with their bundled
  dependencies): MIT, © 2026 kaedeasset. The compiler source is in
  `Tools/kaedevn-compiler/` of the GitHub repository. The conversion between KS and the Op IR is defined once there and
  is never re-implemented in C++.

Provenance and the regeneration procedure are in
[`ThirdParty/Win64/README.md`](ThirdParty/Win64/README.md).

## Fonts

KaedeVN ships no font files. Text is drawn with the fonts bundled in
MomijiUI (BIZ UDPGothic, BIZ UDPMincho,
Yomogi and DotGothic16, all under the SIL Open Font License 1.1); their licenses
ship with the font files in MomijiUI.

## Sample work

`Resources/Samples/` holds a short sample work. Its images (two backgrounds and two
character sprites) were generated with Midjourney by the author and are offered
under CC0 1.0; it has no audio and no font files. See
[`Resources/Samples/LICENSE-ASSETS.md`](Resources/Samples/LICENSE-ASSETS.md).

## Trademarks

"Unreal" and "Unreal Engine" are trademarks of Epic Games, Inc. KaedeVN is an
independent, unofficial plugin and is not affiliated with or endorsed by Epic
Games.
