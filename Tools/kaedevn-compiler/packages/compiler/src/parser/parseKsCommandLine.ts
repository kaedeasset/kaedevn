import type { Op } from '@kaedevn/core';
import type { CommandToken } from '../types/Token.js';
import { CompilationException } from '../types/CompilerError.js';
import { parseCommand } from './parseCommand.js';
import { splitCommandLine } from './splitCommandLine.js';

/**
 * KS の `@command …` 行テキスト1行を Op へ変換する（P6-9 execOp 用）。
 *
 * KSC の @ 行（行頭ディスパッチ）のコンパイル時変換に使う。分割規則は KS 本体の
 * Tokenizer.parseCommand と同一（splitCommandLine）で、解釈は commandRegistry に
 * 完全委譲するため KS と KSC で @ 行の意味が食い違わない。
 *
 * pc 系 Op は execOp で運ばない（KSC 側の label/jump/if-else・関数が担当）ため、
 * 変換結果が pc 制御を要する Op ならエラーにする。
 */
const PC_COUPLED_OPS = new Set(['JUMP', 'JUMP_IF', 'CHOICE', 'CALL', 'RETURN', 'BATTLE_START']);

/** pc 系コマンドへの案内メッセージ（KSC での代替を明示する）。 */
const PC_COUPLED_HINTS: Record<string, string> = {
  JUMP: 'use KSC `jump <label>` (or `*label` lines) instead',
  CALL: 'use a KSC function call instead',
  RETURN: 'use a KSC function return instead',
  BATTLE_START: 'use `engine.battleStart(...)` instead',
};

export function parseKsCommandLine(line: string, lineNum: number): Op {
  const trimmed = line.trim();
  const { command, args } = splitCommandLine(trimmed);
  if (!command) {
    throw new CompilationException([
      { code: 'INVALID_ARGS', message: 'empty @ command line', line: lineNum, source: line },
    ]);
  }

  const token: CommandToken = {
    type: 'COMMAND',
    line: lineNum,
    raw: trimmed.startsWith('@') ? trimmed : `@${trimmed}`,
    command,
    args,
  };
  const op = parseCommand(token);

  if (PC_COUPLED_OPS.has(op.op)) {
    const hint = PC_COUPLED_HINTS[op.op] ?? 'not supported in KSC @ lines';
    throw new CompilationException([
      {
        code: 'INVALID_ARGS',
        message: `@${command} is a control-flow command and cannot run via execOp; ${hint}.`,
        line: lineNum,
        source: line,
      },
    ]);
  }
  return op;
}
