/**
 * `@command 引数…` 行を切る規則（Tokenizer・KsScanner・parseKsCommandLine・ブロック変換・
 * リンカが共有する）。空白の並びで区切り、前後の空白から出る空の語は捨てる。
 */

/** 文字列を空白の並びで語に切る（空の語は出さない）。 */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** `@command 引数…` 行（先頭の `@` は無くてもよい）をコマンド名と引数へ切る。 */
export function splitCommandLine(line: string): { command: string; args: string[] } {
  const trimmed = line.trim();
  const parts = splitWords(trimmed.startsWith('@') ? trimmed.slice(1) : trimmed);
  return { command: parts[0] ?? '', args: parts.slice(1) };
}
