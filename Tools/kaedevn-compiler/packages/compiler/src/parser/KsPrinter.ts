import type { KsAST, KsBlock } from '../types/KsAST.js';

export class KsPrinter {
  public print(ast: KsAST): string {
    return this.printBlocks(ast.blocks, 0);
  }

  private printBlocks(blocks: KsBlock[], indent: number): string {
    let result = '';
    const space = '  '.repeat(indent);

    for (const block of blocks) {
      if (block.type === 'command' || block.type === 'if' || block.type === 'else' || block.type === 'endif') {
        if (block.command === 'comment') {
          result += `${space}; ${block.content}\n`;
          continue;
        }

        if (block.command === 'speaker') {
          result += `${space}#${block.content}\n`;
          continue;
        }
        
        let line = `${space}@${block.command}`;
        // 順序保証つき位置引数（args のキー順に依存しない。KsAST の positional コメント参照）
        if (block.positional) {
          for (const p of block.positional) {
            line += ` ${p}`;
          }
        }
        if (block.args) {
          for (const [key, value] of Object.entries(block.args)) {
            if (value === true) {
              line += ` ${key}`;
            } else {
              const valStr = typeof value === 'string' && value.includes(' ') ? `"${value}"` : value;
              line += ` ${key}=${valStr}`;
            }
          }
        }
        result += line + '\n';

        if (block.type === 'if') {
          if (block.children) {
            result += this.printBlocks(block.children, indent + 1);
          }
          if (block.elseChildren) {
            result += `${space}@else\n`;
            result += this.printBlocks(block.elseChildren, indent + 1);
          }
          result += `${space}@endif\n`;
        } else if (block.children) {
          result += this.printBlocks(block.children, indent + 1);
        }
      } else if (block.type === 'label') {
        result += `*${block.content}\n`;
      } else if (block.type === 'text') {
        result += `${block.content}\n`;
      }
    }

    return result;
  }
}
