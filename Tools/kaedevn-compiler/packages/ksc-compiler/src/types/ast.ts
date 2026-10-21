/** KSC AST Node Types */

// ---- Source Location ----
export interface SourceLocation {
  line: number;
  column: number;
  file?: string;  // Source file path (for multi-file / import support)
}

// ---- Type Annotations ----
export type TypeAnnotation =
  | { kind: 'named'; name: string }                              // number, string, boolean, void, etc.
  | { kind: 'array'; element: TypeAnnotation }                   // T[]
  | { kind: 'object'; fields: { name: string; type: TypeAnnotation }[] }  // { key: T }
  | { kind: 'union'; members: TypeAnnotation[] }                 // A | B
  | { kind: 'literal'; value: string | number | boolean }        // "win" | 42
  | { kind: 'promise'; inner: TypeAnnotation }                   // Promise<T> (Phase 1 Day 21)
  | { kind: 'function'; params: { name: string; type: TypeAnnotation }[]; returnType: TypeAnnotation }; // (a: T) => U (Phase 1 #13 V1)

// ---- Expressions ----
export type Expression =
  | NumberLiteral
  | StringLiteral
  | TemplateLiteral
  | BooleanLiteral
  | NullLiteral
  | UndefinedLiteral
  | Identifier
  | BinaryExpr
  | UnaryExpr
  | AssignExpr
  | CallExpr
  | MemberExpr
  | IndexExpr
  | TernaryExpr
  | ArrayLiteral
  | ObjectLiteral
  | AwaitExpr;

export interface NumberLiteral {
  kind: 'NumberLiteral';
  value: number;
  loc: SourceLocation;
}

export interface StringLiteral {
  kind: 'StringLiteral';
  value: string;
  loc: SourceLocation;
}

export interface TemplateLiteral {
  kind: 'TemplateLiteral';
  parts: (string | Expression)[];
  loc: SourceLocation;
}

export interface BooleanLiteral {
  kind: 'BooleanLiteral';
  value: boolean;
  loc: SourceLocation;
}

export interface NullLiteral {
  kind: 'NullLiteral';
  loc: SourceLocation;
}

export interface UndefinedLiteral {
  kind: 'UndefinedLiteral';
  loc: SourceLocation;
}

export interface Identifier {
  kind: 'Identifier';
  name: string;
  loc: SourceLocation;
}

export interface BinaryExpr {
  kind: 'BinaryExpr';
  op: string;
  left: Expression;
  right: Expression;
  loc: SourceLocation;
}

export interface UnaryExpr {
  kind: 'UnaryExpr';
  op: string;
  operand: Expression;
  loc: SourceLocation;
}

export interface AssignExpr {
  kind: 'AssignExpr';
  op: string;  // '=' | '+=' | '-=' | '*=' | '/='
  target: Expression;
  value: Expression;
  loc: SourceLocation;
}

export interface CallExpr {
  kind: 'CallExpr';
  callee: Expression;
  args: Expression[];
  loc: SourceLocation;
}

export interface MemberExpr {
  kind: 'MemberExpr';
  object: Expression;
  property: string;
  loc: SourceLocation;
}

export interface IndexExpr {
  kind: 'IndexExpr';
  object: Expression;
  index: Expression;
  loc: SourceLocation;
}

export interface TernaryExpr {
  kind: 'TernaryExpr';
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
  loc: SourceLocation;
}

export interface ArrayLiteral {
  kind: 'ArrayLiteral';
  elements: Expression[];
  loc: SourceLocation;
}

export interface ObjectLiteral {
  kind: 'ObjectLiteral';
  fields: { key: string; value: Expression }[];
  loc: SourceLocation;
}

export interface AwaitExpr {
  kind: 'AwaitExpr';
  argument: Expression;
  loc: SourceLocation;
}

// ---- Statements ----
export type Statement =
  | VariableDecl
  | FunctionDecl
  | ReturnStmt
  | IfStmt
  | ForStmt
  | WhileStmt
  | SwitchStmt
  | BreakStmt
  | ContinueStmt
  | LabelStmt
  | JumpStmt
  | ExpressionStmt
  | BlockStmt
  | TypeAliasDecl
  | ImportDecl
  | ExportDecl
  | DialogueBlock
  | AtCommandStmt;

export interface VariableDecl {
  kind: 'VariableDecl';
  name: string;
  mutable: boolean;       // let = true, const = false
  typeAnnotation: TypeAnnotation | null;
  init: Expression | null;
  exported: boolean;
  loc: SourceLocation;
}

export interface FunctionParam {
  name: string;
  type: TypeAnnotation;
}

export interface FunctionDecl {
  kind: 'FunctionDecl';
  name: string;
  params: FunctionParam[];
  returnType: TypeAnnotation;
  body: BlockStmt;
  exported: boolean;
  /** `async function` flag (Phase 1 Day 21). Implicitly wraps returnType in Promise<...>. */
  isAsync?: boolean;
  /**
   * Phase 1 #7: when set, this FunctionDecl is a class method. The checker
   * will pre-define `this` of this type in the body's scope. The VM injects
   * the receiver as a `this` local at CALL_METHOD time (no emitter change).
   */
  thisType?: TypeAnnotation;
  loc: SourceLocation;
}

export interface ReturnStmt {
  kind: 'ReturnStmt';
  value: Expression | null;
  loc: SourceLocation;
}

export interface IfStmt {
  kind: 'IfStmt';
  condition: Expression;
  consequent: BlockStmt;
  alternate: Statement | null;  // IfStmt (else if) | BlockStmt (else) | null
  loc: SourceLocation;
}

export interface ForStmt {
  kind: 'ForStmt';
  init: Statement | null;
  condition: Expression | null;
  update: Expression | null;
  body: BlockStmt;
  loc: SourceLocation;
}

export interface WhileStmt {
  kind: 'WhileStmt';
  condition: Expression;
  body: BlockStmt;
  loc: SourceLocation;
}

export interface SwitchCase {
  test: Expression | null;  // null = default
  body: Statement[];
}

export interface SwitchStmt {
  kind: 'SwitchStmt';
  discriminant: Expression;
  cases: SwitchCase[];
  loc: SourceLocation;
}

export interface BreakStmt {
  kind: 'BreakStmt';
  loc: SourceLocation;
}

export interface ContinueStmt {
  kind: 'ContinueStmt';
  loc: SourceLocation;
}

/** `label foo` — ジャンプの飛び先（KS の `*foo` に対応） */
export interface LabelStmt {
  kind: 'LabelStmt';
  name: string;
  loc: SourceLocation;
}

/** `jump foo` — ラベルへ無条件ジャンプ（KS の `@jump foo` に対応） */
export interface JumpStmt {
  kind: 'JumpStmt';
  label: string;
  loc: SourceLocation;
}

/**
 * 行頭 `@word …` の KS シーンコマンド行（P6-9 混在）。
 * raw は `@` を除いた行テキスト。emit 時に注入された atCommandParser で Op 化され、
 * HOST_CALL("execOp", [opJson]) として実行される。@jump は parser で JumpStmt に desugar
 * されるため、この node に pc 系コマンドは入らない。
 */
export interface AtCommandStmt {
  kind: 'AtCommandStmt';
  raw: string;
  loc: SourceLocation;
}

export interface ExpressionStmt {
  kind: 'ExpressionStmt';
  expression: Expression;
  loc: SourceLocation;
}

export interface BlockStmt {
  kind: 'BlockStmt';
  body: Statement[];
  loc: SourceLocation;
}

export interface TypeAliasDecl {
  kind: 'TypeAliasDecl';
  name: string;
  type: TypeAnnotation;
  exported: boolean;
  loc: SourceLocation;
}

export interface ImportDecl {
  kind: 'ImportDecl';
  specifiers: { imported: string; local: string }[];  // { pickSkill } or { x as y }
  namespace: string | null;                             // * as Battle
  source: string;                                       // "battle/api"
  loc: SourceLocation;
}

export interface ExportDecl {
  kind: 'ExportDecl';
  declaration: Statement;
  loc: SourceLocation;
}

export interface DialogueLine {
  text: string;
  command?: 'r' | 'l' | 'p';
}

export interface DialogueBlock {
  kind: 'DialogueBlock';
  speaker: string;
  lines: DialogueLine[];
  loc: SourceLocation;
}

// ---- Program (root) ----
export interface Program {
  kind: 'Program';
  body: Statement[];
  loc: SourceLocation;
}
