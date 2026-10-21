import { describe, it, expect } from 'vitest';
import { classifyLine } from '../src/tokenizer/lineClassifier.js';
import { KNOWN_COMMAND_NAMES, STANDALONE_COMMAND_NAMES } from '../src/registry/commandRegistry.js';

describe('classifyLine', () => {
  describe('all KNOWN_COMMANDS → COMMAND', () => {
    // 引数が必要なコマンドにはダミー引数を付与
    const needsArgs = new Set([
      'bg', 'ch', 'ch_anim', 'ch_hide', 'bgm', 'se', 'voice',
      'wait', 'battle', 'timeline_play', 'filter', 'screenFilter',
      'filter_mix', 'overlay',
    ]);

    for (const cmd of KNOWN_COMMAND_NAMES) {
      const line = needsArgs.has(cmd) ? `@${cmd} dummy` : `@${cmd}`;
      it(`@${cmd} → COMMAND`, () => {
        expect(classifyLine(line)).toBe('COMMAND');
      });
    }
  });

  describe('all STANDALONE_COMMANDS → COMMAND', () => {
    for (const cmd of STANDALONE_COMMAND_NAMES) {
      it(`@${cmd} → COMMAND`, () => {
        expect(classifyLine(`@${cmd}`)).toBe('COMMAND');
      });
    }
  });

  describe('unknown commands → COMMAND (parseCommand will error)', () => {
    it('@camera → COMMAND', () => {
      expect(classifyLine('@camera zoom')).toBe('COMMAND');
    });

    it('@unknown_cmd → COMMAND', () => {
      expect(classifyLine('@unknown_cmd')).toBe('COMMAND');
    });

    it('@xyz → COMMAND', () => {
      expect(classifyLine('@xyz')).toBe('COMMAND');
    });
  });

  describe('edge cases', () => {
    it('@l alone → COMMAND', () => {
      expect(classifyLine('@l')).toBe('COMMAND');
    });

    it('@p alone → COMMAND', () => {
      expect(classifyLine('@p')).toBe('COMMAND');
    });

    it('@r alone → COMMAND', () => {
      expect(classifyLine('@r')).toBe('COMMAND');
    });

    it('@l@p (no space) → TEXT', () => {
      // @l@p は @l と @p が連結しており、 @(\w+)(?:\s|$) にマッチしない
      expect(classifyLine('@l@p')).toBe('TEXT');
    });

    it('comment // → COMMENT', () => {
      expect(classifyLine('// comment')).toBe('COMMENT');
    });

    it('comment ; → COMMENT', () => {
      expect(classifyLine('; comment')).toBe('COMMENT');
    });

    it('label *start → LABEL', () => {
      expect(classifyLine('*start')).toBe('LABEL');
    });

    it('plain text → TEXT', () => {
      expect(classifyLine('Hello world')).toBe('TEXT');
    });

    it('named text → TEXT', () => {
      expect(classifyLine('主人公：セリフ')).toBe('TEXT');
    });

    it('variable assignment → VAR_SET', () => {
      expect(classifyLine('gold = 100')).toBe('VAR_SET');
    });

    it('choice { → CHOICE_START', () => {
      expect(classifyLine('choice {')).toBe('CHOICE_START');
    });

    it('choice option → CHOICE_OPTION', () => {
      expect(classifyLine('"option A" {')).toBe('CHOICE_OPTION');
    });

    it('} → CHOICE_END', () => {
      expect(classifyLine('}')).toBe('CHOICE_END');
    });

    it('if statement → IF_START', () => {
      expect(classifyLine('if (gold > 0) {')).toBe('IF_START');
    });

    it('} else { → IF_ELSE', () => {
      expect(classifyLine('} else {')).toBe('IF_ELSE');
    });

    it('command with leading spaces → COMMAND', () => {
      expect(classifyLine('  @bg room_day')).toBe('COMMAND');
    });

    it('command with no args → COMMAND', () => {
      expect(classifyLine('@ch_clear')).toBe('COMMAND');
    });

    it('@ alone (no command name) → TEXT', () => {
      expect(classifyLine('@')).toBe('TEXT');
    });

    it('@123 (starts with digit) → COMMAND', () => {
      // \w+ matches digits too — parseCommand will reject as UNKNOWN_COMMAND
      expect(classifyLine('@123')).toBe('COMMAND');
    });

    it('variable += → VAR_SET', () => {
      expect(classifyLine('score += 10')).toBe('VAR_SET');
    });

    it('variable -= → VAR_SET', () => {
      expect(classifyLine('hp -= 5')).toBe('VAR_SET');
    });

    it('choice option with condition → CHOICE_OPTION', () => {
      expect(classifyLine('"魔法を使う" if (mp > 10) {')).toBe('CHOICE_OPTION');
    });

    it('empty string → TEXT', () => {
      // trim() results in empty string, doesn't match any pattern
      expect(classifyLine('')).toBe('TEXT');
    });

    it('whitespace only → TEXT', () => {
      expect(classifyLine('   ')).toBe('TEXT');
    });
  });
});
