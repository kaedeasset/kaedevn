import { Token, TokenType } from './types/token.js';
import { Program, Statement } from './types/ast.js';
import { ClassParser } from './parser/class.js';

export { ParseError } from './parser/cursor.js';

// The parser is one class built in layers, one file per layer:
//   parser/cursor.ts       token helpers + ParseError
//   parser/types.ts        type annotations, parameter lists
//   parser/expressions.ts  expressions (precedence climbing), super / new
//   parser/statements.ts   statements
//   parser/class.ts        class declarations → factory lowering
// Program (the top level) is the last layer, here.
class Parser extends ClassParser {
  parseProgram(): Program {
    const l = this.loc();
    const body: Statement[] = [];
    while (!this.check(TokenType.EOF)) {
      // Class declarations expand to multiple top-level statements
      // (factory function + N method functions). Spread inline.
      if (this.check(TokenType.Class)) {
        body.push(...this.parseClassDecl(false));
        continue;
      }
      // export class also handled here so methods land at top-level.
      if (this.check(TokenType.Export) && this.peekNext() === TokenType.Class) {
        this.advance();  // consume 'export'
        body.push(...this.parseClassDecl(true));
        continue;
      }
      body.push(this.parseStatement());
    }
    return { kind: 'Program', body, loc: l };
  }
}

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram();
}
