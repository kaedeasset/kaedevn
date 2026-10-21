import type { KsAST, KsBlock } from '../types/KsAST.js';
import { KsScanner } from './KsScanner.js';
import { parseError } from '../types/CompilerError.js';

export class KsParser {
  private scanner = new KsScanner();

  public parse(text: string): KsAST {
    const flatBlocks = this.scanner.scan(text);
    const rootBlocks: KsBlock[] = [];
    const stack: KsBlock[][] = [rootBlocks];

    for (const block of flatBlocks) {
      if (block.type === 'if') {
        block.children = [];
        stack[stack.length - 1].push(block);
        stack.push(block.children);
      } else if (block.type === 'else') {
        if (stack.length <= 1) {
          parseError('Unexpected @else without @if', block.line);
        }
        stack.pop(); // Pop 'then' children context
        const parentList = stack[stack.length - 1];
        const lastIf = parentList[parentList.length - 1];
        if (lastIf && lastIf.type === 'if') {
          lastIf.elseChildren = [];
          stack.push(lastIf.elseChildren);
        } else {
          // dangling else (fallback)
          parentList.push(block);
          block.children = [];
          stack.push(block.children);
        }
      } else if (block.type === 'endif') {
        if (stack.length <= 1) {
          parseError('Unexpected @endif without @if', block.line);
        }
        stack.pop(); // Pop children context
      } else {
        stack[stack.length - 1].push(block);
      }
    }

    if (stack.length > 1) {
      parseError('Unclosed @if block. Missing @endif.');
    }

    return { blocks: rootBlocks };
  }
}
