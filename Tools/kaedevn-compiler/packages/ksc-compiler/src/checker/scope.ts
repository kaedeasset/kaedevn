/** KSC Scope Chain (Symbol Table) */

import type { SourceLocation } from '../types/ast.js';
import type { KscType } from '../types/ksc-type.js';

export interface SymbolInfo {
  name: string;
  type: KscType;
  mutable: boolean;
  declLoc: SourceLocation;
}

export type ScopeKind = 'global' | 'function' | 'block';

export class Scope {
  private symbols = new Map<string, SymbolInfo>();

  constructor(
    public readonly parent: Scope | null,
    public readonly kind: ScopeKind,
  ) {}

  /** 現在のスコープにシンボルを定義。重複の場合 false を返す */
  define(sym: SymbolInfo): boolean {
    if (this.symbols.has(sym.name)) return false;
    this.symbols.set(sym.name, sym);
    return true;
  }

  /** 親チェーンを辿ってシンボルを検索 */
  lookup(name: string): SymbolInfo | undefined {
    const local = this.symbols.get(name);
    if (local) return local;
    if (this.parent) return this.parent.lookup(name);
    return undefined;
  }

  /** 現在のスコープのみで検索（重複チェック用） */
  lookupLocal(name: string): SymbolInfo | undefined {
    return this.symbols.get(name);
  }

  /** 最も近い function スコープを取得 */
  findFunctionScope(): Scope | null {
    if (this.kind === 'function') return this;
    if (this.parent) return this.parent.findFunctionScope();
    return null;
  }
}
