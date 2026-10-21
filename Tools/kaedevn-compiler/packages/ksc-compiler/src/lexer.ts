import { Token, TokenType, KEYWORDS } from './types/token.js';

export class LexerError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number,
  ) {
    super(`[L${line}:${column}] ${message}`);
    this.name = 'LexerError';
  }
}

export function tokenize(source: string): Token[] {
  return new Lexer(source).run();
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

const SINGLE_CHAR_OPS: Record<string, TokenType> = {
  '(': TokenType.LParen,
  ')': TokenType.RParen,
  '{': TokenType.LBrace,
  '}': TokenType.RBrace,
  '[': TokenType.LBracket,
  ']': TokenType.RBracket,
  ',': TokenType.Comma,
  ':': TokenType.Colon,
  ';': TokenType.Semicolon,
  '.': TokenType.Dot,
  '?': TokenType.QuestionMark,
};

/** 1 文字目 → [続く文字, 2 文字のときの種類, 1 文字のときの種類] */
const TWO_CHAR_OPS: Record<string, [string, TokenType, TokenType]> = {
  '|': ['|', TokenType.Or, TokenType.Pipe],
  '+': ['=', TokenType.PlusAssign, TokenType.Plus],
  '-': ['=', TokenType.MinusAssign, TokenType.Minus],
  '*': ['=', TokenType.StarAssign, TokenType.Star],
  '/': ['=', TokenType.SlashAssign, TokenType.Slash],
  '%': ['=', TokenType.PercentAssign, TokenType.Percent],
  '<': ['=', TokenType.LtEq, TokenType.Lt],
  '>': ['=', TokenType.GtEq, TokenType.Gt],
};

/** 字句解析の状態（位置・行・列・出したトークン）を持つ。tokenize() が 1 回ごとに作る。 */
class Lexer {
  private readonly tokens: Token[] = [];
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  run(): Token[] {
    while (!this.atEnd()) {
      this.skipWhitespace();
      if (this.atEnd()) break;
      this.readToken();
    }
    this.addToken(TokenType.EOF, '', this.line, this.column);
    return this.tokens;
  }

  // ---- 文字の読み進め ----

  private peek(): string {
    return this.source[this.pos] ?? '\0';
  }

  private peekNext(): string {
    return this.source[this.pos + 1] ?? '\0';
  }

  private atEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private advance(): string {
    const ch = this.source[this.pos] ?? '\0';
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private addToken(type: TokenType, value: string, startLine: number, startCol: number): void {
    this.tokens.push({ type, value, line: startLine, column: startCol });
  }

  /** 直前のトークンが前の行にある（＝いまの位置が行頭）。 */
  private atLineStart(startLine: number): boolean {
    return this.tokens.length === 0 || this.tokens[this.tokens.length - 1].line < startLine;
  }

  private skipInlineWhitespace(): void {
    while (!this.atEnd() && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
    }
  }

  private skipToEndOfLine(): void {
    while (!this.atEnd() && this.peek() !== '\n') this.advance();
  }

  private readRestOfLine(): string {
    let rest = '';
    while (!this.atEnd() && this.peek() !== '\n') {
      rest += this.advance();
    }
    return rest;
  }

  private peekRestOfLine(): string {
    let i = this.pos;
    let rest = '';
    while (i < this.source.length && this.source[i] !== '\n') {
      rest += this.source[i];
      i++;
    }
    return rest;
  }

  private skipWhitespace(): void {
    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
      } else if (ch === '/' && this.peekNext() === '/') {
        // Line comment
        this.skipToEndOfLine();
      } else if (ch === '/' && this.peekNext() === '*') {
        this.skipBlockComment();
      } else {
        break;
      }
    }
  }

  private skipBlockComment(): void {
    const commentLine = this.line;
    const commentCol = this.column;
    this.advance(); this.advance(); // skip /*
    while (!this.atEnd()) {
      if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance(); this.advance(); // skip */
        return;
      }
      this.advance();
    }
    throw new LexerError('Unterminated block comment', commentLine, commentCol);
  }

  // ---- 字句の種類ごとの読み取り ----

  /** 空白を飛ばした位置から 1 つ読む（対話ブロックは複数のトークンを出す）。 */
  private readToken(): void {
    const startLine = this.line;
    const startCol = this.column;
    const ch = this.peek();

    if (ch >= '0' && ch <= '9') {
      this.addToken(TokenType.Number, this.readNumber(), startLine, startCol);
    } else if (isIdentStart(ch)) {
      this.readIdentifierOrKeyword(startLine, startCol);
    } else if (ch === '"' || ch === "'") {
      this.addToken(TokenType.String, this.readString(ch), startLine, startCol);
    } else if (ch === '`') {
      this.addToken(TokenType.TemplateString, this.readTemplateString(), startLine, startCol);
    } else if (ch === '@') {
      this.readAtCommandLine(startLine, startCol);
    } else if (ch === '*' && this.atLineStart(startLine) && isIdentStart(this.peekNext())) {
      // P6-9 行頭ディスパッチ: *name は KS 風ラベル行（label 文へ desugar）。
      // 乗算と区別するため「行頭 かつ `*` 直後に空白なしで識別子」の場合のみ。
      // それ以外の `*` は従来の乗算/複合代入（readOperator が処理）。
      this.advance(); // skip '*'
      this.addToken(TokenType.LabelLine, this.readIdentifier(), startLine, startCol);
    } else if (ch === '#') {
      this.readDialogueBlock(startLine, startCol);
    } else {
      this.readOperator(startLine, startCol);
    }
  }

  private readString(quote: string): string {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // skip opening quote
    let value = '';
    while (!this.atEnd() && this.peek() !== quote) {
      if (this.peek() === '\\') {
        this.advance(); // skip backslash
        const esc = this.advance();
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case "'": value += "'"; break;
          case '"': value += '"'; break;
          default: value += esc;
        }
      } else {
        value += this.advance();
      }
    }
    if (this.atEnd()) {
      throw new LexerError('Unterminated string', startLine, startCol);
    }
    this.advance(); // skip closing quote
    return value;
  }

  private readTemplateString(): string {
    this.advance(); // skip opening backtick
    let raw = '';
    while (!this.atEnd() && this.peek() !== '`') {
      if (this.peek() === '\\') {
        raw += this.advance();
        raw += this.advance();
      } else {
        raw += this.advance();
      }
    }
    if (this.atEnd()) {
      throw new LexerError('Unterminated template string', this.line, this.column);
    }
    this.advance(); // skip closing backtick
    return raw;
  }

  private readNumber(): string {
    let num = '';
    let hasDot = false;
    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch >= '0' && ch <= '9') {
        num += this.advance();
      } else if (ch === '.' && !hasDot && this.peekNext() >= '0' && this.peekNext() <= '9') {
        hasDot = true;
        num += this.advance();
      } else {
        break;
      }
    }
    return num;
  }

  private readIdentifier(): string {
    let id = '';
    while (!this.atEnd()) {
      const ch = this.peek();
      if (isIdentStart(ch) || (ch >= '0' && ch <= '9')) {
        id += this.advance();
      } else {
        break;
      }
    }
    return id;
  }

  private readIdentifierOrKeyword(startLine: number, startCol: number): void {
    const id = this.readIdentifier();
    // Use hasOwn to avoid Object.prototype keys (constructor, toString, …)
    // accidentally resolving as keywords.
    const kwType = Object.prototype.hasOwnProperty.call(KEYWORDS, id)
      ? KEYWORDS[id]
      : undefined;
    this.addToken(kwType ?? TokenType.Identifier, id, startLine, startCol);
  }

  /**
   * P6-9 行頭ディスパッチ: @word … は KS シーンコマンド行。
   * `@` はこれまで常に LexerError（式には現れない）だったため既存コードと衝突しない。
   * 行頭（直前トークンが前の行）以外の `@` は従来どおりエラー。
   */
  private readAtCommandLine(startLine: number, startCol: number): void {
    if (!this.atLineStart(startLine)) {
      throw new LexerError(`Unexpected character '@' (@ command lines must start at the beginning of a line)`, startLine, startCol);
    }
    this.advance(); // skip '@'
    if (!isIdentStart(this.peek())) {
      throw new LexerError(`'@' must be followed by a command name (e.g. @bg, @text)`, startLine, startCol);
    }
    const rest = this.readRestOfLine();
    this.addToken(TokenType.AtCommandLine, rest.replace(/\r$/, '').trim(), startLine, startCol);
  }

  /** Dialogue block: #speaker\nline1\nline2\n# */
  private readDialogueBlock(startLine: number, startCol: number): void {
    this.advance(); // skip '#'

    // Check if this is a closing '#' (only whitespace before newline/EOF)
    if (this.peekRestOfLine().trim() === '') {
      // Closing # — emit Hash token, then skip to end of line
      this.addToken(TokenType.Hash, '#', startLine, startCol);
      this.skipToEndOfLine();
      return;
    }

    // Opening # — emit Hash token
    this.addToken(TokenType.Hash, '#', startLine, startCol);

    // Read optional speaker name (identifier on same line)
    this.skipInlineWhitespace();
    if (!this.atEnd() && this.peek() !== '\n' && this.peek() !== '"' && this.peek() !== "'") {
      const spLine = this.line;
      const spCol = this.column;
      if (isIdentStart(this.peek())) {
        this.addToken(TokenType.Identifier, this.readIdentifier(), spLine, spCol);
      }
    }

    // If there's a quoted string on the same line, let the main loop handle it
    // (existing behavior: # speaker "text" "text2")
    this.skipInlineWhitespace();
    if (!this.atEnd() && (this.peek() === '"' || this.peek() === "'")) {
      return;
    }

    // Skip to next line
    this.skipToEndOfLine();
    if (!this.atEnd()) this.advance(); // skip \n

    this.readDialogueLines();
  }

  /** 対話ブロックの本文を、'#' だけの行まで 1 行ずつ String（と InlineCommand）にする。 */
  private readDialogueLines(): void {
    while (!this.atEnd()) {
      // Check if current line is closing '#'
      this.skipInlineWhitespace();
      if (this.peek() === '#' && this.tryCloseDialogueBlock()) break;

      // Read the line as a dialogue string
      const dlgLine = this.line;
      const dlgCol = this.column;
      let text = this.readRestOfLine();
      if (!this.atEnd()) this.advance(); // skip \n

      text = text.trim();
      if (text.length === 0) continue;

      // Extract trailing inline command (@r, @l, @p)
      let inlineCmd = '';
      const cmdMatch = text.match(/@([rlp])$/);
      if (cmdMatch) {
        inlineCmd = cmdMatch[1];
        text = text.slice(0, -2).trim();
      }

      // Strip surrounding 「」 if present
      if (text.startsWith('「') && text.endsWith('」')) {
        text = text.slice(1, -1);
      }

      if (text.length > 0) {
        this.addToken(TokenType.String, text, dlgLine, dlgCol);
      }
      if (inlineCmd) {
        this.addToken(TokenType.InlineCommand, inlineCmd, dlgLine, dlgCol);
      }
    }
  }

  /** いまの '#' の後ろが空なら行末まで飛ばして true（トークンは出さない）。でなければ位置を戻して false。 */
  private tryCloseDialogueBlock(): boolean {
    const savedPos = this.pos;
    const savedLine = this.line;
    const savedCol = this.column;
    this.advance(); // skip '#'
    if (this.peekRestOfLine().trim() === '') {
      this.skipToEndOfLine();
      return true;
    }
    // Not a closing '#', restore and treat as text
    this.pos = savedPos;
    this.line = savedLine;
    this.column = savedCol;
    return false;
  }

  /** Operators and delimiters */
  private readOperator(startLine: number, startCol: number): void {
    const ch = this.advance();
    const single = SINGLE_CHAR_OPS[ch];
    if (single !== undefined) {
      this.addToken(single, ch, startLine, startCol);
      return;
    }
    const pair = TWO_CHAR_OPS[ch];
    if (pair !== undefined) {
      const [second, longType, shortType] = pair;
      if (this.peek() === second) {
        this.advance();
        this.addToken(longType, ch + second, startLine, startCol);
      } else {
        this.addToken(shortType, ch, startLine, startCol);
      }
      return;
    }
    switch (ch) {
      case '&':
        if (this.peek() === '&') { this.advance(); this.addToken(TokenType.And, '&&', startLine, startCol); }
        else { throw new LexerError(`Unexpected character '&' (use '&&' for logical AND)`, startLine, startCol); }
        break;
      case '=':
        if (this.peek() === '=') {
          this.advance();
          // `===` is accepted but folds into the same Eq token as `==`
          // (KSC is statically typed — no value-vs-identity distinction).
          if (this.peek() === '=') this.advance();
          this.addToken(TokenType.Eq, '==', startLine, startCol);
        }
        else if (this.peek() === '>') { this.advance(); this.addToken(TokenType.Arrow, '=>', startLine, startCol); }
        else { this.addToken(TokenType.Assign, '=', startLine, startCol); }
        break;
      case '!':
        if (this.peek() === '=') {
          this.advance();
          if (this.peek() === '=') this.advance();  // `!==` → same NotEq
          this.addToken(TokenType.NotEq, '!=', startLine, startCol);
        }
        else { this.addToken(TokenType.Not, '!', startLine, startCol); }
        break;
      default:
        throw new LexerError(`Unexpected character '${ch}'`, startLine, startCol);
    }
  }
}
