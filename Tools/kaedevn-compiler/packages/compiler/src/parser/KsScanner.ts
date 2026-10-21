import type { KsBlock, KsBlockType } from '../types/KsAST.js';
import { ulid } from 'ulid';
import { splitCommandLine } from './splitCommandLine.js';

export class KsScanner {
  public scan(text: string): KsBlock[] {
    const lines = text.split('\n');
    const blocks: KsBlock[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith(';')) {
        blocks.push({
          id: ulid(),
          type: 'command', // Use 'command' type for now but distinguish by command name
          line: i + 1,
          raw: trimmed,
          command: 'comment',
          content: trimmed.substring(1).trim()
        });
        continue;
      }

      if (trimmed.startsWith('#')) {
        blocks.push({
          id: ulid(),
          type: 'command',
          line: i + 1,
          raw: trimmed,
          command: 'speaker',
          content: trimmed.substring(1).trim()
        });
        continue;
      }

      if (trimmed.startsWith('@')) {
        blocks.push(this.parseCommand(trimmed, i + 1));
      } else if (trimmed.startsWith('*')) {
        blocks.push({
          id: ulid(),
          type: 'label',
          line: i + 1,
          raw: trimmed,
          content: trimmed.substring(1).trim()
        });
      } else {
        blocks.push({
          id: ulid(),
          type: 'text',
          line: i + 1,
          raw: trimmed,
          content: trimmed
        });
      }
    }

    return blocks;
  }

  private parseCommand(line: string, lineNum: number): KsBlock {
    const { command, args: words } = splitCommandLine(line);
    const args: Record<string, string | number | boolean> = {};
    // 位置引数は args の { 値: true } キー表現だと同値で潰れる・integer-like キーで
    // 並べ替えが起きるため、順序・重複を保持した配列でも持つ
    // （例: `@sprite left left x=0` → positional ['left', 'left']）
    const positional: string[] = [];

    for (const arg of words) {
      // 最初の `=` でのみ分割する（値中の `=` を保持。例: exp=f.score>=10）
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg : arg.slice(0, eq);
      const value = eq === -1 ? undefined : arg.slice(eq + 1);
      if (key && value !== undefined) {
        const num = parseFloat(value);
        if (!isNaN(num) && (value.indexOf('.') !== -1 || /^\d+$/.test(value))) {
          args[key] = num;
        } else if (value === 'true' || value === 'false') {
          args[key] = value === 'true';
        } else {
          args[key] = value.replace(/^["']|["']$/g, '');
        }
      } else if (key) {
        // 位置引数は positional のみに保存する（args に { 値: true } で重複保存すると
        // KsPrinter が positional と args の両方から emit して二重出力になる）
        positional.push(key);
      }
    }

    let type: KsBlockType = 'command';
    if (command === 'if') type = 'if';
    if (command === 'else') type = 'else';
    if (command === 'endif') type = 'endif';

    return {
      id: ulid(),
      type,
      line: lineNum,
      raw: line,
      command,
      args,
      ...(positional.length > 0 ? { positional } : {})
    };
  }
}
