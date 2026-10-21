/**
 * オプション引数のパース。
 *
 * 二系統の形式に両対応する：
 *  - positional:  `fade 500 x 80 y -40 s 1.3`  (editor の buildSnapshotScript / 手書き KS)
 *  - key=value:   `fade=500 x=80 y=-40 s=1.3`  (pagesToKs → KsPrinter)
 *
 * 直近 commit 0e469b21 で filter_mix を同様の両対応にした。
 * x/y/s が消える同種のバグを防ぐため、ここで一括対応する。
 */

interface TransformOpts {
  fadeMs?: number;
  vol?: number;
  x?: number;
  y?: number;
  s?: number;
}

interface BgOpts {
  fadeMs?: number;
  effect?: "fade" | "slide_left" | "slide_right";
  x?: number;
  y?: number;
  s?: number;
}

/**
 * args[startIndex..] を「キーと値の組」のシーケンスに正規化する。
 * - 'x=80'                  → [['x','80']]
 * - 'x', '80'               → [['x','80']]
 * - 混在も許容（隣接ペア優先で消費）
 */
export function normalizePairs(args: string[], startIndex: number): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  let i = startIndex;
  while (i < args.length) {
    const tok = args[i];
    if (tok == null) { i++; continue; }
    const eqIdx = tok.indexOf('=');
    if (eqIdx > 0) {
      pairs.push([tok.slice(0, eqIdx), tok.slice(eqIdx + 1)]);
      i++;
    } else {
      const next = args[i + 1];
      if (next != null) {
        pairs.push([tok, next]);
      }
      i += 2;
    }
  }
  return pairs;
}

export function parseOptionalArgs(
  args: string[],
  startIndex: number
): TransformOpts {
  const opts: TransformOpts = {};
  for (const [key, value] of normalizePairs(args, startIndex)) {
    if (!value) continue;
    if (key === 'fade' || key === 'slide_left' || key === 'slide_right') {
      const v = parseInt(value, 10);
      if (!isNaN(v)) opts.fadeMs = v;
    } else if (key === 'vol') {
      const v = parseInt(value, 10);
      if (!isNaN(v)) opts.vol = v;
    } else if (key === 'x') {
      const v = parseFloat(value); if (!isNaN(v)) opts.x = v;
    } else if (key === 'y') {
      const v = parseFloat(value); if (!isNaN(v)) opts.y = v;
    } else if (key === 's') {
      const v = parseFloat(value); if (!isNaN(v)) opts.s = v;
    }
  }
  return opts;
}

/**
 * 背景エフェクト引数をパース。BG_SET 専用 — effect フィールドを含む。
 */
export function parseBgOptionalArgs(
  args: string[],
  startIndex: number
): BgOpts {
  const opts: BgOpts = {};
  for (const [key, value] of normalizePairs(args, startIndex)) {
    if (!value) continue;
    if (key === 'fade') {
      const v = parseInt(value, 10);
      if (!isNaN(v)) opts.fadeMs = v;
      opts.effect = 'fade';
    } else if (key === 'slide_left') {
      const v = parseInt(value, 10);
      if (!isNaN(v)) opts.fadeMs = v;
      opts.effect = 'slide_left';
    } else if (key === 'slide_right') {
      const v = parseInt(value, 10);
      if (!isNaN(v)) opts.fadeMs = v;
      opts.effect = 'slide_right';
    } else if (key === 'x') {
      const v = parseFloat(value); if (!isNaN(v)) opts.x = v;
    } else if (key === 'y') {
      const v = parseFloat(value); if (!isNaN(v)) opts.y = v;
    } else if (key === 's') {
      const v = parseFloat(value); if (!isNaN(v)) opts.s = v;
    }
  }
  return opts;
}
