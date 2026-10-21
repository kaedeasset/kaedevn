/**
 * 予約された stdlib の関数名（純粋な数学）の唯一の定義。
 * checker は素のグローバルとして登録し、emitter は HOST_CALL に下ろし、
 * VM は host へ渡さず自分で計算する（C++ VM の tryStdlib と同じ集合）。
 */
export const STDLIB_NAMES: readonly string[] = [
  'floor', 'ceil', 'round', 'trunc', 'abs', 'sign', 'sqrt', 'min', 'max', 'clamp',
];
