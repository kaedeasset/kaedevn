import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url));
const executable = path.resolve(here, '../../Plugins/KaedeVN/ThirdParty/Win64/kaedevn-ksc-service.exe');

test('real bundled compiler: existing @ commands, Japanese literals, errors, persistent IPC', async () => {
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const read = async () => JSON.parse((await iterator.next()).value);
  const send = async source => {
    child.stdin.write(JSON.stringify({ protocol: 'ksc-compile/1', profile: 'adv-presentation/1', requestId: 'test', source }) + '\n');
    return read();
  };
  try {
    assert.equal((await read()).ready, true);
    const text = '日本語  二つの空白 "引用" \\ 改行\n@se not_a_command 😀';
    const result = await send('@bg harbor fade=320\n@bgm calm\n@se bell\n@say ' + JSON.stringify({ who: '佐伯', text }) + '\n@wait 10\n@ui_show adv-input wait=true\n');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.commands.map(c => c.op.op), ['BG_SET', 'BGM_PLAY', 'SE_PLAY', 'TEXT_APPEND', 'WAIT_MS', 'UI_SHOW']);
    assert.equal(result.commands[3].op.text, text);
    assert.equal(result.commands[0].op.fadeMs, 320);
    assert.equal(result.commands[4].op.ms, 10000); // existing @wait takes seconds
    assert.equal(result.ir.functions[0].instructions.filter(i => i.op === 'AWAIT').length, 6);
    for (const source of ['@bg ok\n@bad nope', '@wait -1', '@jump next', 'let x = 1;', '@ui_show adv-input\n', '@ui_show adv-input wait=true\n@se bell', '@say {"who":"a","text":"b","text":"c"}']) {
      assert.equal((await send(source)).ok, false, source);
    }
    assert.equal((await send('@se bell\n@se bell\n')).commands.length, 2);
    const movie = await send([
      '@bg bg_adv_port fade=500',
      '@sprite view bg/bg_adv_port.png x=0 y=0',
      '@sprite_move view x=-100 y=-40 scale=1.1 opacity=0.8 time=12000',
      '@camera zoom=1.1 x=30 time=12000', '@wait_camera',
      '@text lyric "まだ行ける" x=600 y=900 size=40',
      '@layer name=overlay opacity=0.8', '@transition target=overlay time=200', '@wait_transition target=overlay',
      '@mask color=#000000 opacity=0.5 time=200', '@mask_clear time=200',
      '@overlay bg_adv_banya fade=200', '@overlay_hide bg_adv_banya fade=200',
      '@sprite_hide lyric fade=200', '@sprite_clear fade=200',
      '@fade_black 200', '@black_in 200', '@fade_white 200', '@white_in 200', '@flash 200', '@shake 2 200',
      '@bgm winter vol=0.5 fade=200', '@bgm_stop fade=200', '@se bell vol=0.3', '@se_stop',
    ].join('\n') + '\n');
    assert.equal(movie.ok, true, JSON.stringify(movie));
    assert.equal(movie.commands[2].op.durationMs, 12000);
    assert.equal(movie.commands[4].op.op, 'WAIT_CAMERA');
    assert.equal(movie.commands.at(-1).op.op, 'SE_STOP');
    for (const source of ['@camera zoom=Infinity', '@camera time=-1', '@sprite x ../outside.png', '@sprite_move x scale=0']) {
      assert.equal((await send(source + '\n')).ok, false, source);
    }
    const demo = await send(readFileSync(path.resolve(here, '../../Game/adv/presentation/movie-demo.ksc'), 'utf8'));
    assert.equal(demo.ok, true, JSON.stringify(demo));
    child.stdin.end();
    assert.equal((await once(child, 'exit'))[0], 0);
  } finally { child.kill(); lines.close(); }
});
