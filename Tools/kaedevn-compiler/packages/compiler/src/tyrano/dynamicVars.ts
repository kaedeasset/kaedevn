// ======================================================================
// 動的ジャンプの静的展開
// 「列挙・照合・定数畳み込みで決まるものは全部 TS」— LLM は使わない。
// 解析できない代入が1つでも混ざる変数は畳み込まず診断へ倒す（健全性優先）。
// ======================================================================
import { normalizeTarget, type TyranoNode, type TyranoTagNode } from '../tyranoParser.js';
import type { ConvertContext, TagLines, TagIssue } from './types.js';

/** [eval] 代入とラベルのプリスキャン結果。 */
export interface DynamicVarScan {
  /** 全代入が TYRANO.kag.stat.current_scenario 形の変数 → 最初の代入行。 */
  selfVars: Map<string, number>;
  /** 全代入が `'<lit>' + f.<num>` 形（同一 lit/num）の変数。 */
  concatVars: Map<string, { litPrefix: string; numVar: string; firstLine: number }>;
  /** 全代入が文字列リテラルの変数 → 値集合（出現順）。 */
  literalVars: Map<string, { values: string[]; firstLine: number }>;
  /** このファイル内のラベル名（parser 正規化済み）。 */
  labels: Set<string>;
  /**
   * jump/call の storage/target 以外で読まれる f.変数（[if]/[elsif] の exp、
   * [eval] の右辺、[emb] や & 前置のタグ属性）。dispatch 展開で代入を
   * コメント化してよいのは「動的 jump/call でしか消費されない」変数のみで、
   * ここに含まれる変数の代入は消してはいけない。
   */
  readVars: Set<string>;
}

/** AST を1パスして [eval] の f.変数代入の形とラベルを分類する（ブロック内も再帰）。 */
export function scanDynamicVars(nodes: TyranoNode[]): DynamicVarScan {
  const kinds = new Map<string, Set<string>>();
  const tyranoLine = new Map<string, number>();
  const concat = new Map<string, { litPrefix: string; numVar: string; firstLine: number }>();
  const literals = new Map<string, { values: string[]; firstLine: number }>();
  const labels = new Set<string>();
  const readVars = new Set<string>();

  const addKind = (v: string, k: string) => {
    if (!kinds.has(v)) kinds.set(v, new Set());
    kinds.get(v)!.add(k);
  };

  // 式文字列中の f.変数参照を read として収集する（tf./sf. は \b で除外される）
  const collectReads = (src: unknown): void => {
    if (typeof src !== 'string') return;
    for (const m of src.matchAll(/\bf\.([A-Za-z_]\w*)/g)) readVars.add(m[1]);
  };

  const walk = (ns: TyranoNode[]): void => {
    for (const n of ns) {
      if (n.type === 'label') labels.add(n.name);
      if (n.type === 'block') {
        if (n.name === 'if') collectReads(n.args.exp);
        walk(n.children);
      }
      if (n.type !== 'tag') continue;
      if (n.name !== 'eval') {
        if (n.name === 'elsif' || n.name === 'emb') {
          collectReads(n.args.exp);
        } else {
          // & 前置の JS 式属性は read。ただし jump/call の storage/target は
          // dispatch 展開の消費側そのものなので read には数えない。
          for (const [key, value] of Object.entries(n.args)) {
            if (typeof value !== 'string' || !value.trim().startsWith('&')) continue;
            if ((n.name === 'jump' || n.name === 'call') && (key === 'storage' || key === 'target')) continue;
            collectReads(value);
          }
        }
        continue;
      }
      const exp = typeof n.args.exp === 'string' ? n.args.exp.trim() : '';
      const m = exp.match(/^f\.([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (!m) {
        collectReads(exp); // 代入形でない [eval]（比較・複合代入など）は全参照を read 扱い
        continue;
      }
      const [, v, rhsRaw] = m;
      collectReads(rhsRaw); // 代入右辺の f.変数参照は read
      const rhs = rhsRaw.trim();
      if (rhs === 'TYRANO.kag.stat.current_scenario') {
        addKind(v, 'tyrano');
        if (!tyranoLine.has(v)) tyranoLine.set(v, n.loc.line);
        continue;
      }
      const cm = rhs.match(/^(['"])(.+?)\1\s*\+\s*f\.([A-Za-z_]\w*)$/);
      if (cm) {
        const cur = concat.get(v);
        if (!cur) concat.set(v, { litPrefix: cm[2], numVar: cm[3], firstLine: n.loc.line });
        else if (cur.litPrefix !== cm[2] || cur.numVar !== cm[3]) addKind(v, 'concat-mixed');
        addKind(v, 'concat');
        continue;
      }
      const lm = rhs.match(/^(['"])(.*)\1$/);
      if (lm) {
        addKind(v, 'literal');
        if (!literals.has(v)) literals.set(v, { values: [], firstLine: n.loc.line });
        const entry = literals.get(v)!;
        if (!entry.values.includes(lm[2])) entry.values.push(lm[2]);
        continue;
      }
      addKind(v, 'other');
    }
  };
  walk(nodes);

  const only = (v: string, k: string) => kinds.get(v)?.size === 1 && kinds.get(v)!.has(k);
  return {
    selfVars: new Map([...tyranoLine].filter(([v]) => only(v, 'tyrano'))),
    concatVars: new Map([...concat].filter(([v]) => only(v, 'concat'))),
    literalVars: new Map([...literals].filter(([v]) => only(v, 'literal'))),
    labels,
    readVars,
  };
}

/** `&f.<var>` / `& f.<var>` 形の実行時変数参照なら変数名を返す。 */
export function dynamicVarRef(value?: string): string | undefined {
  return value?.match(/^&\s*f\.([A-Za-z_]\w*)$/)?.[1];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rule C: `[jump|call target="&f.<s>"]` を有限ラベル候補の if/else ディスパッチへ展開する。
 * 出力は convertIfBlock と同じ brace 形式（`if (cond) {` / `} else {` / `}`）。
 */
export function expandDynamicTarget(
  kind: '@jump' | '@call',
  node: TyranoTagNode,
  varName: string,
  ctx: ConvertContext,
): TagLines | TagIssue {
  const { concatVars, literalVars, labels } = ctx.dyn;

  const dispatch = (cases: Array<{ cond: string; label: string }>, warning?: string) => {
    const lines: string[] = [];
    cases.forEach((c, i) => {
      lines.push(`if (${c.cond}) {`);
      lines.push(`${kind} ${c.label}`);
      if (i < cases.length - 1) lines.push('} else {');
    });
    for (let i = 0; i < cases.length * 2 - 1; i += 2) lines.push('}');
    return { kind: 'lines' as const, lines, warning };
  };

  const concat = concatVars.get(varName);
  if (concat && ctx.dynEmitted.has(varName)) {
    const base = normalizeTarget(concat.litPrefix);
    const re = new RegExp(`^${escapeRegExp(base)}(\\d+)$`);
    const cands = [...labels]
      .map((l) => ({ label: l, m: l.match(re) }))
      .filter((x): x is { label: string; m: RegExpMatchArray } => x.m !== null)
      .map((x) => ({ label: x.label, n: Number(x.m[1]) }))
      .sort((a, b) => a.n - b.n);
    if (cands.length === 0) {
      return { kind: 'issue', severity: 'unsupported', message: `[${node.name}] target "&f.${varName}" has no matching labels "${base}<n>" in this file.` };
    }
    return dispatch(cands.map((c) => ({ cond: `${concat.numVar} == ${c.n}`, label: c.label })));
  }

  const lit = literalVars.get(varName);
  if (lit && ctx.dynEmitted.has(varName)) {
    const cands = lit.values
      .map((v) => ({ v, label: normalizeTarget(v) }))
      .filter((x) => labels.has(x.label));
    if (cands.length === 0) {
      return { kind: 'issue', severity: 'unsupported', message: `[${node.name}] target "&f.${varName}" has no assigned value matching a label in this file.` };
    }
    const warning = cands.length < lit.values.length
      ? `[${node.name}] some values assigned to f.${varName} have no matching label and were omitted from the dispatch: ${lit.values.filter((v) => !labels.has(normalizeTarget(v))).join(', ')}`
      : undefined;
    return dispatch(cands.map((c) => ({ cond: `${varName} == "${c.v}"`, label: c.label })), warning);
  }

  return { kind: 'issue', severity: 'unsupported', message: `[${node.name}] target "&f.${varName}" is a runtime expression that cannot be resolved statically.` };
}
