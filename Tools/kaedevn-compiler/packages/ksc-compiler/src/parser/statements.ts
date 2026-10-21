import { TokenType } from '../types/token.js';
import {
  Statement, Expression, TypeAnnotation,
  VariableDecl, FunctionDecl, ReturnStmt,
  IfStmt, ForStmt, WhileStmt, SwitchStmt, SwitchCase,
  BreakStmt, ContinueStmt, LabelStmt, JumpStmt, ExpressionStmt, BlockStmt, TypeAliasDecl,
  ImportDecl, ExportDecl, DialogueBlock, DialogueLine,
} from '../types/ast.js';
import { ParseError } from './cursor.js';
import { ExpressionParser } from './expressions.js';

/** Statements (everything except class declarations, which live at top level). */
export class StatementParser extends ExpressionParser {
  protected parseStatement(): Statement {
    switch (this.peek()) {
      case TokenType.Let:
      case TokenType.Const:
        return this.parseVariableDecl(false);
      case TokenType.Function:
        return this.parseFunctionDecl(false, false);
      case TokenType.Async:
        return this.parseFunctionDecl(false, true);
      case TokenType.Return:
        return this.parseReturnStmt();
      case TokenType.If:
        return this.parseIfStmt();
      case TokenType.For:
        return this.parseForStmt();
      case TokenType.While:
        return this.parseWhileStmt();
      case TokenType.Switch:
        return this.parseSwitchStmt();
      case TokenType.Break:
        return this.parseBreakStmt();
      case TokenType.Continue:
        return this.parseContinueStmt();
      case TokenType.Label:
        return this.parseLabelStmt();
      case TokenType.Jump:
        return this.parseJumpStmt();
      case TokenType.LBrace:
        return this.parseBlockStmt();
      case TokenType.Type:
        return this.parseTypeAliasDecl(false);
      case TokenType.Import:
        return this.parseImportDecl();
      case TokenType.Export:
        return this.parseExportDecl();
      case TokenType.Hash:
        return this.parseDialogueBlock();
      case TokenType.AtCommandLine:
        return this.parseAtCommandLine();
      case TokenType.LabelLine: {
        // `*name` → `label name` へ desugar（KS 風ラベル行。P6-9）
        const l = this.loc();
        const name = this.advance().value;
        return { kind: 'LabelStmt', name, loc: l };
      }
      case TokenType.Class:
        // Classes only allowed at top-level (parseProgram). Nested classes
        // would require lifting methods out of nested scope.
        throw new ParseError(
          `Class declarations must be at the top level (Phase 1 #7)`,
          this.current().line, this.current().column,
        );
      case TokenType.Extends:
        // `extends` is only valid right after `class Name`. Anywhere else
        // is a typo / misuse.
        throw new ParseError(
          `'extends' is only valid in a class declaration: 'class Child extends Parent { ... }'`,
          this.current().line, this.current().column,
        );
      // `super` is handled in parsePrimary; falling through to default
      // routes it to parseExpressionStmt, which is correct (super.method()
      // is a valid expression statement inside a class method body).
      default:
        return this.parseExpressionStmt();
    }
  }

  protected parseVariableDecl(exported: boolean, consumeSemicolon = true): VariableDecl {
    const l = this.loc();
    const mutable = this.peek() === TokenType.Let;
    this.advance(); // let or const
    const name = this.expect(TokenType.Identifier).value;

    let typeAnnotation: TypeAnnotation | null = null;
    if (this.match(TokenType.Colon)) {
      typeAnnotation = this.parseTypeAnnotation();
    }

    let init: Expression | null = null;
    if (this.match(TokenType.Assign)) {
      init = this.parseExpression();
    }

    if (consumeSemicolon) this.match(TokenType.Semicolon);
    return { kind: 'VariableDecl', name, mutable, typeAnnotation, init, exported, loc: l };
  }

  private parseFunctionDecl(exported: boolean, isAsync: boolean): FunctionDecl {
    const l = this.loc();
    if (isAsync) this.expect(TokenType.Async);
    this.expect(TokenType.Function);
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.LParen);
    const params = this.parseParamList();
    this.expect(TokenType.RParen);

    let returnType: TypeAnnotation = { kind: 'named', name: 'void' };
    if (this.match(TokenType.Colon)) {
      returnType = this.parseTypeAnnotation();
    }

    const body = this.parseBlockStmt();
    return { kind: 'FunctionDecl', name, params, returnType, body, exported, isAsync, loc: l };
  }

  private parseReturnStmt(): ReturnStmt {
    const l = this.loc();
    this.advance(); // return
    let value: Expression | null = null;
    if (!this.check(TokenType.Semicolon) && !this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
      value = this.parseExpression();
    }
    this.match(TokenType.Semicolon);
    return { kind: 'ReturnStmt', value, loc: l };
  }

  private parseIfStmt(): IfStmt {
    const l = this.loc();
    this.expect(TokenType.If);
    this.expect(TokenType.LParen);
    const condition = this.parseExpression();
    this.expect(TokenType.RParen);
    const consequent = this.parseBlockStmt();

    let alternate: Statement | null = null;
    if (this.match(TokenType.Else)) {
      if (this.check(TokenType.If)) {
        alternate = this.parseIfStmt();
      } else {
        alternate = this.parseBlockStmt();
      }
    }

    return { kind: 'IfStmt', condition, consequent, alternate, loc: l };
  }

  private parseForStmt(): ForStmt {
    const l = this.loc();
    this.expect(TokenType.For);
    this.expect(TokenType.LParen);

    let init: Statement | null = null;
    if (this.check(TokenType.Let) || this.check(TokenType.Const)) {
      init = this.parseVariableDecl(false, false);
      this.expect(TokenType.Semicolon);
    } else if (!this.check(TokenType.Semicolon)) {
      init = { kind: 'ExpressionStmt', expression: this.parseExpression(), loc: this.loc() };
      this.expect(TokenType.Semicolon);
    } else {
      this.expect(TokenType.Semicolon);
    }

    let condition: Expression | null = null;
    if (!this.check(TokenType.Semicolon)) {
      condition = this.parseExpression();
    }
    this.expect(TokenType.Semicolon);

    let update: Expression | null = null;
    if (!this.check(TokenType.RParen)) {
      update = this.parseExpression();
    }
    this.expect(TokenType.RParen);

    const body = this.parseBlockStmt();
    return { kind: 'ForStmt', init, condition, update, body, loc: l };
  }

  private parseWhileStmt(): WhileStmt {
    const l = this.loc();
    this.expect(TokenType.While);
    this.expect(TokenType.LParen);
    const condition = this.parseExpression();
    this.expect(TokenType.RParen);
    const body = this.parseBlockStmt();
    return { kind: 'WhileStmt', condition, body, loc: l };
  }

  private parseSwitchStmt(): SwitchStmt {
    const l = this.loc();
    this.expect(TokenType.Switch);
    this.expect(TokenType.LParen);
    const discriminant = this.parseExpression();
    this.expect(TokenType.RParen);
    this.expect(TokenType.LBrace);

    const cases: SwitchCase[] = [];
    while (!this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
      let test: Expression | null;
      if (this.check(TokenType.Case)) {
        this.advance();
        test = this.parseExpression();
      } else if (this.check(TokenType.Default)) {
        this.advance();
        test = null;
      } else {
        const t = this.current();
        throw new ParseError(`Expected 'case' or 'default' in switch but got '${t.type}'`, t.line, t.column);
      }
      this.expect(TokenType.Colon);
      const body: Statement[] = [];
      while (!this.check(TokenType.Case) && !this.check(TokenType.Default) &&
             !this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
        body.push(this.parseStatement());
      }
      cases.push({ test, body });
    }
    this.expect(TokenType.RBrace);
    return { kind: 'SwitchStmt', discriminant, cases, loc: l };
  }

  private parseBreakStmt(): BreakStmt {
    const l = this.loc();
    this.advance(); // break
    this.match(TokenType.Semicolon);
    return { kind: 'BreakStmt', loc: l };
  }

  private parseContinueStmt(): ContinueStmt {
    const l = this.loc();
    this.advance(); // continue
    this.match(TokenType.Semicolon);
    return { kind: 'ContinueStmt', loc: l };
  }

  private parseLabelStmt(): LabelStmt {
    const l = this.loc();
    this.advance(); // label
    const name = this.expect(TokenType.Identifier).value;
    this.match(TokenType.Semicolon);
    return { kind: 'LabelStmt', name, loc: l };
  }

  private parseJumpStmt(): JumpStmt {
    const l = this.loc();
    this.advance(); // jump
    const label = this.expect(TokenType.Identifier).value;
    this.match(TokenType.Semicolon);
    return { kind: 'JumpStmt', label, loc: l };
  }

  /**
   * 行頭 `@word …` の KS シーンコマンド行（P6-9）。
   * pc 系は execOp で運ばない: @jump は JumpStmt へ desugar、@call/@return/@battle はエラーで案内。
   */
  private parseAtCommandLine(): Statement {
    const l = this.loc();
    const raw = this.advance().value; // `@` を除いた行テキスト
    const parts = raw.split(/\s+/);
    const word = parts[0] ?? '';

    if (word === 'jump') {
      const label = parts[1];
      if (!label) {
        throw new ParseError(`@jump requires a label`, l.line, l.column);
      }
      return { kind: 'JumpStmt', label: label.replace(/^\*/, ''), loc: l };
    }
    if (word === 'call' || word === 'return') {
      throw new ParseError(
        `@${word} is not supported in KSC; use a KSC function ${word === 'call' ? 'call' : 'return'} instead`,
        l.line, l.column,
      );
    }
    if (word === 'battle') {
      throw new ParseError(`@battle is not supported in KSC; use engine.battleStart(...) instead`, l.line, l.column);
    }

    return { kind: 'AtCommandStmt', raw, loc: l };
  }

  protected parseBlockStmt(): BlockStmt {
    const l = this.loc();
    this.expect(TokenType.LBrace);
    const body: Statement[] = [];
    while (!this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
      body.push(this.parseStatement());
    }
    this.expect(TokenType.RBrace);
    return { kind: 'BlockStmt', body, loc: l };
  }

  private parseTypeAliasDecl(exported: boolean): TypeAliasDecl {
    const l = this.loc();
    this.expect(TokenType.Type);
    const name = this.expect(TokenType.Identifier).value;
    this.expect(TokenType.Assign);
    const type = this.parseTypeAnnotation();
    this.match(TokenType.Semicolon);
    return { kind: 'TypeAliasDecl', name, type, exported, loc: l };
  }

  private parseImportDecl(): ImportDecl {
    const l = this.loc();
    this.expect(TokenType.Import);

    // import * as Name from "source"
    if (this.check(TokenType.Star)) {
      this.advance();
      // 'as' is an identifier, not a keyword
      const asToken = this.expect(TokenType.Identifier);
      if (asToken.value !== 'as') {
        throw new ParseError(`Expected 'as' after '*' but got '${asToken.value}'`, asToken.line, asToken.column);
      }
      const namespace = this.expect(TokenType.Identifier).value;
      this.expect(TokenType.From);
      const source = this.expect(TokenType.String).value;
      this.match(TokenType.Semicolon);
      return { kind: 'ImportDecl', specifiers: [], namespace, source, loc: l };
    }

    // import { x, y as z } from "source"
    this.expect(TokenType.LBrace);
    const specifiers: { imported: string; local: string }[] = [];
    while (!this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
      const imported = this.expect(TokenType.Identifier).value;
      let local = imported;
      // Check for 'as' (it's an identifier, not a keyword)
      if (this.check(TokenType.Identifier) && this.current().value === 'as') {
        this.advance();
        local = this.expect(TokenType.Identifier).value;
      }
      specifiers.push({ imported, local });
      if (!this.check(TokenType.RBrace)) {
        this.expect(TokenType.Comma);
      }
    }
    this.expect(TokenType.RBrace);
    this.expect(TokenType.From);
    const source = this.expect(TokenType.String).value;
    this.match(TokenType.Semicolon);
    return { kind: 'ImportDecl', specifiers, namespace: null, source, loc: l };
  }

  private parseExportDecl(): ExportDecl {
    const l = this.loc();
    this.expect(TokenType.Export);
    let declaration: Statement;
    if (this.check(TokenType.Function)) {
      declaration = this.parseFunctionDecl(true, false);
    } else if (this.check(TokenType.Async)) {
      declaration = this.parseFunctionDecl(true, true);
    } else if (this.check(TokenType.Let) || this.check(TokenType.Const)) {
      declaration = this.parseVariableDecl(true);
    } else if (this.check(TokenType.Type)) {
      declaration = this.parseTypeAliasDecl(true);
    } else {
      const t = this.current();
      throw new ParseError(`Expected declaration after 'export' but got '${t.type}'`, t.line, t.column);
    }
    return { kind: 'ExportDecl', declaration, loc: l };
  }

  private parseDialogueBlock(): DialogueBlock {
    const l = this.loc();
    this.expect(TokenType.Hash);

    let speaker = '';
    if (this.check(TokenType.Identifier)) {
      speaker = this.advance().value;
    }

    const lines: DialogueLine[] = [];
    // Collect string literals as dialogue lines, with optional inline commands
    while (this.check(TokenType.String) || this.check(TokenType.TemplateString) || this.check(TokenType.InlineCommand)) {
      if (this.check(TokenType.InlineCommand)) {
        // Standalone inline command (no preceding text on this line)
        const cmd = this.advance().value as 'r' | 'l' | 'p';
        lines.push({ text: '', command: cmd });
      } else {
        const text = this.advance().value;
        let command: 'r' | 'l' | 'p' | undefined;
        if (this.check(TokenType.InlineCommand)) {
          command = this.advance().value as 'r' | 'l' | 'p';
        }
        lines.push({ text, command });
      }
    }

    return { kind: 'DialogueBlock', speaker, lines, loc: l };
  }

  private parseExpressionStmt(): ExpressionStmt {
    const l = this.loc();
    const expression = this.parseExpression();
    this.match(TokenType.Semicolon);
    return { kind: 'ExpressionStmt', expression, loc: l };
  }
}
