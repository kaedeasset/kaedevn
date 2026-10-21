/** KSC Type Checker Errors */

import type { SourceLocation } from '../types/ast.js';

// ---- Error Codes ----

export const E = {
  // 変数関連
  UNDEFINED_VARIABLE: 'E1101',
  DUPLICATE_DECLARATION: 'E1102',
  CONST_REASSIGN: 'E1103',

  // 型不一致
  TYPE_MISMATCH: 'E1201',
  STRING_NUMBER_ADD: 'E1203',

  // 関数呼び出し
  ARG_COUNT_MISMATCH: 'E1301',

  // return
  RETURN_OUTSIDE_FUNCTION: 'E1401',
  RETURN_TYPE_MISMATCH: 'E1402',

  // 呼び出し
  NOT_CALLABLE: 'E1501',

  // プロパティ
  NO_SUCH_PROPERTY: 'E1601',

  // await
  AWAIT_NON_PROMISE: 'E1901',
} as const;

export type ErrorCode = (typeof E)[keyof typeof E];

// ---- TypeCheckError ----

export interface TypeCheckError {
  code: ErrorCode;
  message: string;
  loc: SourceLocation;
}

export function makeError(code: ErrorCode, message: string, loc: SourceLocation): TypeCheckError {
  return { code, message, loc };
}
