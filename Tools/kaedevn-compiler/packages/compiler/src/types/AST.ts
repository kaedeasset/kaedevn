import type { Op } from '@kaedevn/core';

export interface ASTNode {
  type: 'label' | 'command' | 'text';
  line: number;
}

export interface LabelNode extends ASTNode {
  type: 'label';
  name: string;
}

export interface CommandNode extends ASTNode {
  type: 'command';
  command: Op;
}

export interface TextNode extends ASTNode {
  type: 'text';
  text: string;
  character?: string;
}

export type ASTNodeUnion = LabelNode | CommandNode | TextNode;

export interface AST {
  nodes: ASTNodeUnion[];
}
