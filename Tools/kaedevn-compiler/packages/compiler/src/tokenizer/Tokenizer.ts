import type { TokenUnion, CommandToken, TextToken, VarSetToken, ChoiceStartToken, ChoiceOptionToken, ChoiceEndToken, IfStartToken, IfElseToken, IfEndToken, LabelToken, SpeakerToken } from '../types/Token.js';
import { classifyLine } from './lineClassifier.js';
import { parseError } from '../types/CompilerError.js';
import { splitCommandLine } from '../parser/splitCommandLine.js';

export class Tokenizer {
  public tokenize(source: string): TokenUnion[] {
    const lines = source.split('\n');
    const tokens: TokenUnion[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      // 空行はスキップ
      if (!line) continue;

      const type = classifyLine(line);

      if (type === 'COMMENT') {
        // コメントは無視
        continue;
      }

      if (type === 'LABEL') {
        tokens.push(this.parseLabel(line, lineNum));
        continue;
      }

      if (type === 'SPEAKER') {
        tokens.push(this.parseSpeaker(line, lineNum));
        continue;
      }

      if (type === 'COMMAND') {
        tokens.push(this.parseCommand(line, lineNum));
        continue;
      }

      if (type === 'VAR_SET') {
        tokens.push(this.parseVarSet(line, lineNum));
        continue;
      }

      if (type === 'CHOICE_START') {
        tokens.push(this.parseChoiceStart(line, lineNum));
        continue;
      }

      if (type === 'CHOICE_OPTION') {
        tokens.push(this.parseChoiceOption(line, lineNum));
        continue;
      }

      if (type === 'CHOICE_END') {
        tokens.push(this.parseChoiceEnd(line, lineNum));
        continue;
      }

      if (type === 'IF_START') {
        tokens.push(this.parseIfStart(line, lineNum));
        continue;
      }

      if (type === 'IF_ELSE') {
        tokens.push(this.parseIfElse(line, lineNum));
        continue;
      }

      if (type === 'IF_END') {
        tokens.push(this.parseIfEnd(line, lineNum));
        continue;
      }

      if (type === 'TEXT') {
        tokens.push(this.parseText(line, lineNum));
        continue;
      }
    }

    return tokens;
  }

  private parseCommand(line: string, lineNum: number): CommandToken {
    const { command, args } = splitCommandLine(line);

    return {
      type: 'COMMAND',
      line: lineNum,
      raw: line,
      command,
      args,
    };
  }

  private parseText(line: string, lineNum: number): TextToken {
    return {
      type: 'TEXT',
      line: lineNum,
      raw: line,
      text: line,
    };
  }

  private parseVarSet(line: string, lineNum: number): VarSetToken {
    // varName = value, varName += value, varName -= value
    const match = line.match(/^\s*(\w+)\s*(=|\+=|-=)\s*(.+)/);
    if (!match) {
      parseError('Invalid variable assignment', lineNum, line);
    }

    const [, varName, operator, value] = match;
    return {
      type: 'VAR_SET',
      line: lineNum,
      raw: line,
      varName: varName.trim(),
      operator: operator as '=' | '+=' | '-=',
      value: value.trim(),
    };
  }

  private parseChoiceStart(line: string, lineNum: number): ChoiceStartToken {
    return {
      type: 'CHOICE_START',
      line: lineNum,
      raw: line,
    };
  }

  private parseChoiceOption(line: string, lineNum: number): ChoiceOptionToken {
    // "選択肢テキスト" [if (condition)] {
    const match = line.match(/^\s*"([^"]*)"\s*(?:if\s+\(([^)]+)\))?\s*\{/);
    if (!match) {
      parseError('Invalid choice option', lineNum, line);
    }

    const [, text, condition] = match;
    return {
      type: 'CHOICE_OPTION',
      line: lineNum,
      raw: line,
      text,
      condition: condition || undefined,
    };
  }

  private parseChoiceEnd(line: string, lineNum: number): ChoiceEndToken {
    return {
      type: 'CHOICE_END',
      line: lineNum,
      raw: line,
    };
  }

  private parseIfStart(line: string, lineNum: number): IfStartToken {
    // if (condition) {
    const match = line.match(/^\s*if\s+\(([^)]+)\)\s*\{/);
    if (!match) {
      parseError('Invalid if statement', lineNum, line);
    }

    const [, condition] = match;
    return {
      type: 'IF_START',
      line: lineNum,
      raw: line,
      condition: condition.trim(),
    };
  }

  private parseIfElse(line: string, lineNum: number): IfElseToken {
    return {
      type: 'IF_ELSE',
      line: lineNum,
      raw: line,
    };
  }

  private parseIfEnd(line: string, lineNum: number): IfEndToken {
    return {
      type: 'IF_END',
      line: lineNum,
      raw: line,
    };
  }

  private parseLabel(line: string, lineNum: number): LabelToken {
    // *labelName → name = "labelName"
    const name = line.substring(1).trim();
    return {
      type: 'LABEL',
      line: lineNum,
      raw: line,
      name,
    };
  }

  private parseSpeaker(line: string, lineNum: number): SpeakerToken {
    // #赤音 → name = "赤音"
    const name = line.substring(1).trim();
    return {
      type: 'SPEAKER',
      line: lineNum,
      raw: line,
      name,
    };
  }
}
