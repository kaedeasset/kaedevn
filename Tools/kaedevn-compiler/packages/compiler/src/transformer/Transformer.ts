import type { Op } from '@kaedevn/core';

/**
 * テキスト内の埋め込みコマンド（@l/@p/@r）を分解
 */
export class Transformer {
  public transform(ops: Op[]): Op[] {
    const result: Op[] = [];

    for (const op of ops) {
      if (op.op === 'TEXT_APPEND') {
        // テキスト内に埋め込みコマンドがあるか確認
        const expanded = this.expandEmbeddedCommands(op);
        result.push(...expanded);
      } else {
        result.push(op);
      }
    }

    return result;
  }

  private expandEmbeddedCommands(textOp: Op & { op: 'TEXT_APPEND' }): Op[] {
    const { text, who } = textOp;

    // @l, @p, @r を検出
    const parts = text.split(/(@[lpr])/);

    const ops: Op[] = [];

    for (const part of parts) {
      if (part === '@l') {
        ops.push({ op: 'WAIT_CLICK' });
      } else if (part === '@p') {
        ops.push({ op: 'PAGE' });
      } else if (part === '@r') {
        ops.push({ op: 'TEXT_NL' });
      } else if (part) {
        // 空文字列は無視
        const op: Op = { op: 'TEXT_APPEND', text: part };
        if (who) op.who = who;
        ops.push(op);
      }
    }

    return ops;
  }
}
