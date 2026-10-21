import type { Op } from '@kaedevn/core';
import { CompilationException, type CompilerError } from '../types/CompilerError.js';

/**
 * Op命令列のバリデーション
 *
 * - ID形式チェック（bgId, characterName, pose, audioId）
 * - 空文字列チェック
 * - 不正な文字チェック（スペース、改行など）
 */
export class Validator {
  /**
   * Op命令列をバリデート
   *
   * @throws {CompilationException} バリデーションエラーがある場合
   */
  public validate(ops: Op[]): void {
    const errors: CompilerError[] = [];

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const position = `op[${i}]`;

      switch (op.op) {
        case 'BG_SET':
          this.validateId(op.id, 'background ID', position, errors);
          this.validateFadeMs(op.fadeMs, position, errors);
          break;

        case 'CH_SET':
          this.validateId(op.name, 'character name', position, errors);
          this.validateId(op.pose, 'pose ID', position, errors);
          this.validateFadeMs(op.fadeMs, position, errors);
          break;

        case 'CH_HIDE':
          this.validateId(op.name, 'character name', position, errors);
          this.validateFadeMs(op.fadeMs, position, errors);
          break;

        case 'CH_CLEAR':
          this.validateFadeMs(op.fadeMs, position, errors);
          break;

        case 'BGM_PLAY':
          this.validateId(op.id, 'BGM ID', position, errors);
          this.validateVolume(op.vol, position, errors);
          this.validateFadeMs(op.fadeMs, position, errors);
          break;

        case 'BGM_STOP':
          this.validateFadeMs(op.fadeMs, position, errors);
          break;

        case 'SE_PLAY':
          this.validateId(op.id, 'SE ID', position, errors);
          this.validateVolume(op.vol, position, errors);
          break;

        case 'VOICE_PLAY':
          this.validateId(op.id, 'voice ID', position, errors);
          break;

        case 'TEXT_APPEND':
          if (op.text === '') {
            errors.push({
              code: 'INVALID_VALUE',
              message: `Empty text in TEXT_APPEND`,
              line: 0,
              source: position,
            });
          }
          if (op.who !== undefined) {
            this.validateCharacterName(op.who, position, errors);
          }
          break;

        case 'WAIT_MS':
          if (op.ms < 0) {
            errors.push({
              code: 'INVALID_VALUE',
              message: `Negative wait time: ${op.ms}ms`,
              line: 0,
              source: position,
            });
          }
          break;

        // その他のOpは追加のバリデーション不要
        case 'TEXT_NL':
        case 'WAIT_CLICK':
        case 'PAGE':
        case 'WAIT_VOICE_END':
          break;
      }
    }

    if (errors.length > 0) {
      throw new CompilationException(errors);
    }
  }

  /**
   * IDの形式をバリデート
   *
   * - 空文字列禁止
   * - 先頭/末尾のスペース禁止
   * - 改行文字禁止
   * - 推奨: 小文字英数字、アンダースコア、ハイフンのみ（警告）
   */
  private validateId(
    id: string,
    fieldName: string,
    position: string,
    errors: CompilerError[]
  ): void {
    // 空文字列チェック
    if (id === '') {
      errors.push({
        code: 'INVALID_VALUE',
        message: `Empty ${fieldName}`,
        line: 0,
        source: position,
      });
      return;
    }

    // 先頭/末尾のスペースチェック
    if (id !== id.trim()) {
      errors.push({
        code: 'INVALID_VALUE',
        message: `${fieldName} has leading/trailing whitespace: "${id}"`,
        line: 0,
        source: position,
      });
    }

    // 改行文字チェック
    if (/[\r\n]/.test(id)) {
      errors.push({
        code: 'INVALID_VALUE',
        message: `${fieldName} contains newline characters: "${id}"`,
        line: 0,
        source: position,
      });
    }

    // 推奨形式チェック（警告レベル）
    // 小文字英数字、アンダースコア、ハイフンのみを推奨
    if (!/^[a-z0-9_-]+$/.test(id)) {
      // 警告は今後実装する場合に備えて、エラーには含めない
      // console.warn(`${fieldName} uses non-standard characters: "${id}" (位置: ${position})`);
    }
  }

  /**
   * キャラクター名のバリデート（TEXT_APPENDのwho）
   *
   * - 空文字列禁止
   * - 先頭/末尾のスペース禁止
   * - 改行文字禁止
   */
  private validateCharacterName(
    who: string,
    position: string,
    errors: CompilerError[]
  ): void {
    if (who === '') {
      errors.push({
        code: 'INVALID_VALUE',
        message: `Empty character name in TEXT_APPEND`,
        line: 0,
        source: position,
      });
      return;
    }

    if (who !== who.trim()) {
      errors.push({
        code: 'INVALID_VALUE',
        message: `Character name has leading/trailing whitespace: "${who}"`,
        line: 0,
        source: position,
      });
    }

    if (/[\r\n]/.test(who)) {
      errors.push({
        code: 'INVALID_VALUE',
        message: `Character name contains newline characters: "${who}"`,
        line: 0,
        source: position,
      });
    }
  }

  /**
   * フェード時間のバリデート
   */
  private validateFadeMs(
    fadeMs: number | undefined,
    position: string,
    errors: CompilerError[]
  ): void {
    if (fadeMs !== undefined && fadeMs < 0) {
      errors.push({
        code: 'INVALID_VALUE',
        message: `Negative fade time: ${fadeMs}ms`,
        line: 0,
        source: position,
      });
    }
  }

  /**
   * ボリュームのバリデート（0-100）
   */
  private validateVolume(
    vol: number | undefined,
    position: string,
    errors: CompilerError[]
  ): void {
    if (vol !== undefined && (vol < 0 || vol > 100)) {
      errors.push({
        code: 'INVALID_VALUE',
        message: `Volume out of range (0-100): ${vol}`,
        line: 0,
        source: position,
      });
    }
  }
}
