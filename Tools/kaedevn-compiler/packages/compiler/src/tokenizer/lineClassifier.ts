import type { LineType } from '../types/Token.js';

/**
 * 行の種別を判定
 */
export function classifyLine(line: string): LineType {
  const trimmed = line.trim();

  if (trimmed.startsWith('//') || trimmed.startsWith(';')) {
    return 'COMMENT';
  }

  // ラベル (*start, *page2 etc.)
  if (trimmed.startsWith('*')) {
    return 'LABEL';
  }

  // 話者指定 (#赤音, #太郎 etc.) — `#` の後に空白を含まない単語
  // `#` 単独は「話者リセット」（後続 TEXT_APPEND の who を undefined にする）
  // コメント (//, ;) や @ コマンドより後で判定
  if (trimmed === '#') {
    return 'SPEAKER';
  }
  if (trimmed.startsWith('#') && trimmed.length > 1 && !/^#\d/.test(trimmed)) {
    return 'SPEAKER';
  }

  // 変数操作: varName = value, varName += value, varName -= value
  if (/^\s*\w+\s*(=|\+=|-=)\s*\S+/.test(trimmed)) {
    return 'VAR_SET';
  }

  // choice {
  if (trimmed === 'choice {') {
    return 'CHOICE_START';
  }

  // "選択肢テキスト" [if (condition)] {
  if (/^\s*"[^"]*"(\s+if\s+\([^)]+\))?\s*\{/.test(trimmed)) {
    return 'CHOICE_OPTION';
  }

  // if (condition) {
  if (/^\s*if\s+\([^)]+\)\s*\{/.test(trimmed)) {
    return 'IF_START';
  }

  // } else {
  if (trimmed === '} else {') {
    return 'IF_ELSE';
  }

  // }
  if (trimmed === '}') {
    // choice, if, choice option の終了を表す
    // どれかはParserレベルで判断
    return 'CHOICE_END'; // とりあえずCHOICE_ENDとする（Parserで文脈判断）
  }

  if (trimmed.startsWith('@')) {
    // @ の後の単語を抽出（スペースまたは行末まで）
    const commandMatch = trimmed.match(/^@(\w+)(?:\s|$)/);
    if (commandMatch) {
      // 既知・未知を問わず COMMAND として分類。
      // 未知コマンドは parseCommand で UNKNOWN_COMMAND エラーになる。
      return 'COMMAND';
    }
    // @r@l@p のようなインライン記法は TEXT
    return 'TEXT';
  }

  return 'TEXT';
}
