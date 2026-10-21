/**
 * 変換結果のランク付け（A〜D）。
 */
import type { TyranoRank } from './types.js';

export function rankConversion(
  unsupportedCount: number,
  warningCount: number,
  unsupportedCommandCounts: Record<string, number>,
): TyranoRank {
  const dangerousCount =
    (unsupportedCommandCounts.eval ?? 0) +
    (unsupportedCommandCounts.iscript ?? 0) +
    (unsupportedCommandCounts.macro ?? 0);
  if (dangerousCount >= 5 || unsupportedCount >= 20) return 'D';
  if (dangerousCount > 0 || unsupportedCount >= 5) return 'C';
  if (unsupportedCount > 0 || warningCount > 0) return 'B';
  return 'A';
}
