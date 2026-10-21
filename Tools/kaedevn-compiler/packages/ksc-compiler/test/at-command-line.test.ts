import { describe, it, expect } from 'vitest';
import { tokenize, LexerError } from '../src/lexer.js';
import { parse, ParseError } from '../src/parser.js';
import { EmitError, type EmitOptions } from '../src/emitter.js';
import { typeCheck } from '../src/checker.js';
import { OpCode } from '../src/types/ir.js';
import { TokenType } from '../src/types/token.js';
import type { IRModule, Instruction } from '../src/types/ir.js';
import { emitOnly as compile } from './helpers.js';

/** テスト用 atCommandParser: KS commandRegistry の代わりに raw を素朴に Op 風へ変換 */
const fakeParser: EmitOptions['atCommandParser'] = (raw) => {
  const [command, ...args] = raw.split(/\s+/);
  return { op: command.toUpperCase(), args };
};

function mainInstructions(mod: IRModule): Instruction[] {
  return mod.functions[mod.entryPoint].instructions;
}

describe('P6-9 行頭ディスパッチ — lexer', () => {
  it('tokenizes a line-head @ command as one AtCommandLine token', () => {
    const tokens = tokenize('@bg classroom fade=500\nlet x = 1;');
    expect(tokens[0]).toMatchObject({ type: TokenType.AtCommandLine, value: 'bg classroom fade=500' });
    expect(tokens[1].type).toBe(TokenType.Let);
  });

  it('tokenizes a line-head *name as a LabelLine token', () => {
    const tokens = tokenize('*chapter1\nlet x = 1;');
    expect(tokens[0]).toMatchObject({ type: TokenType.LabelLine, value: 'chapter1' });
  });

  it('keeps * as multiplication when not at line head or followed by space', () => {
    const tokens = tokenize('let x = 2 * 3;\nlet y = a * b;');
    expect(tokens.filter((t) => t.type === TokenType.Star)).toHaveLength(2);
    expect(tokens.some((t) => t.type === TokenType.LabelLine)).toBe(false);
  });

  it('rejects @ that is not at the beginning of a line', () => {
    expect(() => tokenize('let x = 1; @bg room')).toThrowError(LexerError);
  });

  it('does not confuse dialogue inline @r with @ command lines', () => {
    const tokens = tokenize('# akane\n「こんにちは」@r\n#\n@bg room');
    expect(tokens.some((t) => t.type === TokenType.InlineCommand && t.value === 'r')).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.AtCommandLine && t.value === 'bg room')).toBe(true);
  });
});

describe('P6-9 行頭ディスパッチ — parser', () => {
  it('parses @word lines as AtCommandStmt', () => {
    const ast = parse(tokenize('@bg classroom fade=500'));
    expect(ast.body[0]).toMatchObject({ kind: 'AtCommandStmt', raw: 'bg classroom fade=500' });
  });

  it('desugars *name to LabelStmt (same as `label name`)', () => {
    const viaStar = parse(tokenize('*intro'));
    const viaKeyword = parse(tokenize('label intro;'));
    expect(viaStar.body[0]).toMatchObject({ kind: 'LabelStmt', name: 'intro' });
    expect(viaKeyword.body[0]).toMatchObject({ kind: 'LabelStmt', name: 'intro' });
  });

  it('desugars @jump to JumpStmt (pc-coupled ops never reach execOp)', () => {
    const ast = parse(tokenize('@jump intro'));
    expect(ast.body[0]).toMatchObject({ kind: 'JumpStmt', label: 'intro' });
  });

  it('rejects @call / @return / @battle with KSC-native hints', () => {
    expect(() => parse(tokenize('@call sub'))).toThrowError(ParseError);
    expect(() => parse(tokenize('@return'))).toThrowError(/function return/);
    expect(() => parse(tokenize('@battle troop1'))).toThrowError(/battleStart/);
  });

  it('typeCheck passes AtCommandStmt through', () => {
    const ast = parse(tokenize('@bg room\nlet x: number = 1;'));
    const result = typeCheck(ast);
    expect(result.errors).toHaveLength(0);
  });
});

describe('P6-9 行頭ディスパッチ — emitter (execOp)', () => {
  it('emits LOAD_CONST(opJson) → HOST_CALL execOp,1 → AWAIT → POP', () => {
    const mod = compile('@bg classroom fade=500', { atCommandParser: fakeParser });
    const instrs = mainInstructions(mod);

    const hostCallIdx = instrs.findIndex(
      (i) => i.op === OpCode.HOST_CALL && mod.constants[i.operand!] === 'execOp',
    );
    expect(hostCallIdx).toBeGreaterThan(0);
    expect(instrs[hostCallIdx].operand2).toBe(1); // 引数1つ（opJson）
    expect(instrs[hostCallIdx - 1].op).toBe(OpCode.LOAD_CONST);
    expect(instrs[hostCallIdx + 1].op).toBe(OpCode.AWAIT);
    expect(instrs[hostCallIdx + 2].op).toBe(OpCode.POP);

    const opJson = mod.constants[instrs[hostCallIdx - 1].operand!] as string;
    expect(JSON.parse(opJson)).toEqual({ op: 'BG', args: ['classroom', 'fade=500'] });
  });

  it('*label + jump resolves through the existing label machinery', () => {
    const mod = compile('*start\n@bg room\njump start;', { atCommandParser: fakeParser });
    const instrs = mainInstructions(mod);
    expect(instrs.some((i) => i.op === OpCode.JMP)).toBe(true);
  });

  it('throws EmitError when @ lines exist but no atCommandParser is injected', () => {
    expect(() => compile('@bg room')).toThrowError(EmitError);
    expect(() => compile('@bg room')).toThrowError(/atCommandParser/);
  });

  it('wraps atCommandParser errors as EmitError with line info', () => {
    const throwing: EmitOptions['atCommandParser'] = () => {
      throw new Error('Unknown command: @nope');
    };
    expect(() => compile('@nope', { atCommandParser: throwing })).toThrowError(/Unknown command/);
  });

  it('sources without @ lines compile identically with and without the option (回帰)', () => {
    const src = 'let x = 1;\n# akane "こんにちは"\nlabel end;';
    const a = compile(src);
    const b = compile(src, { atCommandParser: fakeParser });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
