import { Token, TokenType } from '../types/token.js';
import { SourceLocation } from '../types/ast.js';

export class ParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number,
  ) {
    super(`[L${line}:${column}] ${message}`);
    this.name = 'ParseError';
  }
}

/**
 * Token cursor shared by every parser layer (types → expressions →
 * statements → classes → program). One instance per `parse()` call.
 */
export class TokenCursor {
  protected pos = 0;

  constructor(protected readonly tokens: Token[]) {}

  // ---- Token helpers ----

  protected current(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', line: 0, column: 0 };
  }

  protected peek(): TokenType {
    return this.current().type;
  }

  /** Type of the token after the current one. */
  protected peekNext(): TokenType | undefined {
    return this.tokens[this.pos + 1]?.type;
  }

  protected loc(): SourceLocation {
    const t = this.current();
    return { line: t.line, column: t.column };
  }

  protected advance(): Token {
    const t = this.current();
    this.pos++;
    return t;
  }

  protected expect(type: TokenType): Token {
    const t = this.current();
    if (t.type !== type) {
      throw new ParseError(
        `Expected '${type}' but got '${t.type}' ("${t.value}")`,
        t.line, t.column,
      );
    }
    return this.advance();
  }

  protected match(type: TokenType): boolean {
    if (this.peek() === type) {
      this.advance();
      return true;
    }
    return false;
  }

  protected check(type: TokenType): boolean {
    return this.peek() === type;
  }
}
