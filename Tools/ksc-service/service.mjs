// The aliases resolve to the compiler sources in Tools/kaedevn-compiler at bundle time. No parser fork.
import { tokenize, parse, emitIR } from '@kaedevn/ksc-compiler';
import { parseKsCommandLine } from 'kaede-ks-command';
import { COMMAND_PARSERS } from 'kaede-command-registry';
import { createInterface } from 'node:readline';

const revision = typeof KSC_COMPILER_REVISION === 'undefined' ? 'development' : KSC_COMPILER_REVISION;
const protocol = 'ksc-compile/1';
const cache = new Map();
let cacheBytes = 0;
const allowed = new Set([
  'TEXT_APPEND', 'BG_SET', 'BG_CLEAR', 'BGM_PLAY', 'BGM_STOP', 'SE_PLAY', 'SE_STOP',
  'WAIT_MS', 'WAIT_CLICK', 'UI_SHOW', 'UI_HIDE',
  'SPRITE_SET', 'SPRITE_MOVE', 'SPRITE_HIDE', 'SPRITE_CLEAR', 'TEXT_SPRITE_SET',
  'CAMERA_SET', 'WAIT_CAMERA', 'LAYER_SET', 'TRANSITION', 'WAIT_TRANSITION',
  'MASK_SET', 'MASK_CLEAR', 'OVERLAY_SET', 'OVERLAY_HIDE',
  'SHAKE', 'FLASH', 'FADE_BLACK', 'FADE_WHITE', 'BLACK_IN', 'WHITE_IN',
]);
COMMAND_PARSERS.say = (_args, _line, raw) => {
  const source = raw.replace(/^@say\s+/, '');
  const value = JSON.parse(source);
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'text,who' ||
      typeof value.who !== 'string' || typeof value.text !== 'string' ||
      Buffer.byteLength(value.text) > 65536 || value.text.includes('\0') || value.who.includes('\0')) {
    throw new Error('@say requires {who:string,text:string}, text <= 64 KiB, no NUL');
  }
  // JSON.parse keeps the last duplicate key. Count keys lexically outside strings/values.
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}:,]/g) ?? [];
  const keys = tokens.filter((token, i) => token.startsWith('"') && tokens[i + 1] === ':').map(token => JSON.parse(token));
  if (keys.length !== 2 || new Set(keys).size !== 2) throw new Error('duplicate/invalid @say keys');
  return { op: 'TEXT_APPEND', who: value.who, text: value.text };
};

function compile(request) {
  if (request.protocol !== protocol || request.profile !== 'adv-presentation/1' ||
      typeof request.source !== 'string' || typeof request.requestId !== 'string') throw new Error('invalid protocol/request');
  if (Buffer.byteLength(request.source) > 262144 || request.source.includes('\0')) throw new Error('source limit/NUL');
  const cached = cache.get(request.source);
  if (cached) { cache.delete(request.source); cache.set(request.source, cached); return { ...cached.response, requestId: request.requestId }; }
  const ast = parse(tokenize(request.source));
  if (ast.body.length > 1024 || ast.body.some(s => s.kind !== 'AtCommandStmt')) throw new Error('only display @ commands are allowed');
  const commands = [];
  const ir = emitIR(ast, undefined, { atCommandParser(raw, line) {
    const op = parseKsCommandLine(raw, line);
    if (!allowed.has(op.op)) throw new Error(`unsupported display op: ${op.op}`);
    for (const [key, value] of Object.entries(op)) {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`invalid number: ${key}`);
    }
    for (const key of ['time', 'durationMs']) if (op[key] !== undefined &&
      (!Number.isInteger(op[key]) || op[key] < 0 || op[key] > 60000)) throw new Error(`${key} must be 0..60000 ms`);
    for (const key of ['zoom', 'scale', 's']) if (op[key] !== undefined &&
      (op[key] <= 0 || op[key] > 100)) throw new Error(`${key} must be >0 and <=100`);
    if (op.op === 'UI_SHOW' && (op.screenId !== 'adv-input' || op.wait !== true)) throw new Error('use @ui_show adv-input wait=true');
    if (op.op === 'WAIT_MS' && (!Number.isInteger(op.ms) || op.ms < 0 || op.ms > 60000)) throw new Error('wait must be 0..60000 ms');
    if (op.fadeMs !== undefined && (!Number.isInteger(op.fadeMs) || op.fadeMs < 0 || op.fadeMs > 10000)) throw new Error('fade must be 0..10000 ms');
    for (const key of ['id', 'screenId', 'storage']) if (op[key] !== undefined &&
      (!/^[A-Za-z0-9_./-]+$/.test(op[key]) || op[key].startsWith('/') || op[key].split('/').includes('..'))) throw new Error('invalid asset/screen id');
    commands.push({ line, op });
    return op;
  }});
  if (commands.some((c, i) => c.op.op === 'UI_SHOW' && i !== commands.length - 1)) throw new Error('input must be last');
  const response = { protocol, requestId: request.requestId, ok: true, compilerRevision: revision, ir, commands };
  const size = Buffer.byteLength(JSON.stringify(response)) + Buffer.byteLength(request.source);
  while (cacheBytes + size > 32 * 1024 * 1024 && cache.size) {
    const first = cache.keys().next().value; cacheBytes -= cache.get(first).size; cache.delete(first);
  }
  cache.set(request.source, { response, size }); cacheBytes += size;
  return response;
}

process.stdout.write(JSON.stringify({ protocol, ready: true, compilerRevision: revision }) + '\n');
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  let request;
  try {
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) throw new Error('request too large');
    request = JSON.parse(line);
    const response = JSON.stringify(compile(request));
    if (Buffer.byteLength(response) > 4 * 1024 * 1024) throw new Error('response too large');
    process.stdout.write(response + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ protocol, requestId: request?.requestId ?? '', ok: false,
      diagnostics: [{ message: error.message, line: error.line ?? 0 }] }) + '\n');
  }
});
