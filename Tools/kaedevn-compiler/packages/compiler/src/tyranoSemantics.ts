/**
 * TyranoScript 変換の意味論レイヤ: キャラクター manifest 収集・表情解決・
 * 安全な式サブセット（[if]/[eval]）の変換。字句/構文は tyranoParser、
 * タグ→KS のディスパッチは tyranoConverter が担当し、ここは「値・キャラの意味」を扱う。
 */
import { parseTyrano, sanitizeId, storageToId, type TyranoNode, type TyranoTagNode } from './tyranoParser.js';

// ── キャラクター manifest ──

/** キャラクター表情（editor-json の Expression 互換 + 元 storage を併記）。 */
export interface TyranoCharacterExpression {
  slug: string;   // 表情スラグ（Tyrano の face 名）。既定は "normal"
  name: string;   // 表示名（現状 slug と同じ）
  kind: 'static';
  storage: string; // 元の画像ファイル名（Phase 5 の asset 解決で imageAssetId に変換）
}

/** キャラクター定義（editor-json の characters.json 互換形 + storage 併記）。 */
export interface TyranoCharacter {
  slug: string;                 // [chara_new] の name（スクリプトで使う ID）
  name: string;                 // jname があればそれ、無ければ slug
  defaultExpressionId: string;  // 既定表情スラグ（通常 "normal"）
  storage: string;              // [chara_new] の storage（既定表情の画像）
  expressions: TyranoCharacterExpression[];
}

export type TyranoCharacterManifest = TyranoCharacter[];

/**
 * 複数の .ks ソースを走査して [chara_new]/[chara_face] からキャラクター manifest を収集する。
 *
 * Tyrano の慣習では chara_new/chara_face は first.ks 等の初期化ファイルにあり、
 * シナリオ本体とは別ファイルのことが多い。到達可能性は追わず、渡された全ソースを
 * 静的走査して定義を集める（単一ファイル入力だと本体だけでは manifest が空になる）。
 */
export function collectCharacterManifest(sources: string[]): TyranoCharacterManifest {
  const map = new Map<string, TyranoCharacter>();
  for (const src of sources) {
    collectCharactersFromNodes(parseTyrano(src), map);
  }
  return [...map.values()];
}

export function collectCharactersFromNodes(nodes: TyranoNode[], map: Map<string, TyranoCharacter>): void {
  const arg = (node: TyranoTagNode, name: string): string | undefined => {
    const v = node.args[name];
    return typeof v === 'string' ? v : undefined;
  };
  for (const node of nodes) {
    if (node.type !== 'tag') continue;
    if (node.name === 'chara_new') {
      const name = arg(node, 'name');
      if (!name) continue;
      const slug = sanitizeId(name);
      const storage = arg(node, 'storage') ?? '';
      const displayName = arg(node, 'jname') ?? slug;
      const existing = map.get(slug);
      if (existing) {
        // 既存定義があれば表示名/storage を補完（重複 chara_new は上書きしない）
        if (!existing.name || existing.name === existing.slug) existing.name = displayName;
        if (!existing.storage) existing.storage = storage;
      } else {
        map.set(slug, {
          slug,
          name: displayName,
          defaultExpressionId: 'normal',
          storage,
          expressions: [{ slug: 'normal', name: 'normal', kind: 'static', storage }],
        });
      }
    } else if (node.name === 'chara_face') {
      const name = arg(node, 'name');
      const face = arg(node, 'face');
      const storage = arg(node, 'storage') ?? '';
      if (!name || !face) continue;
      const slug = sanitizeId(name);
      const faceSlug = sanitizeId(face);
      let char = map.get(slug);
      if (!char) {
        // chara_new より先に chara_face が来た場合も許容（後で chara_new が補完）
        char = { slug, name: slug, defaultExpressionId: 'normal', storage: '', expressions: [] };
        map.set(slug, char);
      }
      const existingExpr = char.expressions.find((e) => e.slug === faceSlug);
      if (existingExpr) {
        existingExpr.storage = storage;
      } else {
        char.expressions.push({ slug: faceSlug, name: faceSlug, kind: 'static', storage });
      }
    }
  }
}

/**
 * [chara_show]/[chara_mod] の表情を manifest 経由で解決する。
 *
 * 後方互換: プロジェクトに [chara_new] が1つも無い（manifest 空）場合は従来挙動を保つ
 * （chara_show→"normal"、chara_mod→storage basename）。警告も出さない。
 * manifest が存在するのに参照先が未定義のときだけ warning を出す。
 */
export function resolveExpression(
  manifest: TyranoCharacterManifest,
  slug: string,
  opts: { mode: 'show' | 'mod'; face?: string; storage?: string },
): { expr: string; warning?: string } {
  const hasManifest = manifest.length > 0;
  const char = manifest.find((c) => c.slug === slug);
  const undefinedCharWarning =
    hasManifest && !char ? `[chara_${opts.mode}] character "${slug}" is not defined by [chara_new].` : undefined;

  if (opts.face) {
    const faceSlug = sanitizeId(opts.face);
    if (char && !char.expressions.some((e) => e.slug === faceSlug)) {
      return { expr: faceSlug, warning: `[chara_mod] face "${faceSlug}" is not defined for "${slug}" in the character manifest.` };
    }
    return { expr: faceSlug, warning: undefinedCharWarning };
  }

  if (opts.storage) {
    const wanted = storageToId(opts.storage);
    if (char) {
      const face = char.expressions.find((e) => storageToId(e.storage) === wanted);
      if (face) return { expr: face.slug };
      return opts.mode === 'show'
        ? { expr: char.defaultExpressionId, warning: `[chara_show] storage "${opts.storage}" is not registered for "${slug}"; using default expression.` }
        : { expr: wanted, warning: `[chara_mod] storage "${opts.storage}" is not registered for "${slug}"; using basename "${wanted}".` };
    }
    // manifest 未定義キャラ: show は "normal"、mod は basename（旧挙動）
    return opts.mode === 'show'
      ? { expr: 'normal', warning: undefinedCharWarning }
      : { expr: wanted, warning: undefinedCharWarning };
  }

  // 指定なし（chara_show の既定表情）
  if (char) return { expr: char.defaultExpressionId };
  return { expr: 'normal', warning: undefinedCharWarning };
}

// ── 作者定義マクロ（[macro]…[endmacro]） ──

/** 作者定義マクロ。body は raw から定義行（[macro]行）と [endmacro] 行を除いた生テキスト。 */
export interface TyranoMacro {
  name: string;
  body: string;
}

/**
 * 複数の .ks ソースを走査して [macro name=X]…[endmacro] を収集する。
 * manifest 収集と同じ「全ファイル・到達可能性不問」の静的走査。重複定義は後勝ち（Tyrano 準拠）。
 */
export function collectMacros(sources: string[]): Map<string, TyranoMacro> {
  const map = new Map<string, TyranoMacro>();
  for (const src of sources) {
    collectMacrosFromNodes(parseTyrano(src), map);
  }
  return map;
}

export function collectMacrosFromNodes(nodes: TyranoNode[], map: Map<string, TyranoMacro>): void {
  for (const node of nodes) {
    if (node.type !== 'block' || node.name !== 'macro') continue;
    const rawName = node.args.name;
    if (typeof rawName !== 'string' || !rawName.trim()) continue;
    // タグ名はパーサが小文字化するため、呼び出しと照合できるよう小文字で登録する
    const name = rawName.trim().toLowerCase();
    const lines = node.raw.split('\n');
    // 1行目（[macro]行）と [endmacro] を含む末尾行を除いた本体。EOF 到達で endmacro が無い場合は末尾行も本体に含める。
    const last = lines[lines.length - 1] ?? '';
    const end = /\[\s*endmacro(?:\s|\])/i.test(last) ? lines.length - 1 : lines.length;
    map.set(name, { name, body: lines.slice(1, end).join('\n') });
  }
}

// ── キーフレームアニメ定義（[keyframe]…[endkeyframe]） ──

/** [frame p="25%" x="-800" …] の1フレーム。p は 0〜1 に正規化済み。 */
export interface TyranoKeyframeFrame {
  /** 進行率（0〜1）。 */
  p: number;
  /** p 以外の属性（x/y/opacity/scale/rotate/e 等）を生値で保持。 */
  props: Record<string, string>;
}

/** [keyframe name=K] 定義。converter が [kanim] で TimelineRoot へ変換する。 */
export interface TyranoKeyframeDef {
  name: string;
  frames: TyranoKeyframeFrame[];
}

/**
 * 複数の .ks ソースを走査して [keyframe name=K]…[endkeyframe] を収集する。
 * macro 収集と同型（全ファイル・到達可能性不問・後勝ち）。
 */
export function collectKeyframes(sources: string[]): Map<string, TyranoKeyframeDef> {
  const map = new Map<string, TyranoKeyframeDef>();
  for (const src of sources) {
    collectKeyframesFromNodes(parseTyrano(src), map);
  }
  return map;
}

export function collectKeyframesFromNodes(nodes: TyranoNode[], map: Map<string, TyranoKeyframeDef>): void {
  for (const node of nodes) {
    if (node.type !== 'block' || node.name !== 'keyframe') continue;
    const rawName = node.args.name;
    if (typeof rawName !== 'string' || !rawName.trim()) continue;
    const frames: TyranoKeyframeFrame[] = [];
    for (const child of node.children) {
      if (child.type !== 'tag' || child.name !== 'frame') continue;
      const pRaw = typeof child.args.p === 'string' ? child.args.p : '';
      const pNum = parseFloat(pRaw.replace('%', '').trim());
      if (isNaN(pNum)) continue;
      const props: Record<string, string> = {};
      for (const [k, v] of Object.entries(child.args)) {
        if (k !== 'p' && typeof v === 'string') props[k] = v;
      }
      frames.push({ p: Math.min(Math.max(pNum / 100, 0), 1), props });
    }
    frames.sort((a, b) => a.p - b.p);
    map.set(rawName.trim(), { name: rawName.trim(), frames });
  }
}

// ── 安全な式サブセット（[if]/[eval]） ──

/**
 * Tyrano の条件式を KS の単一比較へ変換する。安全サブセット外は error を返す。
 * - `&&` / `||` は KS runtime 未対応のため対象外
 * - 演算子は >= <= == != > <（=== !== は正規化）
 * - オペランドは数値/文字列/bool リテラル or f./tf. 変数（sf. は対象外）
 * - 文字列/bool リテラルは == / != のみ（順序比較は KS runtime が warn + false になるため error）
 */
export function convertCondition(exp: string): { ks: string; warning?: string } | { error: string } {
  const e = exp.trim();
  if (/&&|\|\|/.test(e)) return { error: 'logical && / || is not supported by the KS runtime' };
  const norm = e.replace(/===/g, '==').replace(/!==/g, '!=');
  const m = norm.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!m) return { error: `not a single comparison: "${exp}"` };
  const left = convertOperand(m[1]);
  const right = convertOperand(m[3]);
  if ('error' in left) return { error: left.error };
  if ('error' in right) return { error: right.error };
  const isEquality = m[2] === '==' || m[2] === '!=';
  if (!isEquality && (left.nonNumeric || right.nonNumeric)) {
    return { error: `order comparison "${m[2]}" requires numeric operands: "${exp}"` };
  }
  return { ks: `${left.value} ${m[2]} ${right.value}`, warning: left.warning ?? right.warning };
}

/**
 * Tyrano の [eval] 式を KS の代入へ変換する。安全サブセット外は error を返す。
 * - `f.x = N | "str" | 'str' | true | false`（P6-4 で文字列/bool を許可）
 * - `f.x += N` / `f.x -= N` は数値リテラルのみ
 * - 変数間代入・`*=` `/=`・sf. は対象外
 */
export function convertAssignment(exp: string): { ks: string; warning?: string } | { error: string } {
  const m = exp.trim().match(/^(f|tf|sf)\.([A-Za-z_]\w*)\s*(=|\+=|-=)\s*(.+)$/);
  if (!m) return { error: `not a simple assignment: "${exp}"` };
  const [, scope, name, op, rhsRaw] = m;
  if (scope === 'sf') return { error: `system variable "sf.${name}" has no kaedevn equivalent` };
  const rhs = rhsRaw.trim();
  const warning = scope === 'tf' ? tfWarning(scope, name) : undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(rhs)) return { ks: `${name} ${op} ${rhs}`, warning };
  if (op === '=') {
    const str = stringLiteral(rhs);
    if (str !== undefined) return { ks: `${name} = "${str}"`, warning };
    if (rhs === 'true' || rhs === 'false') return { ks: `${name} = ${rhs}`, warning };
    return { error: `assignment RHS must be a number, "string", true or false literal, got "${rhs}"` };
  }
  return { error: `assignment RHS must be a numeric literal for ${op}, got "${rhs}"` };
}

/** 条件/代入のオペランド（数値/文字列/bool リテラル or f./tf. 変数）を KS 表現へ変換する。 */
function convertOperand(token: string): { value: string; warning?: string; nonNumeric?: boolean } | { error: string } {
  const t = token.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return { value: t };
  const str = stringLiteral(t);
  if (str !== undefined) return { value: `"${str}"`, nonNumeric: true };
  if (t === 'true' || t === 'false') return { value: t, nonNumeric: true };
  const m = t.match(/^(f|tf|sf)\.([A-Za-z_]\w*)$/);
  if (!m) return { error: `unsupported operand "${t}" (only literals and f./tf. variables)` };
  if (m[1] === 'sf') return { error: `system variable "${t}" has no kaedevn equivalent` };
  return m[1] === 'tf' ? { value: m[2], warning: tfWarning(m[1], m[2]) } : { value: m[2] };
}

/** `'...'` / `"..."` リテラルなら中身を返す（内側に同種クォートが無い単純形のみ）。 */
function stringLiteral(t: string): string | undefined {
  let m = t.match(/^'([^']*)'$/);
  if (m) return m[1];
  m = t.match(/^"([^"]*)"$/);
  if (m) return m[1];
  return undefined;
}

function tfWarning(scope: string, name: string): string {
  return `[${scope}] variable "${scope}.${name}" mapped to kaedevn "${name}"; page-scope lifetime may differ.`;
}
