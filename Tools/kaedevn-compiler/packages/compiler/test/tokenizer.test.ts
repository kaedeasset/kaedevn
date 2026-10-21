import { describe, it, expect } from 'vitest';
import { Tokenizer } from '../src/tokenizer/Tokenizer.js';

describe('Tokenizer', () => {
  const tokenizer = new Tokenizer();

  it('should tokenize command', () => {
    const tokens = tokenizer.tokenize('@bg room_day');

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: 'COMMAND',
      command: 'bg',
      args: ['room_day'],
    });
  });

  it('should tokenize command with multiple args', () => {
    const tokens = tokenizer.tokenize('@ch hero smile center fade 300');

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: 'COMMAND',
      command: 'ch',
      args: ['hero', 'smile', 'center', 'fade', '300'],
    });
  });

  it('should tokenize text', () => {
    const tokens = tokenizer.tokenize('今日は良い天気。');

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: 'TEXT',
      text: '今日は良い天気。',
    });
  });

  it('should skip comments', () => {
    const tokens = tokenizer.tokenize('// This is a comment');

    expect(tokens).toHaveLength(0);
  });

  it('should handle multiple lines', () => {
    const source = `
@bg room_day
今日は良い天気。
// comment
主人公：……帰るか。
    `.trim();

    const tokens = tokenizer.tokenize(source);

    expect(tokens).toHaveLength(3);
    expect(tokens[0].type).toBe('COMMAND');
    expect(tokens[1].type).toBe('TEXT');
    expect(tokens[2].type).toBe('TEXT');
  });

  it('should skip empty lines', () => {
    const source = `
@bg room_day

今日は良い天気。
    `.trim();

    const tokens = tokenizer.tokenize(source);

    expect(tokens).toHaveLength(2);
  });

  it('should tokenize speaker line (#xxx)', () => {
    const tokens = tokenizer.tokenize('#赤音');

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: 'SPEAKER',
      name: '赤音',
    });
  });

  it('should tokenize speaker + text sequence', () => {
    const source = '#赤音\n久しぶり\n@l';
    const tokens = tokenizer.tokenize(source);

    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({ type: 'SPEAKER', name: '赤音' });
    expect(tokens[1]).toMatchObject({ type: 'TEXT', text: '久しぶり' });
    expect(tokens[2]).toMatchObject({ type: 'COMMAND', command: 'l' });
  });
});
