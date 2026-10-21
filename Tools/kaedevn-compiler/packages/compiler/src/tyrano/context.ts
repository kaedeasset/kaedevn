/**
 * 変換状態（ConvertContext）への記録と、選択肢バッファの書き出し。
 */
import { normalizeTarget, type TyranoTagNode, type TyranoBlockNode } from '../tyranoParser.js';
import type { ConvertContext, TyranoIssueSeverity } from './types.js';

export function ctxMarkSupported(ctx: ConvertContext, command: string): void {
  ctx.supportedCount++;
  ctx.supportedCommandCounts[command] = (ctx.supportedCommandCounts[command] ?? 0) + 1;
}

export function ctxMarkCommand(ctx: ConvertContext, command: string): void {
  ctx.commandCounts[command] = (ctx.commandCounts[command] ?? 0) + 1;
}

export function ctxAddIssue(
  ctx: ConvertContext,
  node: TyranoTagNode | TyranoBlockNode,
  severity: TyranoIssueSeverity,
  message: string,
): void {
  ctx.issues.push({ severity, command: node.name, line: node.loc.line, source: node.loc.source, message });
  if (severity === 'unsupported') {
    ctx.unsupportedCommandCounts[node.name] = (ctx.unsupportedCommandCounts[node.name] ?? 0) + 1;
  }
}

export function ctxFlushChoices(ctx: ConvertContext): void {
  if (ctx.choiceBuffer.length === 0) return;
  ctx.lines.push('choice {');
  for (const item of ctx.choiceBuffer) {
    ctx.lines.push(`  "${escapeChoiceLabel(item.label)}" {`);
    const dest = item.file
      ? `${item.file}${item.target ? ` ${normalizeTarget(item.target)}` : ''}`
      : normalizeTarget(item.target);
    ctx.lines.push(`    @jump ${dest}`);
    ctx.lines.push('  }');
  }
  ctx.lines.push('}');
  ctx.choiceBuffer = [];
}

function escapeChoiceLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
