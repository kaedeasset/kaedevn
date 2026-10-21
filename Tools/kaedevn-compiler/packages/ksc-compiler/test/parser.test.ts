import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/lexer.js';
import { parse, ParseError } from '../src/parser.js';
import type {
  Program, VariableDecl, FunctionDecl, ReturnStmt,
  IfStmt, ForStmt, WhileStmt, SwitchStmt, BreakStmt,
  ExpressionStmt, BlockStmt, TypeAliasDecl, ImportDecl,
  ExportDecl, DialogueBlock, Expression,
  NumberLiteral, StringLiteral, BooleanLiteral, Identifier,
  BinaryExpr, UnaryExpr, AssignExpr, CallExpr, MemberExpr,
  IndexExpr, TernaryExpr, ArrayLiteral, ObjectLiteral,
} from '../src/types/ast.js';

function p(source: string): Program {
  return parse(tokenize(source));
}

function firstStmt(source: string) {
  return p(source).body[0];
}

describe('Parser', () => {
  // ---------- Variable declarations ----------
  describe('Variable declarations', () => {
    it('parses let without type', () => {
      const stmt = firstStmt('let x = 42;') as VariableDecl;
      expect(stmt.kind).toBe('VariableDecl');
      expect(stmt.name).toBe('x');
      expect(stmt.mutable).toBe(true);
      expect(stmt.typeAnnotation).toBeNull();
      expect((stmt.init as NumberLiteral).value).toBe(42);
    });

    it('parses const with type', () => {
      const stmt = firstStmt('const name: string = "hello";') as VariableDecl;
      expect(stmt.kind).toBe('VariableDecl');
      expect(stmt.name).toBe('name');
      expect(stmt.mutable).toBe(false);
      expect(stmt.typeAnnotation).toEqual({ kind: 'named', name: 'string' });
      expect((stmt.init as StringLiteral).value).toBe('hello');
    });

    it('parses let with array type', () => {
      const stmt = firstStmt('let items: number[] = [];') as VariableDecl;
      expect(stmt.typeAnnotation).toEqual({ kind: 'array', element: { kind: 'named', name: 'number' } });
    });

    it('parses without initializer', () => {
      const stmt = firstStmt('let x: number;') as VariableDecl;
      expect(stmt.name).toBe('x');
      expect(stmt.init).toBeNull();
    });

    it('parses dotted type name', () => {
      const stmt = firstStmt('const st: Battle.State = x;') as VariableDecl;
      expect(stmt.typeAnnotation).toEqual({ kind: 'named', name: 'Battle.State' });
    });

    it('parses union type annotation', () => {
      const stmt = firstStmt('let result: "win" | "lose";') as VariableDecl;
      expect(stmt.typeAnnotation).toEqual({
        kind: 'union',
        members: [
          { kind: 'literal', value: 'win' },
          { kind: 'literal', value: 'lose' },
        ],
      });
    });
  });

  // ---------- Function declarations ----------
  describe('Function declarations', () => {
    it('parses simple function', () => {
      const stmt = firstStmt('function add(a: number, b: number): number { return a + b; }') as FunctionDecl;
      expect(stmt.kind).toBe('FunctionDecl');
      expect(stmt.name).toBe('add');
      expect(stmt.params).toHaveLength(2);
      expect(stmt.params[0]).toEqual({ name: 'a', type: { kind: 'named', name: 'number' } });
      expect(stmt.params[1]).toEqual({ name: 'b', type: { kind: 'named', name: 'number' } });
      expect(stmt.returnType).toEqual({ kind: 'named', name: 'number' });
      expect(stmt.body.body).toHaveLength(1);
    });

    it('parses function with no params', () => {
      const stmt = firstStmt('function greet(): void {}') as FunctionDecl;
      expect(stmt.name).toBe('greet');
      expect(stmt.params).toHaveLength(0);
      expect(stmt.returnType).toEqual({ kind: 'named', name: 'void' });
    });

    it('parses function without return type', () => {
      const stmt = firstStmt('function noop() {}') as FunctionDecl;
      expect(stmt.returnType).toEqual({ kind: 'named', name: 'void' });
    });
  });

  // ---------- Return statement ----------
  describe('Return statement', () => {
    it('parses return with value', () => {
      const fn = firstStmt('function f(): number { return 42; }') as FunctionDecl;
      const ret = fn.body.body[0] as ReturnStmt;
      expect(ret.kind).toBe('ReturnStmt');
      expect((ret.value as NumberLiteral).value).toBe(42);
    });

    it('parses return without value', () => {
      const fn = firstStmt('function f(): void { return; }') as FunctionDecl;
      const ret = fn.body.body[0] as ReturnStmt;
      expect(ret.value).toBeNull();
    });
  });

  // ---------- If statement ----------
  describe('If statement', () => {
    it('parses if without else', () => {
      const stmt = firstStmt('if (x > 0) { y = 1; }') as IfStmt;
      expect(stmt.kind).toBe('IfStmt');
      expect((stmt.condition as BinaryExpr).op).toBe('>');
      expect(stmt.consequent.body).toHaveLength(1);
      expect(stmt.alternate).toBeNull();
    });

    it('parses if-else', () => {
      const stmt = firstStmt('if (x > 0) { y = 1; } else { y = 0; }') as IfStmt;
      expect(stmt.alternate).not.toBeNull();
      expect((stmt.alternate as BlockStmt).kind).toBe('BlockStmt');
    });

    it('parses if-else if-else', () => {
      const stmt = firstStmt('if (a) { x; } else if (b) { y; } else { z; }') as IfStmt;
      expect(stmt.alternate).not.toBeNull();
      const elseIf = stmt.alternate as IfStmt;
      expect(elseIf.kind).toBe('IfStmt');
      expect(elseIf.alternate).not.toBeNull();
    });
  });

  // ---------- For statement ----------
  describe('For statement', () => {
    it('parses for loop', () => {
      const stmt = firstStmt('for (let i: number = 0; i < 10; i += 1) { x; }') as ForStmt;
      expect(stmt.kind).toBe('ForStmt');
      expect(stmt.init).not.toBeNull();
      expect((stmt.init as VariableDecl).name).toBe('i');
      expect(stmt.condition).not.toBeNull();
      expect(stmt.update).not.toBeNull();
    });

    it('parses for loop with empty init', () => {
      const stmt = firstStmt('for (; i < 10; i += 1) { x; }') as ForStmt;
      expect(stmt.init).toBeNull();
    });
  });

  // ---------- While statement ----------
  describe('While statement', () => {
    it('parses while loop', () => {
      const stmt = firstStmt('while (x > 0) { x -= 1; }') as WhileStmt;
      expect(stmt.kind).toBe('WhileStmt');
      expect((stmt.condition as BinaryExpr).op).toBe('>');
      expect(stmt.body.body).toHaveLength(1);
    });
  });

  // ---------- Switch statement ----------
  describe('Switch statement', () => {
    it('parses switch with cases and default', () => {
      const src = `switch (x) {
        case 1: y = 10; break;
        case 2: y = 20; break;
        default: y = 0;
      }`;
      const stmt = firstStmt(src) as SwitchStmt;
      expect(stmt.kind).toBe('SwitchStmt');
      expect(stmt.cases).toHaveLength(3);
      expect((stmt.cases[0].test as NumberLiteral).value).toBe(1);
      expect((stmt.cases[1].test as NumberLiteral).value).toBe(2);
      expect(stmt.cases[2].test).toBeNull(); // default
    });
  });

  // ---------- Break statement ----------
  describe('Break statement', () => {
    it('parses break', () => {
      const sw = firstStmt('switch (x) { case 1: break; }') as SwitchStmt;
      const brk = sw.cases[0].body[0] as BreakStmt;
      expect(brk.kind).toBe('BreakStmt');
    });
  });

  // ---------- Type alias ----------
  describe('Type alias', () => {
    it('parses simple type alias', () => {
      const stmt = firstStmt('type ID = number;') as TypeAliasDecl;
      expect(stmt.kind).toBe('TypeAliasDecl');
      expect(stmt.name).toBe('ID');
      expect(stmt.type).toEqual({ kind: 'named', name: 'number' });
    });

    it('parses union type alias', () => {
      const stmt = firstStmt('type Result = "win" | "lose";') as TypeAliasDecl;
      expect(stmt.type).toEqual({
        kind: 'union',
        members: [
          { kind: 'literal', value: 'win' },
          { kind: 'literal', value: 'lose' },
        ],
      });
    });

    it('parses object type alias', () => {
      const stmt = firstStmt('type Point = { x: number; y: number };') as TypeAliasDecl;
      expect(stmt.type).toEqual({
        kind: 'object',
        fields: [
          { name: 'x', type: { kind: 'named', name: 'number' } },
          { name: 'y', type: { kind: 'named', name: 'number' } },
        ],
      });
    });
  });

  // ---------- Import declarations ----------
  describe('Import declarations', () => {
    it('parses named import', () => {
      const stmt = firstStmt('import { x, y } from "module";') as ImportDecl;
      expect(stmt.kind).toBe('ImportDecl');
      expect(stmt.specifiers).toEqual([
        { imported: 'x', local: 'x' },
        { imported: 'y', local: 'y' },
      ]);
      expect(stmt.namespace).toBeNull();
      expect(stmt.source).toBe('module');
    });

    it('parses namespace import', () => {
      const stmt = firstStmt('import * as Battle from "battle/api";') as ImportDecl;
      expect(stmt.specifiers).toEqual([]);
      expect(stmt.namespace).toBe('Battle');
      expect(stmt.source).toBe('battle/api');
    });

    it('parses import with alias', () => {
      const stmt = firstStmt('import { foo as bar } from "mod";') as ImportDecl;
      expect(stmt.specifiers).toEqual([
        { imported: 'foo', local: 'bar' },
      ]);
    });
  });

  // ---------- Export declarations ----------
  describe('Export declarations', () => {
    it('parses export function', () => {
      const stmt = firstStmt('export function test(): void {}') as ExportDecl;
      expect(stmt.kind).toBe('ExportDecl');
      const fn = stmt.declaration as FunctionDecl;
      expect(fn.kind).toBe('FunctionDecl');
      expect(fn.name).toBe('test');
      expect(fn.exported).toBe(true);
    });

    it('parses export const', () => {
      const stmt = firstStmt('export const MAX: number = 100;') as ExportDecl;
      const decl = stmt.declaration as VariableDecl;
      expect(decl.kind).toBe('VariableDecl');
      expect(decl.name).toBe('MAX');
      expect(decl.exported).toBe(true);
    });

    it('parses export type', () => {
      const stmt = firstStmt('export type ID = number;') as ExportDecl;
      const decl = stmt.declaration as TypeAliasDecl;
      expect(decl.kind).toBe('TypeAliasDecl');
      expect(decl.name).toBe('ID');
      expect(decl.exported).toBe(true);
    });
  });

  // ---------- Dialogue block ----------
  describe('Dialogue block', () => {
    it('parses dialogue with speaker and lines', () => {
      const stmt = firstStmt('#hero "Hello, world!" "How are you?"') as DialogueBlock;
      expect(stmt.kind).toBe('DialogueBlock');
      expect(stmt.speaker).toBe('hero');
      expect(stmt.lines).toEqual([
        { text: 'Hello, world!' },
        { text: 'How are you?' },
      ]);
    });

    it('parses dialogue without speaker', () => {
      const stmt = firstStmt('# "Narration text"') as DialogueBlock;
      expect(stmt.kind).toBe('DialogueBlock');
      expect(stmt.speaker).toBe('');
      expect(stmt.lines).toEqual([{ text: 'Narration text' }]);
    });

    it('parses empty dialogue', () => {
      const prog = p('#hero');
      const stmt = prog.body[0] as DialogueBlock;
      expect(stmt.speaker).toBe('hero');
      expect(stmt.lines).toEqual([]);
    });

    it('parses dialogue with inline command @l', () => {
      const stmt = firstStmt('#hero\n「おはよう！」@l\n#') as DialogueBlock;
      expect(stmt.speaker).toBe('hero');
      expect(stmt.lines).toEqual([{ text: 'おはよう！', command: 'l' }]);
    });

    it('parses dialogue with inline command @r', () => {
      const stmt = firstStmt('#hero\nHello@r\nWorld\n#') as DialogueBlock;
      expect(stmt.lines).toEqual([
        { text: 'Hello', command: 'r' },
        { text: 'World' },
      ]);
    });

    it('parses dialogue with @p', () => {
      const stmt = firstStmt('#narrator\nGoodbye@p\n#') as DialogueBlock;
      expect(stmt.speaker).toBe('narrator');
      expect(stmt.lines).toEqual([{ text: 'Goodbye', command: 'p' }]);
    });
  });

  // ---------- Expressions ----------
  describe('Expressions', () => {
    describe('Literals', () => {
      it('parses number', () => {
        const stmt = firstStmt('42;') as ExpressionStmt;
        expect((stmt.expression as NumberLiteral).kind).toBe('NumberLiteral');
        expect((stmt.expression as NumberLiteral).value).toBe(42);
      });

      it('parses string', () => {
        const stmt = firstStmt('"hello";') as ExpressionStmt;
        expect((stmt.expression as StringLiteral).kind).toBe('StringLiteral');
        expect((stmt.expression as StringLiteral).value).toBe('hello');
      });

      it('parses boolean', () => {
        const stmt = firstStmt('true;') as ExpressionStmt;
        expect((stmt.expression as BooleanLiteral).kind).toBe('BooleanLiteral');
        expect((stmt.expression as BooleanLiteral).value).toBe(true);
      });

      it('parses null', () => {
        const stmt = firstStmt('null;') as ExpressionStmt;
        expect(stmt.expression.kind).toBe('NullLiteral');
      });

      it('parses undefined', () => {
        const stmt = firstStmt('undefined;') as ExpressionStmt;
        expect(stmt.expression.kind).toBe('UndefinedLiteral');
      });

      it('parses array literal', () => {
        const stmt = firstStmt('[1, 2, 3];') as ExpressionStmt;
        const arr = stmt.expression as ArrayLiteral;
        expect(arr.kind).toBe('ArrayLiteral');
        expect(arr.elements).toHaveLength(3);
      });

      it('parses object literal in assignment', () => {
        const stmt = firstStmt('let o = { x: 1, y: 2 };') as VariableDecl;
        const obj = stmt.init as ObjectLiteral;
        expect(obj.kind).toBe('ObjectLiteral');
        expect(obj.fields).toHaveLength(2);
        expect(obj.fields[0].key).toBe('x');
        expect(obj.fields[1].key).toBe('y');
      });
    });

    describe('Binary expressions', () => {
      it('parses arithmetic', () => {
        const stmt = firstStmt('1 + 2;') as ExpressionStmt;
        const expr = stmt.expression as BinaryExpr;
        expect(expr.kind).toBe('BinaryExpr');
        expect(expr.op).toBe('+');
        expect((expr.left as NumberLiteral).value).toBe(1);
        expect((expr.right as NumberLiteral).value).toBe(2);
      });

      it('respects precedence (* before +)', () => {
        const stmt = firstStmt('1 + 2 * 3;') as ExpressionStmt;
        const expr = stmt.expression as BinaryExpr;
        expect(expr.op).toBe('+');
        expect((expr.left as NumberLiteral).value).toBe(1);
        const right = expr.right as BinaryExpr;
        expect(right.op).toBe('*');
        expect((right.left as NumberLiteral).value).toBe(2);
        expect((right.right as NumberLiteral).value).toBe(3);
      });

      it('parses comparison', () => {
        const stmt = firstStmt('x > 10;') as ExpressionStmt;
        const expr = stmt.expression as BinaryExpr;
        expect(expr.op).toBe('>');
      });

      it('parses equality', () => {
        const stmt = firstStmt('x == y;') as ExpressionStmt;
        const expr = stmt.expression as BinaryExpr;
        expect(expr.op).toBe('==');
      });

      it('parses logical operators', () => {
        const stmt = firstStmt('a && b || c;') as ExpressionStmt;
        const expr = stmt.expression as BinaryExpr;
        // || has lower precedence than &&
        expect(expr.op).toBe('||');
        expect((expr.left as BinaryExpr).op).toBe('&&');
      });
    });

    describe('Unary expressions', () => {
      it('parses negation', () => {
        const stmt = firstStmt('-x;') as ExpressionStmt;
        const expr = stmt.expression as UnaryExpr;
        expect(expr.kind).toBe('UnaryExpr');
        expect(expr.op).toBe('-');
        expect((expr.operand as Identifier).name).toBe('x');
      });

      it('parses logical not', () => {
        const stmt = firstStmt('!flag;') as ExpressionStmt;
        const expr = stmt.expression as UnaryExpr;
        expect(expr.op).toBe('!');
      });
    });

    describe('Assignment expressions', () => {
      it('parses simple assignment', () => {
        const stmt = firstStmt('x = 42;') as ExpressionStmt;
        const expr = stmt.expression as AssignExpr;
        expect(expr.kind).toBe('AssignExpr');
        expect(expr.op).toBe('=');
        expect((expr.target as Identifier).name).toBe('x');
        expect((expr.value as NumberLiteral).value).toBe(42);
      });

      it('parses compound assignment', () => {
        const stmt = firstStmt('x += 1;') as ExpressionStmt;
        const expr = stmt.expression as AssignExpr;
        expect(expr.op).toBe('+=');
      });
    });

    describe('Call expressions', () => {
      it('parses function call', () => {
        const stmt = firstStmt('foo(1, 2);') as ExpressionStmt;
        const expr = stmt.expression as CallExpr;
        expect(expr.kind).toBe('CallExpr');
        expect((expr.callee as Identifier).name).toBe('foo');
        expect(expr.args).toHaveLength(2);
      });

      it('parses chained call', () => {
        const stmt = firstStmt('a.b(1);') as ExpressionStmt;
        const expr = stmt.expression as CallExpr;
        expect(expr.kind).toBe('CallExpr');
        const callee = expr.callee as MemberExpr;
        expect(callee.kind).toBe('MemberExpr');
        expect(callee.property).toBe('b');
      });

      it('parses nested call', () => {
        const stmt = firstStmt('a(b());') as ExpressionStmt;
        const expr = stmt.expression as CallExpr;
        expect(expr.args).toHaveLength(1);
        expect((expr.args[0] as CallExpr).kind).toBe('CallExpr');
      });
    });

    describe('Member expressions', () => {
      it('parses dot access', () => {
        const stmt = firstStmt('obj.field;') as ExpressionStmt;
        const expr = stmt.expression as MemberExpr;
        expect(expr.kind).toBe('MemberExpr');
        expect((expr.object as Identifier).name).toBe('obj');
        expect(expr.property).toBe('field');
      });

      it('parses chained dot access', () => {
        const stmt = firstStmt('a.b.c;') as ExpressionStmt;
        const expr = stmt.expression as MemberExpr;
        expect(expr.property).toBe('c');
        const inner = expr.object as MemberExpr;
        expect(inner.property).toBe('b');
        expect((inner.object as Identifier).name).toBe('a');
      });
    });

    describe('Index expressions', () => {
      it('parses array index', () => {
        const stmt = firstStmt('arr[0];') as ExpressionStmt;
        const expr = stmt.expression as IndexExpr;
        expect(expr.kind).toBe('IndexExpr');
        expect((expr.object as Identifier).name).toBe('arr');
        expect((expr.index as NumberLiteral).value).toBe(0);
      });
    });

    describe('Ternary expressions', () => {
      it('parses ternary', () => {
        const stmt = firstStmt('x > 0 ? 1 : 0;') as ExpressionStmt;
        const expr = stmt.expression as TernaryExpr;
        expect(expr.kind).toBe('TernaryExpr');
        expect((expr.condition as BinaryExpr).op).toBe('>');
        expect((expr.consequent as NumberLiteral).value).toBe(1);
        expect((expr.alternate as NumberLiteral).value).toBe(0);
      });
    });

    describe('Parenthesized expressions', () => {
      it('parses parenthesized expression', () => {
        const stmt = firstStmt('(1 + 2) * 3;') as ExpressionStmt;
        const expr = stmt.expression as BinaryExpr;
        expect(expr.op).toBe('*');
        expect((expr.left as BinaryExpr).op).toBe('+');
      });
    });
  });

  // ---------- Complex programs ----------
  describe('Complex programs', () => {
    it('parses KSC function from spec', () => {
      const source = `export function battleResultValue(): number {
  const st: Battle.State = Battle.getState();
  return 1;
}`;
      const prog = p(source);
      expect(prog.body).toHaveLength(1);
      const exp = prog.body[0] as ExportDecl;
      const fn = exp.declaration as FunctionDecl;
      expect(fn.name).toBe('battleResultValue');
      expect(fn.body.body).toHaveLength(2);
    });

    it('parses multi-statement program', () => {
      const source = `
let x: number = 0;
let y: number = 10;
if (x < y) {
  x = y;
}
`;
      const prog = p(source);
      expect(prog.body).toHaveLength(3);
      expect(prog.body[0].kind).toBe('VariableDecl');
      expect(prog.body[1].kind).toBe('VariableDecl');
      expect(prog.body[2].kind).toBe('IfStmt');
    });

    it('parses import + function + export', () => {
      const source = `
import * as Battle from "battle/api";
export function getHP(): number {
  return Battle.getHP();
}
`;
      const prog = p(source);
      expect(prog.body).toHaveLength(2);
      expect(prog.body[0].kind).toBe('ImportDecl');
      expect(prog.body[1].kind).toBe('ExportDecl');
    });

    it('parses nested member call (Battle.getState())', () => {
      const stmt = firstStmt('Battle.getState();') as ExpressionStmt;
      const expr = stmt.expression as CallExpr;
      expect(expr.kind).toBe('CallExpr');
      const callee = expr.callee as MemberExpr;
      expect(callee.kind).toBe('MemberExpr');
      expect((callee.object as Identifier).name).toBe('Battle');
      expect(callee.property).toBe('getState');
    });
  });

  // ---------- Error cases ----------
  describe('Errors', () => {
    it('throws on unexpected token', () => {
      expect(() => p(')')).toThrow(ParseError);
    });

    it('throws on missing semicolon in for', () => {
      expect(() => p('for (let i = 0 i < 10; i += 1) {}')).toThrow(ParseError);
    });

    it('throws on invalid export', () => {
      expect(() => p('export 42;')).toThrow(ParseError);
    });

    it('includes line info in error', () => {
      try {
        p('let x = ;');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        expect((e as ParseError).line).toBe(1);
      }
    });
  });

  // ---------- Source locations ----------
  describe('Source locations', () => {
    it('tracks location on statements', () => {
      const stmt = firstStmt('let x = 1;') as VariableDecl;
      expect(stmt.loc.line).toBe(1);
      expect(stmt.loc.column).toBe(1);
    });

    it('tracks location on second line', () => {
      const prog = p('let x = 1;\nlet y = 2;');
      const second = prog.body[1] as VariableDecl;
      expect(second.loc.line).toBe(2);
      expect(second.loc.column).toBe(1);
    });
  });
});
