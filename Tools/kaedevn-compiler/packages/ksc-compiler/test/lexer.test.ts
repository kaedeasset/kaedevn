import { describe, it, expect } from 'vitest';
import { tokenize, LexerError } from '../src/lexer.js';
import { TokenType } from '../src/types/token.js';

function types(source: string): TokenType[] {
  return tokenize(source).map((t) => t.type);
}

function values(source: string): string[] {
  return tokenize(source).filter((t) => t.type !== TokenType.EOF).map((t) => t.value);
}

describe('Lexer', () => {
  // ---------- Literals ----------
  describe('Numbers', () => {
    it('tokenizes integers', () => {
      const tokens = tokenize('42');
      expect(tokens[0].type).toBe(TokenType.Number);
      expect(tokens[0].value).toBe('42');
    });

    it('tokenizes floats', () => {
      const tokens = tokenize('3.14');
      expect(tokens[0].type).toBe(TokenType.Number);
      expect(tokens[0].value).toBe('3.14');
    });

    it('tokenizes zero', () => {
      const tokens = tokenize('0');
      expect(tokens[0].type).toBe(TokenType.Number);
      expect(tokens[0].value).toBe('0');
    });
  });

  describe('Strings', () => {
    it('tokenizes double-quoted strings', () => {
      const tokens = tokenize('"hello"');
      expect(tokens[0].type).toBe(TokenType.String);
      expect(tokens[0].value).toBe('hello');
    });

    it('tokenizes single-quoted strings', () => {
      const tokens = tokenize("'world'");
      expect(tokens[0].type).toBe(TokenType.String);
      expect(tokens[0].value).toBe('world');
    });

    it('handles escape sequences', () => {
      const tokens = tokenize('"line1\\nline2"');
      expect(tokens[0].value).toBe('line1\nline2');
    });

    it('throws on unterminated string', () => {
      expect(() => tokenize('"unterminated')).toThrow(LexerError);
    });
  });

  describe('Template strings', () => {
    it('tokenizes template strings', () => {
      const tokens = tokenize('`hello ${name}`');
      expect(tokens[0].type).toBe(TokenType.TemplateString);
      expect(tokens[0].value).toBe('hello ${name}');
    });

    it('throws on unterminated template string', () => {
      expect(() => tokenize('`unterminated')).toThrow(LexerError);
    });
  });

  describe('Boolean, null, undefined', () => {
    it('tokenizes true/false', () => {
      expect(types('true false')).toEqual([TokenType.Boolean, TokenType.Boolean, TokenType.EOF]);
    });

    it('tokenizes null', () => {
      expect(types('null')).toEqual([TokenType.Null, TokenType.EOF]);
    });

    it('tokenizes undefined', () => {
      expect(types('undefined')).toEqual([TokenType.Undefined, TokenType.EOF]);
    });
  });

  // ---------- Keywords ----------
  describe('Keywords', () => {
    it('tokenizes variable keywords', () => {
      expect(types('let const')).toEqual([TokenType.Let, TokenType.Const, TokenType.EOF]);
    });

    it('tokenizes function keywords', () => {
      expect(types('function return void')).toEqual([
        TokenType.Function, TokenType.Return, TokenType.Void, TokenType.EOF,
      ]);
    });

    it('tokenizes control flow keywords', () => {
      expect(types('if else for while switch case default break')).toEqual([
        TokenType.If, TokenType.Else, TokenType.For, TokenType.While,
        TokenType.Switch, TokenType.Case, TokenType.Default, TokenType.Break,
        TokenType.EOF,
      ]);
    });

    it('tokenizes module keywords', () => {
      expect(types('import from export type')).toEqual([
        TokenType.Import, TokenType.From, TokenType.Export, TokenType.Type, TokenType.EOF,
      ]);
    });

    it('treats non-keywords as identifiers', () => {
      expect(types('foo bar_baz $x')).toEqual([
        TokenType.Identifier, TokenType.Identifier, TokenType.Identifier, TokenType.EOF,
      ]);
    });
  });

  // ---------- Operators ----------
  describe('Operators', () => {
    it('tokenizes arithmetic operators', () => {
      expect(values('+ - * / %')).toEqual(['+', '-', '*', '/', '%']);
    });

    it('tokenizes comparison operators', () => {
      expect(values('== != < <= > >=')).toEqual(['==', '!=', '<', '<=', '>', '>=']);
    });

    it('tokenizes logical operators', () => {
      expect(values('&& || !')).toEqual(['&&', '||', '!']);
    });

    it('tokenizes assignment operators', () => {
      expect(values('= += -= *= /=')).toEqual(['=', '+=', '-=', '*=', '/=']);
    });

    it('tokenizes arrow', () => {
      expect(types('=>')).toEqual([TokenType.Arrow, TokenType.EOF]);
    });

    it('tokenizes pipe for union types', () => {
      expect(types('|')).toEqual([TokenType.Pipe, TokenType.EOF]);
    });
  });

  // ---------- Delimiters ----------
  describe('Delimiters', () => {
    it('tokenizes parentheses and braces', () => {
      expect(values('( ) { } [ ]')).toEqual(['(', ')', '{', '}', '[', ']']);
    });

    it('tokenizes punctuation', () => {
      expect(values(', : ; . ?')).toEqual([',', ':', ';', '.', '?']);
    });

    it('tokenizes hash for dialogue blocks', () => {
      expect(types('#')).toEqual([TokenType.Hash, TokenType.EOF]);
    });
  });

  // ---------- Comments ----------
  describe('Comments', () => {
    it('skips line comments', () => {
      expect(values('42 // this is a comment\n7')).toEqual(['42', '7']);
    });

    it('skips block comments', () => {
      expect(values('1 /* block */ 2')).toEqual(['1', '2']);
    });

    it('skips multi-line block comments', () => {
      expect(values('1 /* line1\nline2 */ 2')).toEqual(['1', '2']);
    });
  });

  // ---------- Complex expressions ----------
  describe('Complex expressions', () => {
    it('tokenizes variable declaration', () => {
      expect(types('let gold: number = 100;')).toEqual([
        TokenType.Let, TokenType.Identifier, TokenType.Colon,
        TokenType.Identifier, TokenType.Assign, TokenType.Number,
        TokenType.Semicolon, TokenType.EOF,
      ]);
    });

    it('tokenizes function declaration', () => {
      const source = 'function add(a: number, b: number): number { return a + b; }';
      const toks = tokenize(source);
      expect(toks[0].type).toBe(TokenType.Function);
      expect(toks[1].type).toBe(TokenType.Identifier);
      expect(toks[1].value).toBe('add');
    });

    it('tokenizes type alias', () => {
      expect(types('type Result = "win" | "lose";')).toEqual([
        TokenType.Type, TokenType.Identifier, TokenType.Assign,
        TokenType.String, TokenType.Pipe, TokenType.String,
        TokenType.Semicolon, TokenType.EOF,
      ]);
    });

    it('tokenizes import statement', () => {
      expect(types('import { x } from "module";')).toEqual([
        TokenType.Import, TokenType.LBrace, TokenType.Identifier,
        TokenType.RBrace, TokenType.From, TokenType.String,
        TokenType.Semicolon, TokenType.EOF,
      ]);
    });

    it('tokenizes ternary expression', () => {
      expect(values('x > 0 ? 1 : 0')).toEqual(['x', '>', '0', '?', '1', ':', '0']);
    });

    it('tokenizes array type', () => {
      expect(values('number[]')).toEqual(['number', '[', ']']);
    });

    it('tokenizes member access', () => {
      expect(values('Math.max')).toEqual(['Math', '.', 'max']);
    });

    it('tokenizes template string with expression', () => {
      const toks = tokenize('`EXP +${exp}`');
      expect(toks[0].type).toBe(TokenType.TemplateString);
      expect(toks[0].value).toBe('EXP +${exp}');
    });
  });

  // ---------- Line/column tracking ----------
  describe('Source location', () => {
    it('tracks line numbers', () => {
      const tokens = tokenize('a\nb\nc');
      expect(tokens[0].line).toBe(1);
      expect(tokens[1].line).toBe(2);
      expect(tokens[2].line).toBe(3);
    });

    it('tracks column numbers', () => {
      const tokens = tokenize('let x = 1');
      expect(tokens[0].column).toBe(1);  // let
      expect(tokens[1].column).toBe(5);  // x
      expect(tokens[2].column).toBe(7);  // =
      expect(tokens[3].column).toBe(9);  // 1
    });
  });

  // ---------- Error cases ----------
  describe('Errors', () => {
    it('throws on unexpected character', () => {
      expect(() => tokenize('@')).toThrow(LexerError);
    });

    it('throws on lone &', () => {
      expect(() => tokenize('&')).toThrow(LexerError);
    });

    it('includes line/column in error', () => {
      try {
        tokenize('let x = @');
      } catch (e) {
        expect(e).toBeInstanceOf(LexerError);
        expect((e as LexerError).line).toBe(1);
      }
    });
  });

  // ---------- KSC-specific: Dialogue block token ----------
  describe('Dialogue block', () => {
    it('tokenizes # followed by identifier as Hash + Identifier', () => {
      const toks = tokenize('#hero');
      expect(toks[0].type).toBe(TokenType.Hash);
      expect(toks[1].type).toBe(TokenType.Identifier);
      expect(toks[1].value).toBe('hero');
    });

    it('tokenizes standalone # as Hash', () => {
      const toks = tokenize('#');
      expect(toks[0].type).toBe(TokenType.Hash);
      expect(toks[1].type).toBe(TokenType.EOF);
    });

    it('tokenizes dialogue line with trailing @l', () => {
      const toks = tokenize('#hero\n「おはよう！」@l\n#');
      expect(toks[0].type).toBe(TokenType.Hash);
      expect(toks[1].type).toBe(TokenType.Identifier);
      expect(toks[1].value).toBe('hero');
      expect(toks[2].type).toBe(TokenType.String);
      expect(toks[2].value).toBe('おはよう！');
      expect(toks[3].type).toBe(TokenType.InlineCommand);
      expect(toks[3].value).toBe('l');
      expect(toks[4].type).toBe(TokenType.EOF);
    });

    it('tokenizes dialogue line with trailing @r', () => {
      const toks = tokenize('#hero\nHello@r\n#');
      const strTok = toks.find(t => t.type === TokenType.String);
      expect(strTok?.value).toBe('Hello');
      const cmdTok = toks.find(t => t.type === TokenType.InlineCommand);
      expect(cmdTok?.value).toBe('r');
    });

    it('tokenizes dialogue line with trailing @p', () => {
      const toks = tokenize('#narrator\nGoodbye@p\n#');
      const strTok = toks.find(t => t.type === TokenType.String);
      expect(strTok?.value).toBe('Goodbye');
      const cmdTok = toks.find(t => t.type === TokenType.InlineCommand);
      expect(cmdTok?.value).toBe('p');
    });

    it('tokenizes multiple dialogue lines with mixed commands', () => {
      const toks = tokenize('#hero\n「一行目」@l\n「二行目」@p\n#');
      const cmds = toks.filter(t => t.type === TokenType.InlineCommand);
      expect(cmds.map(c => c.value)).toEqual(['l', 'p']);
      const strs = toks.filter(t => t.type === TokenType.String);
      expect(strs.map(s => s.value)).toEqual(['一行目', '二行目']);
    });
  });

  // ---------- Unterminated block comment ----------
  describe('Unterminated block comment', () => {
    it('throws LexerError on unterminated block comment', () => {
      expect(() => tokenize('/* unclosed comment')).toThrow(LexerError);
      expect(() => tokenize('/* unclosed comment')).toThrow('Unterminated block comment');
    });

    it('correctly tokenizes terminated block comments', () => {
      const toks = tokenize('/* comment */ 42');
      expect(toks[0].type).toBe(TokenType.Number);
      expect(toks[0].value).toBe('42');
    });
  });

  // ---------- Full sample from spec ----------
  describe('Spec sample', () => {
    it('tokenizes KSC function declaration from spec', () => {
      const source = `export function battleResultValue(): number {
  const st: Battle.State = Battle.getState();
  return 1;
}`;
      const toks = tokenize(source);
      expect(toks[0].type).toBe(TokenType.Export);
      expect(toks[1].type).toBe(TokenType.Function);
      expect(toks[2].value).toBe('battleResultValue');
      // Should not throw
      expect(toks[toks.length - 1].type).toBe(TokenType.EOF);
    });
  });
});
