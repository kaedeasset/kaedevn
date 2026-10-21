import { TokenType } from '../types/token.js';
import { TypeAnnotation, FunctionParam } from '../types/ast.js';
import { ParseError, TokenCursor } from './cursor.js';

/** Type annotations and parameter lists. */
export class TypeParser extends TokenCursor {
  protected parseTypeAnnotation(): TypeAnnotation {
    let base = this.parsePrimaryType();

    // Array type: T[]
    while (this.check(TokenType.LBracket)) {
      this.advance();
      this.expect(TokenType.RBracket);
      base = { kind: 'array', element: base };
    }

    // Union type: A | B
    if (this.check(TokenType.Pipe)) {
      const members: TypeAnnotation[] = [base];
      while (this.match(TokenType.Pipe)) {
        let member = this.parsePrimaryType();
        while (this.check(TokenType.LBracket)) {
          this.advance();
          this.expect(TokenType.RBracket);
          member = { kind: 'array', element: member };
        }
        members.push(member);
      }
      return { kind: 'union', members };
    }

    return base;
  }

  /**
   * `name: T, name: T` up to (not including) the closing ')'.
   * A trailing comma is accepted.
   */
  protected parseParamList(): FunctionParam[] {
    const params: FunctionParam[] = [];
    while (!this.check(TokenType.RParen) && !this.check(TokenType.EOF)) {
      const pName = this.expect(TokenType.Identifier).value;
      this.expect(TokenType.Colon);
      const pType = this.parseTypeAnnotation();
      params.push({ name: pName, type: pType });
      if (!this.match(TokenType.Comma)) break;
    }
    return params;
  }

  private parsePrimaryType(): TypeAnnotation {
    // String literal type
    if (this.check(TokenType.String)) {
      const t = this.advance();
      return { kind: 'literal', value: t.value };
    }

    // Number literal type
    if (this.check(TokenType.Number)) {
      const t = this.advance();
      return { kind: 'literal', value: Number(t.value) };
    }

    // Boolean literal type
    if (this.check(TokenType.Boolean)) {
      const t = this.advance();
      return { kind: 'literal', value: t.value === 'true' };
    }

    // void keyword as type
    if (this.check(TokenType.Void)) {
      this.advance();
      return { kind: 'named', name: 'void' };
    }

    // null keyword as type
    if (this.check(TokenType.Null)) {
      this.advance();
      return { kind: 'named', name: 'null' };
    }

    // undefined keyword as type
    if (this.check(TokenType.Undefined)) {
      this.advance();
      return { kind: 'named', name: 'undefined' };
    }

    // Function type: (name: T, ...) => U  (Phase 1 #13 V1)
    // Class methods desugar to fields of function type, so this is
    // mandatory for method support.
    if (this.check(TokenType.LParen)) {
      this.advance();
      const params = this.parseParamList();
      this.expect(TokenType.RParen);
      this.expect(TokenType.Arrow);
      const returnType = this.parseTypeAnnotation();
      return { kind: 'function', params, returnType };
    }

    // Object type: { key: Type, ... }
    if (this.check(TokenType.LBrace)) {
      return this.parseObjectType();
    }

    // Named type (identifier, possibly dotted: Battle.State, or generic
    // Promise<T>). Only Promise is supported with type args for now;
    // other generics would require a full type parameter system.
    if (this.check(TokenType.Identifier)) {
      return this.parseNamedType();
    }

    const t = this.current();
    throw new ParseError(`Expected type annotation but got '${t.type}'`, t.line, t.column);
  }

  private parseObjectType(): TypeAnnotation {
    this.advance();
    const fields: { name: string; type: TypeAnnotation }[] = [];
    while (!this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
      const name = this.expect(TokenType.Identifier).value;
      this.expect(TokenType.Colon);
      const type = this.parseTypeAnnotation();
      fields.push({ name, type });
      if (!this.check(TokenType.RBrace)) {
        this.match(TokenType.Semicolon) || this.match(TokenType.Comma);
      }
    }
    this.expect(TokenType.RBrace);
    return { kind: 'object', fields };
  }

  private parseNamedType(): TypeAnnotation {
    let name = this.advance().value;
    while (this.check(TokenType.Dot)) {
      this.advance();
      name += '.' + this.expect(TokenType.Identifier).value;
    }

    // Promise<T> — the only generic we accept at this stage.
    if (name === 'Promise' && this.check(TokenType.Lt)) {
      this.advance(); // <
      const inner = this.parseTypeAnnotation();
      this.expect(TokenType.Gt);
      return { kind: 'promise', inner };
    }

    return { kind: 'named', name };
  }
}
