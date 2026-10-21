export type LineType = 'COMMENT' | 'COMMAND' | 'TEXT' | 'VAR_SET' | 'CHOICE_START' | 'CHOICE_OPTION' | 'CHOICE_END' | 'IF_START' | 'IF_ELSE' | 'IF_END' | 'LABEL' | 'SPEAKER';

export interface Token {
  type: LineType;
  line: number;
  raw: string;
}

export interface CommentToken extends Token {
  type: 'COMMENT';
}

export interface CommandToken extends Token {
  type: 'COMMAND';
  command: string;
  args: string[];
}

export interface TextToken extends Token {
  type: 'TEXT';
  text: string;
}

export interface VarSetToken extends Token {
  type: 'VAR_SET';
  varName: string;
  operator: '=' | '+=' | '-=';
  value: string;
}

export interface ChoiceStartToken extends Token {
  type: 'CHOICE_START';
}

export interface ChoiceOptionToken extends Token {
  type: 'CHOICE_OPTION';
  text: string;
  condition?: string;
}

export interface ChoiceEndToken extends Token {
  type: 'CHOICE_END';
}

export interface IfStartToken extends Token {
  type: 'IF_START';
  condition: string;
}

export interface IfElseToken extends Token {
  type: 'IF_ELSE';
}

export interface IfEndToken extends Token {
  type: 'IF_END';
}

export interface LabelToken extends Token {
  type: 'LABEL';
  name: string;
}

/**
 * 話者指定トークン (`#赤音` 形式)
 * 後続の TEXT_APPEND.who を上書きする
 */
export interface SpeakerToken extends Token {
  type: 'SPEAKER';
  name: string;
}

export type TokenUnion = CommentToken | CommandToken | TextToken | VarSetToken | ChoiceStartToken | ChoiceOptionToken | ChoiceEndToken | IfStartToken | IfElseToken | IfEndToken | LabelToken | SpeakerToken;
