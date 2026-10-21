/** KSC Token types */
export enum TokenType {
  // Literals
  Number = 'Number',
  String = 'String',
  TemplateString = 'TemplateString',
  Boolean = 'Boolean',
  Null = 'Null',
  Undefined = 'Undefined',

  // Identifiers & Keywords
  Identifier = 'Identifier',
  Let = 'Let',
  Const = 'Const',
  Function = 'Function',
  Return = 'Return',
  If = 'If',
  Else = 'Else',
  For = 'For',
  While = 'While',
  Switch = 'Switch',
  Case = 'Case',
  Default = 'Default',
  Break = 'Break',
  Continue = 'Continue',
  Label = 'Label',
  Jump = 'Jump',
  Await = 'Await',
  Async = 'Async',
  Import = 'Import',
  From = 'From',
  Export = 'Export',
  Type = 'Type',
  Void = 'Void',
  // Class syntax sugar (Phase 1 #7) — desugared in parser.
  // `extends` / `super` are reserved for future inheritance support.
  Class = 'Class',
  New = 'New',
  This = 'This',
  Extends = 'Extends',
  Super = 'Super',

  // Operators
  Plus = 'Plus',             // +
  Minus = 'Minus',           // -
  Star = 'Star',             // *
  Slash = 'Slash',           // /
  Percent = 'Percent',       // %
  Eq = 'Eq',                 // ==
  NotEq = 'NotEq',           // !=
  Lt = 'Lt',                 // <
  LtEq = 'LtEq',            // <=
  Gt = 'Gt',                 // >
  GtEq = 'GtEq',            // >=
  And = 'And',               // &&
  Or = 'Or',                 // ||
  Not = 'Not',               // !
  Assign = 'Assign',         // =
  PlusAssign = 'PlusAssign', // +=
  MinusAssign = 'MinusAssign', // -=
  StarAssign = 'StarAssign', // *=
  SlashAssign = 'SlashAssign', // /=
  PercentAssign = 'PercentAssign', // %=

  // Delimiters
  LParen = 'LParen',         // (
  RParen = 'RParen',         // )
  LBrace = 'LBrace',         // {
  RBrace = 'RBrace',         // }
  LBracket = 'LBracket',     // [
  RBracket = 'RBracket',     // ]
  Comma = 'Comma',           // ,
  Colon = 'Colon',           // :
  Semicolon = 'Semicolon',   // ;
  Dot = 'Dot',               // .
  Arrow = 'Arrow',           // =>
  Pipe = 'Pipe',             // | (for union types)
  QuestionMark = 'QuestionMark', // ?

  // Special
  Hash = 'Hash',             // # (dialogue block delimiter)
  InlineCommand = 'InlineCommand', // @r, @l, @p (dialogue inline commands)
  // P6-9 行頭ディスパッチ（KS シーンコマンド混在）
  AtCommandLine = 'AtCommandLine', // 行頭 @word … （value は @ を除いた行テキスト）
  LabelLine = 'LabelLine',         // 行頭 *name （value はラベル名。label 文へ desugar）

  // End
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

/** Keywords mapping */
export const KEYWORDS: Record<string, TokenType> = {
  let: TokenType.Let,
  const: TokenType.Const,
  function: TokenType.Function,
  return: TokenType.Return,
  if: TokenType.If,
  else: TokenType.Else,
  for: TokenType.For,
  while: TokenType.While,
  switch: TokenType.Switch,
  case: TokenType.Case,
  default: TokenType.Default,
  break: TokenType.Break,
  continue: TokenType.Continue,
  label: TokenType.Label,
  jump: TokenType.Jump,
  await: TokenType.Await,
  async: TokenType.Async,
  import: TokenType.Import,
  from: TokenType.From,
  export: TokenType.Export,
  type: TokenType.Type,
  void: TokenType.Void,
  true: TokenType.Boolean,
  false: TokenType.Boolean,
  null: TokenType.Null,
  undefined: TokenType.Undefined,
  // Class syntax sugar
  class: TokenType.Class,
  new: TokenType.New,
  this: TokenType.This,
  extends: TokenType.Extends,
  super: TokenType.Super,
};
