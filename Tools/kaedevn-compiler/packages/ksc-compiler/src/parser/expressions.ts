import { TokenType } from '../types/token.js';
import { Expression } from '../types/ast.js';
import { ParseError } from './cursor.js';
import { TypeParser } from './types.js';

/** Expressions (precedence climbing). */
export class ExpressionParser extends TypeParser {
  // Tracks the class currently being parsed (and its immediate parent) so
  // that `super.method(args)` inside a method body can be rewritten to
  // `this.__super_<currentClass>_<method>__(args)`.
  //
  // Why qualify the hidden field name with the *current* class name?
  //   With multi-level inheritance, B and C may both override the same
  //   method M. C's instance object carries BOTH `__super_C_M__` (=> B's
  //   M) AND `__super_B_M__` (=> A's M) so that B's body — when running
  //   on a C instance — dispatches its own super to A, not back to itself.
  //
  // Both fields are pushed/popped together on class entry/exit.
  protected currentClassName:   string | null = null;
  protected currentSuperParent: string | null = null;

  protected parseExpression(): Expression {
    return this.parseAssignment();
  }

  private parseAssignment(): Expression {
    const expr = this.parseTernary();

    if (this.check(TokenType.Assign) || this.check(TokenType.PlusAssign) ||
        this.check(TokenType.MinusAssign) || this.check(TokenType.StarAssign) ||
        this.check(TokenType.SlashAssign) || this.check(TokenType.PercentAssign)) {
      const op = this.advance().value;
      const value = this.parseAssignment(); // right-associative
      return { kind: 'AssignExpr', op, target: expr, value, loc: expr.loc };
    }

    return expr;
  }

  private parseTernary(): Expression {
    const expr = this.parseOr();

    if (this.match(TokenType.QuestionMark)) {
      const consequent = this.parseAssignment();
      this.expect(TokenType.Colon);
      const alternate = this.parseAssignment();
      return { kind: 'TernaryExpr', condition: expr, consequent, alternate, loc: expr.loc };
    }

    return expr;
  }

  /** Left-associative binary level: `next (op next)*` for any of `ops`. */
  private parseBinary(ops: TokenType[], next: () => Expression): Expression {
    let left = next();
    while (ops.includes(this.peek())) {
      const op = this.advance().value;
      const right = next();
      left = { kind: 'BinaryExpr', op, left, right, loc: left.loc };
    }
    return left;
  }

  private parseOr(): Expression {
    return this.parseBinary([TokenType.Or], () => this.parseAnd());
  }

  private parseAnd(): Expression {
    return this.parseBinary([TokenType.And], () => this.parseEquality());
  }

  private parseEquality(): Expression {
    return this.parseBinary([TokenType.Eq, TokenType.NotEq], () => this.parseComparison());
  }

  private parseComparison(): Expression {
    return this.parseBinary(
      [TokenType.Lt, TokenType.LtEq, TokenType.Gt, TokenType.GtEq],
      () => this.parseAdditive(),
    );
  }

  private parseAdditive(): Expression {
    return this.parseBinary([TokenType.Plus, TokenType.Minus], () => this.parseMultiplicative());
  }

  private parseMultiplicative(): Expression {
    return this.parseBinary(
      [TokenType.Star, TokenType.Slash, TokenType.Percent],
      () => this.parseUnary(),
    );
  }

  private parseUnary(): Expression {
    if (this.check(TokenType.Await)) {
      const l = this.loc();
      this.advance(); // await
      const argument = this.parseUnary();
      return { kind: 'AwaitExpr', argument, loc: l };
    }
    if (this.check(TokenType.Not) || this.check(TokenType.Minus)) {
      const l = this.loc();
      const op = this.advance().value;
      const operand = this.parseUnary();
      return { kind: 'UnaryExpr', op, operand, loc: l };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.check(TokenType.LParen)) {
        // Function call
        this.advance();
        const args: Expression[] = [];
        while (!this.check(TokenType.RParen) && !this.check(TokenType.EOF)) {
          args.push(this.parseExpression());
          if (!this.match(TokenType.Comma)) break; // also handles trailing comma
        }
        this.expect(TokenType.RParen);
        expr = { kind: 'CallExpr', callee: expr, args, loc: expr.loc };
      } else if (this.check(TokenType.Dot)) {
        this.advance();
        const property = this.expect(TokenType.Identifier).value;
        expr = { kind: 'MemberExpr', object: expr, property, loc: expr.loc };
      } else if (this.check(TokenType.LBracket)) {
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenType.RBracket);
        expr = { kind: 'IndexExpr', object: expr, index, loc: expr.loc };
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Expression {
    const l = this.loc();

    switch (this.peek()) {
      case TokenType.Number:
        return { kind: 'NumberLiteral', value: Number(this.advance().value), loc: l };
      case TokenType.String:
        return { kind: 'StringLiteral', value: this.advance().value, loc: l };
      case TokenType.TemplateString:
        return { kind: 'TemplateLiteral', parts: [this.advance().value], loc: l };
      case TokenType.Boolean:
        return { kind: 'BooleanLiteral', value: this.advance().value === 'true', loc: l };
      case TokenType.Null:
        this.advance();
        return { kind: 'NullLiteral', loc: l };
      case TokenType.Undefined:
        this.advance();
        return { kind: 'UndefinedLiteral', loc: l };
      case TokenType.Identifier:
        return { kind: 'Identifier', name: this.advance().value, loc: l };
      // 'this' keyword (Phase 1 #7) — emits a regular identifier reference.
      // The CALL_METHOD opcode injects the receiver into the function frame
      // as a local named 'this' at runtime, so name-based LOAD_VAR resolves it.
      // Inside class method bodies the checker pre-defines `this` in scope.
      case TokenType.This:
        this.advance();
        return { kind: 'Identifier', name: 'this', loc: l };
      case TokenType.Super:
        return this.parseSuper();
      case TokenType.New:
        return this.parseNew();
      case TokenType.LParen: {
        // Parenthesized expression
        this.advance();
        const expr = this.parseExpression();
        this.expect(TokenType.RParen);
        return expr;
      }
      case TokenType.LBracket:
        return this.parseArrayLiteral();
      case TokenType.LBrace:
        return this.parseObjectLiteral();
    }

    const t = this.current();
    throw new ParseError(`Unexpected token '${t.type}' ("${t.value}")`, t.line, t.column);
  }

  // 'super.method(args)' (Phase 1 #13 V1.1) — inside a class method,
  // `super.method(args)` rewrites to `this.__super_<currentClass>_<method>__(args)`.
  // The factory wires the hidden field to the parent's emitted method
  // function name, so CALL_METHOD dispatches with `this` auto-bound.
  //
  // The currentClass qualifier is essential: with multi-level inheritance
  // (C extends B extends A), B's body must always reach A's method, even
  // when running on a C instance — so its hidden field name (`__super_B_M__`)
  // is distinct from C's (`__super_C_M__`).
  private parseSuper(): Expression {
    const superLoc = this.loc();
    this.advance();
    if (!this.currentSuperParent || !this.currentClassName) {
      throw new ParseError(
        `'super' is only valid inside a class method whose enclosing ` +
        `class declares 'extends ParentClass'`,
        superLoc.line, superLoc.column,
      );
    }
    // Constructor delegation `super(args)` deferred to V1.2 — only
    // `super.method` form is allowed in V1.1.
    if (!this.check(TokenType.Dot)) {
      throw new ParseError(
        `'super(...)' constructor delegation is not yet supported. ` +
        `Use 'super.method(args)' to call a parent method (V1.2 candidate).`,
        superLoc.line, superLoc.column,
      );
    }
    this.advance();  // .
    const methodName = this.expect(TokenType.Identifier).value;
    // Synthesize: this.__super_<currentClass>_<methodName>__
    // (parsePostfix will attach the (args) call below.)
    return {
      kind: 'MemberExpr',
      object: { kind: 'Identifier', name: 'this', loc: superLoc },
      property: `__super_${this.currentClassName}_${methodName}__`,
      loc: superLoc,
    };
  }

  // 'new ClassName(args)' (Phase 1 #7) — desugars to a regular call to the
  // class factory function: `new Foo(1, 2)` → `Foo(1, 2)`.
  private parseNew(): Expression {
    const l = this.loc();
    this.advance();
    const callee = this.parsePostfix();  // parses ClassName + member chain + call
    // The trailing ( ... ) will already have been consumed by parsePostfix
    // (CallExpr). If it wasn't a call, that's an error: `new Foo` w/o parens.
    if (callee.kind !== 'CallExpr') {
      throw new ParseError(
        `'new' must be followed by a call: 'new ClassName(...)'`,
        l.line, l.column,
      );
    }
    return callee;
  }

  private parseArrayLiteral(): Expression {
    const l = this.loc();
    this.advance();
    const elements: Expression[] = [];
    while (!this.check(TokenType.RBracket) && !this.check(TokenType.EOF)) {
      elements.push(this.parseExpression());
      if (!this.match(TokenType.Comma)) break; // also handles trailing comma
    }
    this.expect(TokenType.RBracket);
    return { kind: 'ArrayLiteral', elements, loc: l };
  }

  private parseObjectLiteral(): Expression {
    const l = this.loc();
    this.advance();
    const fields: { key: string; value: Expression }[] = [];
    while (!this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
      const key = this.expect(TokenType.Identifier).value;
      this.expect(TokenType.Colon);
      const value = this.parseExpression();
      fields.push({ key, value });
      if (!this.match(TokenType.Comma)) break; // also handles trailing comma
    }
    this.expect(TokenType.RBrace);
    return { kind: 'ObjectLiteral', fields, loc: l };
  }
}
