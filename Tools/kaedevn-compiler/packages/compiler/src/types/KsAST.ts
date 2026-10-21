export type KsBlockType = 
  | 'command' 
  | 'text' 
  | 'label' 
  | 'if' 
  | 'else' 
  | 'endif' 
  | 'choice';

export interface KsBlock {
  id: string;           // GUIでの同一性特定用
  type: KsBlockType;
  line: number;         // ソース行番号
  raw: string;          // 元のテキスト（正規化前）
  command?: string;     // コマンド名（type='command'時）
  args?: Record<string, string | number | boolean>;
  // 順序保証つき位置引数（type='command'時、args より先に emit される）。
  // 位置引数を args の { 値: true } キーで表すと、JS の integer-like キー
  // 並べ替えで順序が崩れ、同値の位置引数はキー衝突で潰れる（例: @sprite の
  // spriteId と storage が同名）。複数の位置引数を持つコマンドはこちらを使う。
  positional?: string[];
  content?: string;     // セリフ本文（type='text'時）
  children?: KsBlock[]; // ブロック構造用（IFのthen部分など）
  elseChildren?: KsBlock[]; // ELSE部分
}

export interface KsAST {
  blocks: KsBlock[];
}
