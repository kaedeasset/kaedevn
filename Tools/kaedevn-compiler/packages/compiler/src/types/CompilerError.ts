export type ErrorCode =
  | 'UNKNOWN_COMMAND'
  | 'INVALID_ARGS'
  | 'INVALID_VALUE'
  | 'PARSE_ERROR';

export interface CompilerError {
  code: ErrorCode;
  message: string;
  line?: number;
  source?: string;
}

export class CompilationException extends Error {
  public readonly errors: CompilerError[];

  constructor(errors: CompilerError[]) {
    const messages = errors
      .map((e) =>
        `[${e.code}]${e.line ? ` Line ${e.line}:` : ''} ${e.message}${
          e.source ? `\n  > ${e.source}` : ''
        }`
      )
      .join('\n');
    super(messages);
    this.name = 'CompilationException';
    this.errors = errors;
  }
}

/** 字句・構文の誤りを PARSE_ERROR の CompilationException で投げる。 */
export function parseError(message: string, line?: number, source?: string): never {
  throw new CompilationException([{ code: 'PARSE_ERROR', message, line, source }]);
}
