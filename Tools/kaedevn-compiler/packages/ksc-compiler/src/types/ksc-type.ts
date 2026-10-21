/** KSC Type System */

import type { TypeAnnotation } from './ast.js';

// ---- Type Definitions ----

export interface ParamInfo {
  name: string;
  type: KscType;
  optional?: boolean;
}

export type KscType =
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'void' }
  | { kind: 'array'; element: KscType }
  | { kind: 'object'; fields: Map<string, KscType> }
  | { kind: 'union'; members: KscType[] }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'function'; params: ParamInfo[]; returnType: KscType }
  | { kind: 'promise'; inner: KscType }
  | { kind: 'error' };  // エラー回復用（カスケード防止）

// ---- Singleton Constants ----

export const NUMBER_TYPE: KscType = { kind: 'number' };
export const STRING_TYPE: KscType = { kind: 'string' };
export const BOOLEAN_TYPE: KscType = { kind: 'boolean' };
export const NULL_TYPE: KscType = { kind: 'null' };
export const UNDEFINED_TYPE: KscType = { kind: 'undefined' };
export const VOID_TYPE: KscType = { kind: 'void' };
export const ERROR_TYPE: KscType = { kind: 'error' };

// ---- Utilities ----

/** 型を可読文字列に変換（エラーメッセージ用） */
export function typeToString(t: KscType): string {
  switch (t.kind) {
    case 'number': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'undefined': return 'undefined';
    case 'void': return 'void';
    case 'error': return '<error>';
    case 'array': return `${typeToString(t.element)}[]`;
    case 'object': {
      const entries: string[] = [];
      for (const [k, v] of t.fields) {
        entries.push(`${k}: ${typeToString(v)}`);
      }
      return `{ ${entries.join('; ')} }`;
    }
    case 'union':
      return t.members.map(typeToString).join(' | ');
    case 'literal':
      return typeof t.value === 'string' ? `"${t.value}"` : String(t.value);
    case 'function': {
      const params = t.params.map(p =>
        `${p.name}${p.optional ? '?' : ''}: ${typeToString(p.type)}`
      ).join(', ');
      return `(${params}) => ${typeToString(t.returnType)}`;
    }
    case 'promise':
      return `Promise<${typeToString(t.inner)}>`;
  }
}

/** 代入互換性チェック: source を target に代入できるか */
export function isAssignableTo(source: KscType, target: KscType): boolean {
  // error は常に互換（カスケード防止）
  if (source.kind === 'error' || target.kind === 'error') return true;

  // void は void にのみ代入可能
  if (target.kind === 'void') return source.kind === 'void';

  // null は null / undefined / union(null含む) に代入可能
  if (source.kind === 'null') {
    if (target.kind === 'null') return true;
    if (target.kind === 'union') return target.members.some(m => isAssignableTo(source, m));
    return false;
  }
  if (source.kind === 'undefined') {
    if (target.kind === 'undefined') return true;
    if (target.kind === 'union') return target.members.some(m => isAssignableTo(source, m));
    return false;
  }

  // 同種プリミティブ
  if (source.kind === target.kind &&
      (source.kind === 'number' || source.kind === 'string' || source.kind === 'boolean')) {
    return true;
  }

  // literal → 対応するプリミティブ
  if (source.kind === 'literal') {
    const baseKind = typeof source.value === 'string' ? 'string'
      : typeof source.value === 'number' ? 'number' : 'boolean';
    if (target.kind === baseKind) return true;
    if (target.kind === 'literal') return source.value === target.value;
    if (target.kind === 'union') return target.members.some(m => isAssignableTo(source, m));
    return false;
  }

  // プリミティブ → literal は不可
  if (target.kind === 'literal') {
    if (source.kind === 'union') return source.members.every(m => isAssignableTo(m, target));
    return false;
  }

  // union source: 全メンバーが target に代入可能（union→union の場合もこちらが先）
  if (source.kind === 'union') {
    return source.members.every(m => isAssignableTo(m, target));
  }

  // union target: source が少なくとも 1 つのメンバーに代入可能
  if (target.kind === 'union') {
    return target.members.some(m => isAssignableTo(source, m));
  }

  // array
  if (source.kind === 'array' && target.kind === 'array') {
    return isAssignableTo(source.element, target.element);
  }

  // object (構造的部分型)
  if (source.kind === 'object' && target.kind === 'object') {
    for (const [key, targetFieldType] of target.fields) {
      const sourceFieldType = source.fields.get(key);
      if (!sourceFieldType) return false;
      if (!isAssignableTo(sourceFieldType, targetFieldType)) return false;
    }
    return true;
  }

  // function
  if (source.kind === 'function' && target.kind === 'function') {
    // 引数数チェック
    const sourceRequired = source.params.filter(p => !p.optional).length;
    const targetRequired = target.params.filter(p => !p.optional).length;
    if (sourceRequired > targetRequired) return false;
    // 引数型は反変
    for (let i = 0; i < Math.min(source.params.length, target.params.length); i++) {
      if (!isAssignableTo(target.params[i].type, source.params[i].type)) return false;
    }
    // 戻り値型は共変
    return isAssignableTo(source.returnType, target.returnType);
  }

  // promise
  if (source.kind === 'promise' && target.kind === 'promise') {
    return isAssignableTo(source.inner, target.inner);
  }

  return false;
}

/** 構造的型等価 */
export function typesEqual(a: KscType, b: KscType): boolean {
  return isAssignableTo(a, b) && isAssignableTo(b, a);
}

/** AST の TypeAnnotation → KscType 変換 */
export function resolveAnnotation(
  ann: TypeAnnotation,
  aliases: Map<string, KscType>,
): KscType {
  switch (ann.kind) {
    case 'named': {
      const name = ann.name;
      // プリミティブ
      if (name === 'number') return NUMBER_TYPE;
      if (name === 'string') return STRING_TYPE;
      if (name === 'boolean') return BOOLEAN_TYPE;
      if (name === 'void') return VOID_TYPE;
      if (name === 'null') return NULL_TYPE;
      if (name === 'undefined') return UNDEFINED_TYPE;
      // 型エイリアス
      const alias = aliases.get(name);
      if (alias) return alias;
      // 不明な型はエラー
      return ERROR_TYPE;
    }
    case 'array':
      return { kind: 'array', element: resolveAnnotation(ann.element, aliases) };
    case 'object': {
      const fields = new Map<string, KscType>();
      for (const f of ann.fields) {
        fields.set(f.name, resolveAnnotation(f.type, aliases));
      }
      return { kind: 'object', fields };
    }
    case 'union':
      return { kind: 'union', members: ann.members.map(m => resolveAnnotation(m, aliases)) };
    case 'function':
      return {
        kind: 'function',
        params: ann.params.map(p => ({ name: p.name, type: resolveAnnotation(p.type, aliases) })),
        returnType: resolveAnnotation(ann.returnType, aliases),
      };
    case 'literal':
      return { kind: 'literal', value: ann.value };
    case 'promise':
      return { kind: 'promise', inner: resolveAnnotation(ann.inner, aliases) };
  }
}
