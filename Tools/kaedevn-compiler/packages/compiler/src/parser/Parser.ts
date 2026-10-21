import type { Op } from '@kaedevn/core';
import type { TokenUnion, VarSetToken, ChoiceOptionToken, CommandToken } from '../types/Token.js';
import { parseCommand } from './parseCommand.js';
import { parseText } from './parseText.js';
import { parseError } from '../types/CompilerError.js';
import type { CompilerWarning } from '../types/CompilerOptions.js';

/**
 * 文を読む場所。入れ子の choice / if の扱いだけが違う:
 * - top: 本文。入れ子を絶対 pc で読む
 * - branch: if の then / else。入れ子を相対 0 で読む（呼び出し側の adjustPcOffsets が足す）
 * - option: choice の選択肢の中。入れ子を読まずにトークンを飛ばす
 */
type Scope = 'top' | 'branch' | 'option';

/** ラベル解決を待つ JUMP / CALL に付ける印（parse() の最後で pendingJumps へ移して消す）。 */
type PendingLabelOp = Op & { __label?: string };

function pendingLabelOf(op: Op): string | undefined {
  return (op as PendingLabelOp).__label;
}

export class Parser {
  private tokens: TokenUnion[] = [];
  private current = 0;
  /** ラベル名 → ops 配列内の位置 */
  private labelPositions = new Map<string, number>();
  /** 解決待ちの @jump（ops 配列内のインデックス, ラベル名） */
  private pendingJumps: Array<{ opIndex: number; label: string }> = [];

  constructor(private readonly onWarning: (warning: CompilerWarning) => void = () => {}) {}

  public parse(tokens: TokenUnion[]): Op[] {
    this.tokens = tokens;
    this.current = 0;
    this.labelPositions.clear();
    this.pendingJumps = [];

    const ops = this.parseBlock();

    // ラベル待ちの印が付いた JUMP / CALL を pendingJumps に移す。
    // parseIf/parseChoice は最終的な absolute pc を知らないため、ここで全 ops を
    // 走査して見つかった印を opIndex とともに pendingJumps に追加する。
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const label = pendingLabelOf(op);
      if ((op.op === 'JUMP' || op.op === 'CALL') && label) {
        this.pendingJumps.push({ opIndex: i, label });
        delete (op as PendingLabelOp).__label;
      }
    }

    // ラベル参照を解決
    this.resolveLabelJumps(ops);

    return ops;
  }

  /** ラベル名 → PC のマップを返す（BATTLE_START の onWin/onLose 解決用） */
  public getLabelPositions(): Record<string, number> {
    return Object.fromEntries(this.labelPositions);
  }

  private parseBlock(): Op[] {
    const ops: Op[] = [];
    /** 直近の SPEAKER トークンの name — 後続 TEXT_APPEND の who に注入する */
    let currentSpeaker: string | undefined;

    while (this.current < this.tokens.length) {
      const token = this.tokens[this.current];

      if (token.type === 'LABEL') {
        // ラベル位置を記録（次の op の位置）
        this.labelPositions.set(token.name, ops.length);
        this.current++;
      } else if (token.type === 'SPEAKER') {
        // 話者指定 — 後続の TEXT_APPEND.who に乗せるため記録
        // 空名 (`#` 単独) は話者リセット（前ブロックの話者が漏れないようにする）
        currentSpeaker = token.name ? token.name : undefined;
        this.current++;
      } else if (token.type === 'CHOICE_END' || token.type === 'IF_END' || token.type === 'IF_ELSE') {
        // ブロックの終わりに到達したら、このレベルのパースを終了
        break;
      } else {
        this.parseStatement(token, ops, 'top', currentSpeaker);
      }
    }

    return ops;
  }

  /**
   * 1 トークンを Op にして out へ積み、current を進める（本文・then/else・選択肢の中で共通）。
   * speaker は直前の SPEAKER の名前。TEXT_APPEND の who が空なら入れる（parseText 内の : 解析が
   * 無い場合のみ。本文だけが渡す）。
   */
  private parseStatement(token: TokenUnion, out: Op[], scope: Scope, speaker?: string): void {
    if (token.type === 'COMMAND') {
      out.push(this.parseCommandToken(token));
    } else if (token.type === 'TEXT') {
      const op = parseText(token);
      if (speaker !== undefined && op.op === 'TEXT_APPEND' && op.who === undefined) {
        op.who = speaker;
      }
      out.push(op);
    } else if (token.type === 'VAR_SET') {
      out.push(this.parseVarSet(token));
    } else if (token.type === 'CHOICE_START' && scope !== 'option') {
      out.push(...this.parseChoice(scope === 'top' ? out.length : 0));
      return;
    } else if (token.type === 'IF_START' && scope !== 'option') {
      out.push(...this.parseIf(scope === 'top' ? out.length : 0));
      return;
    }
    this.current++;
  }

  /**
   * @jump / @call LABEL はラベル待ちの印を付けた JUMP / CALL にする（parse() が最後に解決する）。
   * 直接 parseCommand に流すと pc=-1 のまま残り、adjustPcOffsets で意味不明な値に化ける
   * (例: if 内 @jump が JUMP_IF 自身に戻るループになる)。
   */
  private parseCommandToken(token: CommandToken): Op {
    if ((token.command === 'jump' || token.command === 'call') && token.args.length > 0) {
      const op: PendingLabelOp = { op: token.command === 'jump' ? 'JUMP' : 'CALL', pc: -1, __label: token.args[0] };
      return op;
    }
    return parseCommand(token);
  }

  private parseVarSet(token: VarSetToken): Op {
    // `=` は number | string | boolean を受ける（P6-4）。`+=`/`-=` は数値のみ維持。
    if (token.operator === '=') {
      const value = parseVarSetLiteral(token.value);
      if (value === undefined) {
        parseError(`Invalid value: ${token.value} (expected number, "string", true or false)`, token.line, token.raw);
      }
      return { op: 'VAR_SET', name: token.varName, value };
    }

    const value = parseFloat(token.value);
    if (isNaN(value)) {
      parseError(`Invalid number: ${token.value}`, token.line, token.raw);
    }

    switch (token.operator) {
      case '+=':
        return { op: 'VAR_ADD', name: token.varName, value };
      case '-=':
        return { op: 'VAR_SUB', name: token.varName, value };
    }
  }

  private parseChoice(pcOffset: number): Op[] {
    // CHOICE_START を消費
    this.current++;

    const options: Array<{ label: string; jump: number }> = [];
    const optionBlocks: Op[][] = [];

    // 選択肢オプションをパース
    while (this.current < this.tokens.length) {
      const token = this.tokens[this.current];

      if (token.type === 'CHOICE_END') {
        // choice ブロックの終わり
        this.current++;
        break;
      }

      if (token.type === 'CHOICE_OPTION') {
        const optionToken = token as ChoiceOptionToken;

        // TODO: condition のサポート（将来の拡張）
        if (optionToken.condition) {
          this.onWarning({ message: `Choice conditions not yet supported: ${optionToken.condition}`, line: token.line });
        }

        // オプションのラベルを記録
        options.push({ label: optionToken.text, jump: 0 }); // jump は後で計算

        // { を消費
        this.current++;

        // オプション内のブロックをパース（} まで）
        const blockOps: Op[] = [];
        while (this.current < this.tokens.length) {
          const blockToken = this.tokens[this.current];

          if (blockToken.type === 'CHOICE_END') {
            // オプションブロックの終わり
            this.current++;
            break;
          }

          this.parseStatement(blockToken, blockOps, 'option');
        }

        optionBlocks.push(blockOps);
      } else {
        this.current++;
      }
    }

    // CHOICE opを生成し、各オプションのブロックを配置
    const ops: Op[] = [];
    const choiceOp: Op = { op: 'CHOICE', options: [] };

    // CHOICE opの位置
    const choiceIndex = ops.length;
    ops.push(choiceOp);

    // 各オプションのブロックを配置し、ジャンプ先を計算
    const jumpTargets: number[] = [];
    for (let i = 0; i < optionBlocks.length; i++) {
      const block = optionBlocks[i];

      // このオプションのブロックの開始位置
      jumpTargets.push(ops.length);

      // ブロックの内容を追加
      ops.push(...block);

      // ブロックの最後にジャンプを追加（choice の後の処理にスキップ）
      if (i < optionBlocks.length - 1) {
        // 最後のオプション以外は、choice終了後にジャンプする必要がある
        // ジャンプ先は後で計算
        ops.push({ op: 'JUMP', pc: 0 }); // 仮の値
      }
    }

    // choice終了後の位置
    const afterChoice = ops.length;

    // ジャンプ先を設定（絶対アドレスに変換）
    for (let i = 0; i < options.length; i++) {
      options[i].jump = pcOffset + jumpTargets[i];

      // 各ブロックの最後のJUMPを choice終了後に設定
      if (i < optionBlocks.length - 1) {
        const jumpOpIndex = jumpTargets[i] + optionBlocks[i].length;
        (ops[jumpOpIndex] as any).pc = pcOffset + afterChoice;
      }
    }

    // CHOICE opのoptionsを更新
    (ops[choiceIndex] as any).options = options;

    return ops;
  }

  private parseIf(pcOffset: number): Op[] {
    // IF_START を取得して消費
    const ifToken = this.tokens[this.current];
    if (ifToken.type !== 'IF_START') {
      parseError(`Expected IF_START but got ${ifToken.type}`, ifToken.line, ifToken.raw);
    }
    const condition = ifToken.condition;
    this.current++;

    // then ブロックをパース
    // まず全体の構造を計算：JUMP_IF + else + JUMP + then
    // then ブロックは pcOffset + 1 + elseOps.length + 1 から始まる
    const thenOps: Op[] = [];
    const thenOpsStartToken = this.current;

    while (this.current < this.tokens.length) {
      const token = this.tokens[this.current];

      if (token.type === 'IF_ELSE' || token.type === 'IF_END' || token.type === 'CHOICE_END') {
        break;
      }

      // 一時的に相対アドレスでパース
      this.parseStatement(token, thenOps, 'branch');
    }

    // else ブロックをパース（もしあれば）
    let elseOps: Op[] = [];
    if (this.current < this.tokens.length && this.tokens[this.current].type === 'IF_ELSE') {
      this.current++; // IF_ELSE を消費

      while (this.current < this.tokens.length) {
        const token = this.tokens[this.current];

        if (token.type === 'IF_END' || token.type === 'CHOICE_END') {
          break;
        }

        this.parseStatement(token, elseOps, 'branch');
      }
    }

    // IF_END を消費（lineClassifier は } を CHOICE_END として返すため両方チェック）
    if (this.current < this.tokens.length &&
        (this.tokens[this.current].type === 'IF_END' || this.tokens[this.current].type === 'CHOICE_END')) {
      this.current++;
    }

    // IF を JUMP_IF と JUMP で実装
    const ops: Op[] = [];

    // JUMP_IF: 条件が真なら then ブロックへ、偽なら else ブロックへスキップ
    const jumpIfIndex = ops.length;
    ops.push({ op: 'JUMP_IF', condition, pc: 0 }); // 仮の値

    // else ブロック（条件が偽の場合）
    const elseStartIndex = ops.length;
    ops.push(...elseOps);

    // else の後は then をスキップ
    const jumpAfterElseIndex = ops.length;
    if (elseOps.length > 0) {
      ops.push({ op: 'JUMP', pc: 0 }); // 仮の値
    }

    // then ブロック（条件が真の場合）
    const thenStartIndex = ops.length;
    ops.push(...thenOps);

    // if 終了後の位置
    const afterIfIndex = ops.length;

    // JUMP_IF の pc を then ブロックの開始位置に設定（絶対アドレス）
    (ops[jumpIfIndex] as any).pc = pcOffset + thenStartIndex;

    // else の後の JUMP の pc を if 終了後に設定（絶対アドレス）
    if (elseOps.length > 0) {
      (ops[jumpAfterElseIndex] as any).pc = pcOffset + afterIfIndex;
    }

    // elseOps と thenOps 内の pc/jump を絶対アドレスに変換
    this.adjustPcOffsets(elseOps, pcOffset + elseStartIndex);
    this.adjustPcOffsets(thenOps, pcOffset + thenStartIndex);

    return ops;
  }

  /**
   * @jump のラベル参照を実際の pc に解決する
   */
  private resolveLabelJumps(ops: Op[]): void {
    for (const pending of this.pendingJumps) {
      const targetPc = this.labelPositions.get(pending.label);
      if (targetPc !== undefined) {
        (ops[pending.opIndex] as any).pc = targetPc;
      } else {
        // ラベルが見つからない場合、スクリプト末尾にジャンプ（終了）
        this.onWarning({ message: `Label not found: "${pending.label}", jumping to end` });
        (ops[pending.opIndex] as any).pc = ops.length;
      }
    }
  }

  /**
   * ops 配列内のすべての JUMP/JUMP_IF/CHOICE の pc/jump に offset を加算
   */
  private adjustPcOffsets(ops: Op[], offset: number): void {
    for (const op of ops) {
      if (op.op === 'JUMP' || op.op === 'CALL') {
        // ラベル待ちの印が付いたジャンプ/コールは pendingJumps で後から解決するため、
        // ここでオフセットを足してはいけない (足すと意味不明な pc になる)。
        if (!pendingLabelOf(op)) {
          op.pc += offset;
        }
      } else if (op.op === 'JUMP_IF') {
        op.pc += offset;
      } else if (op.op === 'CHOICE') {
        for (const option of op.options) {
          option.jump += offset;
        }
      }
    }
  }
}

/**
 * VAR_SET（`=`）の右辺リテラルを解釈する（P6-4: 文字列/bool 対応）。
 * - `"..."` / `'...'` → string（クォート除去）
 * - `true` / `false` → boolean
 * - 数値として読めるもの → number（従来どおり parseFloat）
 * - それ以外 → undefined（呼び出し側でエラー）
 */
function parseVarSetLiteral(raw: string): number | string | boolean | undefined {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  const num = parseFloat(v);
  if (!isNaN(num)) return num;
  return undefined;
}
