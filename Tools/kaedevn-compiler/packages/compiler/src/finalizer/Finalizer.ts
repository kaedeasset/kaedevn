import type { Op } from '@kaedevn/core';

/**
 * 末尾自動@p付与
 *
 * 命令列の末尾が WAIT_CLICK / PAGE / WAIT_MS で終わっていない場合、
 * 自動的に PAGE を追加する（最後で止まらない事故防止）
 */
export class Finalizer {
  public finalize(ops: Op[]): Op[] {
    if (ops.length === 0) {
      return ops;
    }

    const last = ops[ops.length - 1];

    // 末尾が待機系コマンドで終わっているかチェック
    const needsPage =
      last.op !== 'WAIT_CLICK' &&
      last.op !== 'PAGE' &&
      last.op !== 'WAIT_MS';

    if (needsPage) {
      // PAGE を追加
      return [...ops, { op: 'PAGE' }];
    }

    return ops;
  }
}
