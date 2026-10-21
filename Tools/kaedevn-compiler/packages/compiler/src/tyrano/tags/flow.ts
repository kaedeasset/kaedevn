/**
 * 流れのタグ（[jump] [call] [return] [eval] と選択肢 [glink] [button] [s]）。
 */
import { normalizeTarget } from '../../tyranoParser.js';
import { convertAssignment } from '../../tyranoSemantics.js';
import { dynamicVarRef, expandDynamicTarget } from '../dynamicVars.js';
import type { TagHandler } from '../types.js';

/**
 * [jump]/[call] を KS ジャンプへ変換する。
 * - storage あり（ファイルパス）: `@jump <path.ks> [<label>]`（ファイル跨ぎ。filesToKs が解決）
 * - storage なし・target あり: `@jump <label>`（ファイル内ラベル）
 * storage は parseTagContent でクォート除去済み。target は先頭 `*` を除く。
 */
function crossFileJump(kind: '@jump' | '@call', storage?: string, target?: string): string | null {
  if (storage) {
    const label = target ? normalizeTarget(target) : undefined;
    return `${kind} ${storage.trim()}${label ? ` ${label}` : ''}`;
  }
  if (target) return `${kind} ${normalizeTarget(target)}`;
  return null;
}

const jumpOrCall: TagHandler = (node, ctx, arg) => {
  const kind = node.name === 'jump' ? '@jump' : ('@call' as const);
  const storage = arg('storage');
  const target = arg('target');

  // Rule A（設計 05）: storage が `&f.<v>` で、<v> がこのファイル内で
  // TYRANO.kag.stat.current_scenario（=自ファイル名）からのみ代入され、
  // 代入がこのタグより前なら、storage は自ファイルに畳み込める（コピペ可能化イディオム）。
  const storageVar = dynamicVarRef(storage);
  if (storageVar) {
    if (ctx.dyn.selfVars.has(storageVar) && ctx.dynEmitted.has(storageVar) && target) {
      return { kind: 'lines', lines: [`${kind} ${normalizeTarget(target)}`] };
    }
    return {
      kind: 'issue',
      severity: 'unsupported',
      message: `[${node.name}] storage "${storage}" is a runtime expression that cannot be resolved statically.`,
    };
  }

  // Rule C（設計 05）: target 全体が `&f.<s>` なら、代入の静的解析から
  // 有限のラベル候補を列挙し if/else ディスパッチへ展開する。
  const targetVar = dynamicVarRef(target);
  if (targetVar && !storage) {
    return expandDynamicTarget(kind, node, targetVar, ctx);
  }

  const line = crossFileJump(kind, storage, target);
  if (!line) return { kind: 'issue', severity: 'warning', message: `[${node.name}] has no storage/target attribute.` };
  return { kind: 'lines', lines: [line] };
};

const evalTag: TagHandler = (_node, ctx, arg) => {
  const exp = arg('exp');
  if (!exp) return { kind: 'issue', severity: 'warning', message: '[eval] has no exp attribute.' };
  // Rule B（設計 05）: 「現在のファイル名」エンジン API は変換時に定数畳み込みできる
  const selfM = exp.trim().match(/^f\.([A-Za-z_]\w*)\s*=\s*TYRANO\.kag\.stat\.current_scenario$/);
  if (selfM) {
    if (ctx.fileName) {
      const base = ctx.fileName.replace(/^.*\//, '');
      ctx.dynEmitted.add(selfM[1]);
      return { kind: 'lines', lines: [`${selfM[1]} = "${base}"`] };
    }
    return {
      kind: 'issue',
      severity: 'unsupported',
      message: '[eval] reads TYRANO.kag.stat.current_scenario but the converter was given no fileName context; manual migration needed.',
    };
  }
  // Rule C の連結代入（'<lit>' + f.<num>）は、その変数を消費する動的 jump/call が
  // 数値変数ディスパッチへ展開されるため、代入自体は実行時に不要になる。
  // 診断ノイズにせずコメントとして痕跡を残す。
  // ただし [if] の exp 等、jump/call 以外でも読まれる変数（readVars）の代入を
  // 消すと読み手が未代入になるため、その場合はコメント化せず通常変換に落とす
  // （安全サブセット外なら unsupported 診断になる）。
  const concatM = exp.trim().match(/^f\.([A-Za-z_]\w*)\s*=/);
  if (concatM && ctx.dyn.concatVars.has(concatM[1]) && !ctx.dyn.readVars.has(concatM[1])) {
    ctx.dynEmitted.add(concatM[1]);
    return { kind: 'lines', lines: [`; dispatch-expanded (design 05): ${exp.trim()}`] };
  }
  const res = convertAssignment(exp);
  if ('error' in res) {
    return { kind: 'issue', severity: 'unsupported', message: `[eval] is outside the safe subset (${res.error}); manual migration needed.` };
  }
  if (concatM) ctx.dynEmitted.add(concatM[1]);
  return { kind: 'lines', lines: [res.ks], warning: res.warning };
};

const choiceItem: TagHandler = (node, ctx, arg) => {
  const text = arg('text');
  const target = arg('target');
  const storage = arg('storage');
  if (!text || (!target && !storage)) {
    return { kind: 'issue', severity: 'warning', message: `[${node.name}] requires text and (target or storage).` };
  }
  return { kind: 'choice', buffer: [...ctx.choiceBuffer, { label: text, target: target ?? '', file: storage }] };
};

export const flowTags: Record<string, TagHandler> = {
  jump: jumpOrCall,
  call: jumpOrCall,
  return: () => ({ kind: 'lines', lines: ['@return'] }),
  eval: evalTag,
  glink: choiceItem,
  button: choiceItem,
  s: (_node, ctx) => ({ kind: 'choice', buffer: ctx.choiceBuffer }),
};
