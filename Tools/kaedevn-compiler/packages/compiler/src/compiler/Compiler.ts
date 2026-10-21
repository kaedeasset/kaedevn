import type { Op, CompiledScenario } from '@kaedevn/core';
import type { CompilerOptions } from '../types/CompilerOptions.js';
import { Tokenizer } from '../tokenizer/Tokenizer.js';
import { Parser } from '../parser/Parser.js';
import { Transformer } from '../transformer/Transformer.js';
import { Finalizer } from '../finalizer/Finalizer.js';
import { Validator } from '../validator/Validator.js';

export class Compiler {
  private tokenizer: Tokenizer;
  private transformer: Transformer;
  private finalizer: Finalizer;
  private validator: Validator;

  constructor() {
    this.tokenizer = new Tokenizer();
    this.transformer = new Transformer();
    this.finalizer = new Finalizer();
    this.validator = new Validator();
  }

  public compile(source: string, options: CompilerOptions = {}): CompiledScenario {
    const scenarioId = options.scenarioId || 'scenario';
    const validate = options.validate !== false; // デフォルト有効

    // Tokenize
    const tokens = this.tokenizer.tokenize(source);

    // Parse
    const parser = new Parser(options.onWarning);
    let ops = parser.parse(tokens);

    // Transform (埋め込み分解)
    ops = this.transformer.transform(ops);

    // Finalize (末尾@p)
    ops = this.finalizer.finalize(ops);

    // Validate (ID形式チェック等)
    if (validate) {
      this.validator.validate(ops);
    }

    return {
      id: scenarioId,
      ops,
      labels: parser.getLabelPositions(),
    };
  }
}
