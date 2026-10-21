import { describe, it, expect } from 'vitest';
import { compile, filesToKs, KsParser, CompilationException } from '../src/index.js';
import { Tokenizer } from '../src/tokenizer/Tokenizer.js';

/** 投げられた CompilationException の先頭の誤りを返す。投げなければ失敗。 */
function firstError(run: () => unknown) {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(CompilationException);
    return (e as CompilationException).errors[0];
  }
  throw new Error('CompilationException が投げられなかった');
}

describe('字句・構文の誤りは PARSE_ERROR', () => {
  it('選択肢の書式の誤りは行番号と元の行つき', () => {
    // 行の分類と同じ正規表現で守られているため、字句解析の口を直接呼ぶ
    const err = firstError(() => (new Tokenizer() as any).parseChoiceOption('"はい" oops', 2));
    expect(err.code).toBe('PARSE_ERROR');
    expect(err.line).toBe(2);
    expect(err.source).toBe('"はい" oops');
  });

  it('変数へ数でない値を足す', () => {
    const err = firstError(() => compile('x += abc'));
    expect(err.code).toBe('PARSE_ERROR');
    expect(err.line).toBe(1);
  });

  it('KsParser の @endif の対応の誤り', () => {
    expect(firstError(() => new KsParser().parse('@endif')).code).toBe('PARSE_ERROR');
  });
});

describe('数の引数は NaN を Op へ入れない', () => {
  it('@item_add の数でない amount は INVALID_ARGS', () => {
    const err = firstError(() => compile('@item_add potion many'));
    expect(err.code).toBe('INVALID_ARGS');
    expect(err.line).toBe(1);
  });

  it('@camera の数でない値は INVALID_ARGS', () => {
    expect(firstError(() => compile('@camera zoom=big')).code).toBe('INVALID_ARGS');
  });

  it('数のときは今までどおりの Op', () => {
    const { ops } = compile('@item_add potion 3');
    expect(ops).toContainEqual({ op: 'ITEM_ADD', id: 'potion', amount: 3 });
  });

  it('引数が足りないときは INVALID_ARGS', () => {
    expect(firstError(() => compile('@player_move up')).code).toBe('INVALID_ARGS');
  });
});

describe('filesToKs の診断は kind で区別する', () => {
  it('fall_through・unresolved_jump・dynamic_target', () => {
    const { issues } = filesToKs(
      [
        { name: 'a.ks', content: '本文\n@jump missing.ks' },
        { name: 'b.ks', content: '@jump &f.next' },
        { name: 'c.ks', content: '終わり' },
      ],
      'a.ks',
    );
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain('unresolved_jump');
    expect(kinds).toContain('dynamic_target');
    expect(issues.find((i) => i.kind === 'fall_through')?.file).toBe('c.ks');
  });

  it('entry が無いと missing_entry', () => {
    const { issues } = filesToKs([{ name: 'a.ks', content: '@return' }], 'zz.ks');
    expect(issues[0].kind).toBe('missing_entry');
  });
});
