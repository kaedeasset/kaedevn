# @kaedevn/compiler

Compiler for the **tag notation (KS, `.ks`)** of **Kaede Script** — kaedevn's scripting language. Compiles TyranoScript-style scripts (e.g. `@bg id="room"`, `@ch name="sakura"`) into executable `Op[]` instruction sequences. Pairs with `@kaedevn/ksc-compiler` which handles the companion **code notation (KSC, `.ksc`)** via a compiler + VM.

## Install

```bash
npm install @kaedevn/compiler
```

## CLI

```bash
# Compile a .ks file
kaedevn-compile scenario.ks -o output.json

# Set scenario ID
kaedevn-compile scenario.ks -i my_scenario

# Watch mode
kaedevn-compile scenario.ks -w

# Skip validation
kaedevn-compile scenario.ks --no-validate

# Validate without compiling
kaedevn-compile validate scenario.ks
kaedevn-compile validate *.ks
```

## Programmatic API

```typescript
import { compile } from "@kaedevn/compiler";

const result = compile(source, {
  scenarioId: "my_scenario",
  validate: true, // default
});
// result: { id: string, ops: Op[] }
```

## .ks Script Syntax

### Text & Dialogue

```
// Narration
今日は良い天気。

// Character dialogue (full-width colon ：)
主人公：おはよう。
```

### Inline Commands

| Syntax | Description |
|--------|-------------|
| `@l` | Wait for click (line break) |
| `@p` | Wait for click + clear text (page break) |
| `@r` | Newline without waiting |

```
テキスト。@r改行。@lクリック待ち。
```

### Commands

```
@bg room_day                          // Background
@bg room_night fade 500               // With fade

@ch hero smile center                 // Character (name pose pos)
@ch heroine sad left fade 300         // Positions: left/center/right or L/C/R
@ch_hide heroine fade 200             // Hide character
@ch_clear fade 500                    // Hide all characters

@bgm calm                            // BGM play
@bgm morning vol 80 fade 500         // With volume & fade
@bgm_stop fade 500                   // BGM stop

@se door                             // Sound effect
@voice hero_001                       // Voice

@wait 0.5                            // Timed wait (seconds)
```

### Variables

```
flag = 0
score += 5
health -= 10
```

### Choice

```
choice {
  "Option A" {
    flag = 1
    Selected A.@l
  }
  "Option B" {
    flag = 2
    Selected B.@l
  }
}
```

### Conditionals

```
if (flag == 1) {
  True path.@l
} else {
  False path.@l
}
```

### Comments

```
// This is a comment
```

See [docs/ks-spec.md](../../docs/ks-spec.md) for the full specification.

## Compiler Pipeline

```
Source (.ks) → Tokenizer → Parser → Transformer → Finalizer → Validator → CompiledScenario
```

## License

MIT
