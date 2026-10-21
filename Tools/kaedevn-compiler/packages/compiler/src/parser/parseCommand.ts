import type { Op } from '@kaedevn/core';
import type { CommandToken } from '../types/Token.js';
import { CompilationException } from '../types/CompilerError.js';
import { COMMAND_PARSERS, STANDALONE_PARSERS } from '../registry/commandRegistry.js';

/**
 * コマンドトークンをOp命令に変換
 * レジストリから対応するパーサーを検索し、見つからなければ例外をスロー
 */
export function parseCommand(token: CommandToken): Op {
  const { command, args, line, raw } = token;

  const parser = COMMAND_PARSERS[command] ?? STANDALONE_PARSERS[command];
  if (parser) {
    return parser(args, line, raw);
  }

  throw new CompilationException([
    {
      code: 'UNKNOWN_COMMAND',
      message: `Unknown command: @${command}`,
      line,
      source: raw,
    },
  ]);
}
