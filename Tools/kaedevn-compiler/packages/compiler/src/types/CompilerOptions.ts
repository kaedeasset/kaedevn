/** 止めずに読み進めた箇所の知らせ。line は分かるときだけ。 */
export interface CompilerWarning {
  message: string;
  line?: number;
}

export interface CompilerOptions {
  scenarioId?: string;
  validate?: boolean;
  verbose?: boolean;
  /** 止めるほどでない誤り（未対応の選択肢の条件・見つからないラベル）を受け取る。省略すると捨てる。 */
  onWarning?: (warning: CompilerWarning) => void;
}
