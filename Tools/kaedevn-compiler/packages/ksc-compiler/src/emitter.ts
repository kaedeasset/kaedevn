/** KSC IR Emitter — AST → IRModule
 *
 * 2パスアルゴリズム:
 *   Pass 1: トップレベルの関数宣言を先行登録（前方参照対応、関数インデックス確定）
 *   Pass 2: main エントリーポイント + 全関数本体を命令列に変換
 */

import type {
  Program, Statement, Expression,
  FunctionDecl, BlockStmt,
} from './types/ast.js';
import {
  OpCode,
  type Instruction, type IRFunction, type IRModule, type SwitchCaseTable,
} from './types/ir.js';
import { STDLIB_NAMES } from './stdlib.js';

export class EmitError extends Error {
  constructor(
    message: string,
    public line: number,
    public column: number,
  ) {
    super(`[L${line}:${column}] ${message}`);
    this.name = 'EmitError';
  }
}

// ---- Breakable scope for break/continue ----
interface BreakableScope {
  kind: 'loop' | 'switch';
  breakPatches: number[];     // instruction indices to backpatch with break target
  continuePatches: number[];  // instruction indices to backpatch with continue target (loop only)
  continueTarget: number;     // resolved continue target (-1 = not yet known, for-loop)
}

// ---- Host call whitelist (Phase 1 Day 19) ----
// Identifiers that are emitted as HOST_CALL when invoked bare (without an
// `engine.` prefix). Kept in sync with the top-level billing names
// registered in checker.ts / builtins.ts.
const TOP_LEVEL_HOST_CALLS = new Set<string>([
  'platform',
  'isEntitled',
  'owned',
  'purchase',
  'restore',
  // ECS / Entity (Phase 1 #2) — bridged by EntityHostBinding (native) /
  // future WebEntityStub (web preview). Top-level for ergonomic chaining.
  'spawn',
  'destroy',
  'isAlive',
  'setPos',
  'getPos',
  'setSprite',
  'setLayer',
  'entityCount',
  // 2D Camera (Phase 1 #3) — bridged by CameraHostBinding (native).
  'setCamera',
  'getCamera',
  'cameraFollow',
  'cameraTarget',
  // Tween (Phase 1 #4) — bridged by TweenHostBinding (native).
  'tweenTo',
  'tweenStop',
  'tweenActive',
  'tweenCount',
  // Collision (Phase 1 #5) — bridged by CollisionHostBinding (native).
  'setCollider',
  'removeCollider',
  'hasCollider',
  'overlap',
  'aabbQuery',
  // Input (Phase 2 #1) — bridged by InputHostBinding (native).
  'pressed',
  'justPressed',
  'justReleased',
  'axis',
  'pointer',
  // Frame loops (Phase 2 #3) — `await wait(16)` is too common to require
  // the `engine.` prefix. Already async-typed in builtins.ts.
  'wait',
  // stdlib pure math (2026-06-13) — bare floor()/min()/etc compile to
  // HOST_CALL and are intercepted in-VM (both TS and C++) so they never reach
  // the host. The names come from STDLIB_NAMES in stdlib.ts.
  ...STDLIB_NAMES,
]);

// ---- Emitter ----

/**
 * emitIR のオプション（P6-9）。
 * atCommandParser: 行頭 `@word …` を Op オブジェクトへ変換する関数。
 * ksc-compiler は依存ゼロを維持するため KS の commandRegistry を直接 import せず、
 * 呼び出し側が @kaedevn/compiler の parseKsCommandLine を注入する。
 */
export interface EmitOptions {
  atCommandParser?: (rawLine: string, line: number) => unknown;
}

class Emitter {
  private constants: unknown[] = [];
  private constantMap = new Map<string, number>(); // dedup key → index
  private functions: IRFunction[] = [];
  private switchTables: SwitchCaseTable[] = [];
  private sourceMap: Array<[number, number]> = [];

  // Function being built
  private currentInstructions: Instruction[] = [];
  private currentLocals = new Map<string, number>(); // var name → const pool index (for LOAD_VAR/STORE_VAR)
  private currentFuncName = '';

  // label / jump（現在の命令ストリーム内で解決する）
  private labelOffsets = new Map<string, number>();      // ラベル名 → 命令オフセット
  private pendingJumps: Array<{ index: number; label: string; line: number }> = []; // 前方参照の backpatch

  // Unified breakable scope stack (loops and switches, in nesting order)
  private breakableStack: BreakableScope[] = [];

  // Function name → function index mapping (for Pass 1)
  private functionIndexMap = new Map<string, number>();

  // Source file name (optional)
  private sourceFile?: string;

  // P6-9: @ 行 → Op 変換（注入。未注入で @ 行があれば EmitError）
  private atCommandParser?: (rawLine: string, line: number) => unknown;

  emit(program: Program, sourceFile?: string, options?: EmitOptions): IRModule {
    this.sourceFile = sourceFile;
    this.atCommandParser = options?.atCommandParser;

    // Pass 1: Register top-level function declarations
    for (const stmt of program.body) {
      if (stmt.kind === 'FunctionDecl') {
        this.registerFunction(stmt);
      } else if (stmt.kind === 'ExportDecl' && stmt.declaration.kind === 'FunctionDecl') {
        this.registerFunction(stmt.declaration);
      }
    }

    // Reserve slot for main entry point
    const mainIndex = this.functions.length;
    this.functions.push({
      name: '$main',
      paramCount: 0,
      paramNames: [],
      localCount: 0,
      instructions: [],
      sourceFile,
    });

    // Pass 2: Emit function bodies
    for (const stmt of program.body) {
      if (stmt.kind === 'FunctionDecl') {
        this.emitFunctionBody(stmt);
      } else if (stmt.kind === 'ExportDecl' && stmt.declaration.kind === 'FunctionDecl') {
        this.emitFunctionBody(stmt.declaration);
      }
    }

    // Pass 2: Emit main body (non-function top-level statements)
    this.currentInstructions = [];
    this.currentLocals = new Map();
    this.currentFuncName = '$main';

    for (const stmt of program.body) {
      if (stmt.kind === 'FunctionDecl') continue;
      if (stmt.kind === 'ExportDecl' && stmt.declaration.kind === 'FunctionDecl') continue;
      this.emitStatement(stmt);
    }

    // ラベル/ジャンプの解決（main ストリーム）
    this.resolveLabels();

    // Implicit RET at end of main
    this.emit1(OpCode.LOAD_CONST, this.addConstant(null));
    this.emit0(OpCode.RET);

    this.functions[mainIndex].instructions = this.currentInstructions;
    this.functions[mainIndex].localCount = this.currentLocals.size;

    return {
      constants: this.constants,
      functions: this.functions,
      entryPoint: mainIndex,
      switchTables: this.switchTables,
      sourceMap: this.sourceMap,
    };
  }

  // ---- Pass 1: Function Registration ----

  private registerFunction(decl: FunctionDecl): void {
    const index = this.functions.length;
    this.functionIndexMap.set(decl.name, index);
    this.functions.push({
      name: decl.name,
      paramCount: decl.params.length,
      paramNames: decl.params.map(p => p.name),
      localCount: 0,
      instructions: [],
      sourceFile: this.sourceFile,
    });
  }

  // ---- Pass 2: Function Body Emission ----

  private emitFunctionBody(decl: FunctionDecl): void {
    const index = this.functionIndexMap.get(decl.name)!;

    // Save context
    const prevInstructions = this.currentInstructions;
    const prevLocals = this.currentLocals;
    const prevFuncName = this.currentFuncName;
    const prevLabels = this.labelOffsets;
    const prevPending = this.pendingJumps;

    this.currentInstructions = [];
    this.currentLocals = new Map();
    this.currentFuncName = decl.name;
    this.labelOffsets = new Map();
    this.pendingJumps = [];

    // Register params as locals
    for (const p of decl.params) {
      this.ensureLocal(p.name);
    }

    // Emit body
    this.emitBlock(decl.body);

    // ラベル/ジャンプの解決（この関数ストリーム）
    this.resolveLabels();

    // Implicit return at end of function
    this.emit1(OpCode.LOAD_CONST, this.addConstant(null));
    this.emit0(OpCode.RET);

    this.functions[index].instructions = this.currentInstructions;
    this.functions[index].localCount = this.currentLocals.size;

    // Restore context
    this.currentInstructions = prevInstructions;
    this.currentLocals = prevLocals;
    this.currentFuncName = prevFuncName;
    this.labelOffsets = prevLabels;
    this.pendingJumps = prevPending;
  }

  // ---- Constant Pool ----

  addConstant(value: unknown): number {
    const key = constantKey(value);
    const existing = this.constantMap.get(key);
    if (existing !== undefined) return existing;

    const index = this.constants.length;
    this.constants.push(value);
    this.constantMap.set(key, index);
    return index;
  }

  // ---- Variable Management ----

  private ensureLocal(name: string): number {
    const existing = this.currentLocals.get(name);
    if (existing !== undefined) return existing;
    const idx = this.addConstant(name);
    this.currentLocals.set(name, idx);
    return idx;
  }

  // ---- Instruction Helpers ----

  private emit0(op: OpCode): number {
    const idx = this.currentInstructions.length;
    this.currentInstructions.push({ op });
    return idx;
  }

  private emit1(op: OpCode, operand: number): number {
    const idx = this.currentInstructions.length;
    this.currentInstructions.push({ op, operand });
    return idx;
  }

  private emit2(op: OpCode, operand: number, operand2: number): number {
    const idx = this.currentInstructions.length;
    this.currentInstructions.push({ op, operand, operand2 });
    return idx;
  }

  private currentOffset(): number {
    return this.currentInstructions.length;
  }

  private patch(instrIndex: number, operand: number): void {
    this.currentInstructions[instrIndex].operand = operand;
  }

  /** 現ストリームの jump をラベル位置へ backpatch して状態をクリア。 */
  private resolveLabels(): void {
    for (const pj of this.pendingJumps) {
      const target = this.labelOffsets.get(pj.label);
      if (target === undefined) {
        throw new EmitError(`Unknown label '${pj.label}'`, pj.line, 0);
      }
      this.patch(pj.index, target);
    }
    this.labelOffsets = new Map();
    this.pendingJumps = [];
  }

  private emitDebugLine(line: number): void {
    this.sourceMap.push([this.currentOffset(), line]);
    this.emit1(OpCode.DEBUG_LINE, line);
  }

  // ---- Statement Code Generation ----

  private emitStatement(stmt: Statement): void {
    this.emitDebugLine(stmt.loc.line);

    switch (stmt.kind) {
      case 'VariableDecl':
        this.emitVariableDecl(stmt);
        break;
      case 'FunctionDecl':
        // Already handled in Pass 1/2
        break;
      case 'ReturnStmt':
        this.emitReturnStmt(stmt);
        break;
      case 'IfStmt':
        this.emitIfStmt(stmt);
        break;
      case 'ForStmt':
        this.emitForStmt(stmt);
        break;
      case 'WhileStmt':
        this.emitWhileStmt(stmt);
        break;
      case 'SwitchStmt':
        this.emitSwitchStmt(stmt);
        break;
      case 'LabelStmt':
        this.labelOffsets.set(stmt.name, this.currentOffset());
        break;
      case 'JumpStmt': {
        const idx = this.emit1(OpCode.JMP, 0); // placeholder → resolveLabels で解決
        this.pendingJumps.push({ index: idx, label: stmt.label, line: stmt.loc.line });
        break;
      }
      case 'BreakStmt':
        this.emitBreakStmt();
        break;
      case 'ContinueStmt':
        this.emitContinueStmt();
        break;
      case 'ExpressionStmt':
        this.emitExpression(stmt.expression);
        this.emit0(OpCode.POP);
        break;
      case 'BlockStmt':
        this.emitBlock(stmt);
        break;
      case 'TypeAliasDecl':
        // No code generated for type declarations
        break;
      case 'ImportDecl':
        // No code generated (future support)
        break;
      case 'ExportDecl':
        this.emitStatement(stmt.declaration);
        break;
      case 'DialogueBlock':
        this.emitDialogueBlock(stmt);
        break;
      case 'AtCommandStmt':
        this.emitAtCommandStmt(stmt);
        break;
    }
  }

  /**
   * `@word …` 行（P6-9）: 注入された atCommandParser で Op 化し、
   * HOST_CALL("execOp", [opJson]) → AWAIT で実行する（DialogueBlock と同じ4命令列）。
   * 同期 Op は host が pending を積まないため AWAIT は即完了する。
   */
  private emitAtCommandStmt(stmt: { raw: string; loc: { line: number; column: number } }): void {
    if (!this.atCommandParser) {
      throw new EmitError(
        `@ command lines require an atCommandParser (inject parseKsCommandLine from @kaedevn/compiler)`,
        stmt.loc.line, stmt.loc.column,
      );
    }
    let op: unknown;
    try {
      op = this.atCommandParser(stmt.raw, stmt.loc.line);
    } catch (e) {
      throw new EmitError(
        `invalid @ command "@${stmt.raw}": ${e instanceof Error ? e.message : String(e)}`,
        stmt.loc.line, stmt.loc.column,
      );
    }
    this.emit1(OpCode.LOAD_CONST, this.addConstant(JSON.stringify(op)));
    this.emit2(OpCode.HOST_CALL, this.addConstant('execOp'), 1);
    this.emit0(OpCode.AWAIT);
    this.emit0(OpCode.POP);
  }

  private emitVariableDecl(stmt: { name: string; init: Expression | null }): void {
    const nameIdx = this.ensureLocal(stmt.name);
    if (stmt.init) {
      this.emitExpression(stmt.init);
    } else {
      this.emit1(OpCode.LOAD_CONST, this.addConstant(undefined));
    }
    this.emit1(OpCode.STORE_VAR, nameIdx);
  }

  private emitReturnStmt(stmt: { value: Expression | null }): void {
    if (stmt.value) {
      this.emitExpression(stmt.value);
    } else {
      this.emit1(OpCode.LOAD_CONST, this.addConstant(null));
    }
    this.emit0(OpCode.RET);
  }

  private emitIfStmt(stmt: {
    condition: Expression;
    consequent: BlockStmt;
    alternate: Statement | null;
  }): void {
    this.emitExpression(stmt.condition);
    const jumpToElse = this.emit1(OpCode.JMP_IF_FALSE, 0); // placeholder

    this.emitBlock(stmt.consequent);

    if (stmt.alternate) {
      const jumpToEnd = this.emit1(OpCode.JMP, 0); // placeholder
      this.patch(jumpToElse, this.currentOffset());

      if (stmt.alternate.kind === 'BlockStmt') {
        this.emitBlock(stmt.alternate);
      } else {
        this.emitStatement(stmt.alternate);
      }
      this.patch(jumpToEnd, this.currentOffset());
    } else {
      this.patch(jumpToElse, this.currentOffset());
    }
  }

  private emitForStmt(stmt: {
    init: Statement | null;
    condition: Expression | null;
    update: Expression | null;
    body: BlockStmt;
  }): void {
    // init
    if (stmt.init) {
      this.emitStatement(stmt.init);
    }

    const loopStart = this.currentOffset();
    const scope: BreakableScope = {
      kind: 'loop', breakPatches: [], continuePatches: [], continueTarget: -1,
    };
    this.breakableStack.push(scope);

    // condition
    let jumpToEnd = -1;
    if (stmt.condition) {
      this.emitExpression(stmt.condition);
      jumpToEnd = this.emit1(OpCode.JMP_IF_FALSE, 0);
    }

    // body
    this.emitBlock(stmt.body);

    // continue target = update position
    const continueTarget = this.currentOffset();
    scope.continueTarget = continueTarget;

    // Backpatch continue statements emitted before continueTarget was known
    for (const cp of scope.continuePatches) {
      this.patch(cp, continueTarget);
    }

    // update
    if (stmt.update) {
      this.emitExpression(stmt.update);
      this.emit0(OpCode.POP);
    }

    // loop back
    this.emit1(OpCode.JMP, loopStart);

    // end
    const loopEnd = this.currentOffset();
    if (jumpToEnd >= 0) {
      this.patch(jumpToEnd, loopEnd);
    }

    // Backpatch break statements
    for (const bp of scope.breakPatches) {
      this.patch(bp, loopEnd);
    }

    this.breakableStack.pop();
  }

  private emitWhileStmt(stmt: {
    condition: Expression;
    body: BlockStmt;
  }): void {
    const loopStart = this.currentOffset();
    const scope: BreakableScope = {
      kind: 'loop', breakPatches: [], continuePatches: [], continueTarget: loopStart,
    };
    this.breakableStack.push(scope);

    this.emitExpression(stmt.condition);
    const jumpToEnd = this.emit1(OpCode.JMP_IF_FALSE, 0);

    this.emitBlock(stmt.body);
    this.emit1(OpCode.JMP, loopStart);

    const loopEnd = this.currentOffset();
    this.patch(jumpToEnd, loopEnd);

    for (const bp of scope.breakPatches) {
      this.patch(bp, loopEnd);
    }

    this.breakableStack.pop();
  }

  private emitSwitchStmt(stmt: {
    discriminant: Expression;
    cases: { test: Expression | null; body: Statement[] }[];
  }): void {
    // Evaluate discriminant
    this.emitExpression(stmt.discriminant);

    // Build case table
    const table: SwitchCaseTable = { cases: [], defaultTarget: -1 };
    const tableIndex = this.switchTables.length;
    this.switchTables.push(table);

    this.emit1(OpCode.SWITCH, tableIndex);

    // Push switch scope for break
    const scope: BreakableScope = {
      kind: 'switch', breakPatches: [], continuePatches: [], continueTarget: -1,
    };
    this.breakableStack.push(scope);

    // Emit case bodies and record their offsets
    const caseOffsets: number[] = [];
    for (const c of stmt.cases) {
      caseOffsets.push(this.currentOffset());
      for (const s of c.body) {
        this.emitStatement(s);
      }
    }

    const switchEnd = this.currentOffset();

    // Fill in case table targets
    for (let i = 0; i < stmt.cases.length; i++) {
      const c = stmt.cases[i];
      if (c.test === null) {
        // default case
        table.defaultTarget = caseOffsets[i];
      } else {
        // Evaluate case value at compile time (must be literal)
        const value = this.evaluateConstantExpr(c.test);
        table.cases.push({ value, target: caseOffsets[i] });
      }
    }

    // If no default, default jumps to switch end
    if (table.defaultTarget === -1) {
      table.defaultTarget = switchEnd;
    }

    // Backpatch break statements
    for (const bp of scope.breakPatches) {
      this.patch(bp, switchEnd);
    }

    this.breakableStack.pop();
  }

  private emitBreakStmt(): void {
    // Break targets the innermost loop or switch
    if (this.breakableStack.length > 0) {
      const scope = this.breakableStack[this.breakableStack.length - 1];
      scope.breakPatches.push(this.emit1(OpCode.JMP, 0));
      return;
    }
    // break outside loop/switch — emit JMP 0 (should be caught by type checker)
    this.emit1(OpCode.JMP, 0);
  }

  private emitContinueStmt(): void {
    // Continue targets the innermost loop (skips switches)
    for (let i = this.breakableStack.length - 1; i >= 0; i--) {
      const scope = this.breakableStack[i];
      if (scope.kind !== 'loop') continue;

      if (scope.continueTarget >= 0) {
        this.emit1(OpCode.JMP, scope.continueTarget);
      } else {
        // For for-loops where continueTarget isn't yet known
        scope.continuePatches.push(this.emit1(OpCode.JMP, 0));
      }
      return;
    }
    // continue outside loop — emit JMP 0 (should be caught by type checker)
    this.emit1(OpCode.JMP, 0);
  }

  private emitBlock(block: BlockStmt): void {
    for (const stmt of block.body) {
      this.emitStatement(stmt);
    }
  }

  private emitDialogueBlock(stmt: {
    speaker: string;
    lines: { text: string; command?: 'r' | 'l' | 'p' }[];
    loc: { line: number; column: number };
  }): void {
    const hasInlineCommands = stmt.lines.some(l => l.command);

    if (!hasInlineCommands) {
      // Simple path: join all lines and emit single showDialogue
      this.emit1(OpCode.LOAD_CONST, this.addConstant(stmt.speaker));
      this.emit1(OpCode.LOAD_CONST, this.addConstant(stmt.lines.map(l => l.text).join('\n')));
      const nameIdx = this.addConstant('showDialogue');
      this.emit2(OpCode.HOST_CALL, nameIdx, 2);
      this.emit0(OpCode.AWAIT);
      this.emit0(OpCode.POP);
      return;
    }

    // Per-line emission with inline commands
    for (const line of stmt.lines) {
      if (line.text) {
        this.emit1(OpCode.LOAD_CONST, this.addConstant(stmt.speaker));
        this.emit1(OpCode.LOAD_CONST, this.addConstant(line.text));
        const nameIdx = this.addConstant('showDialogue');
        this.emit2(OpCode.HOST_CALL, nameIdx, 2);
        this.emit0(OpCode.AWAIT);
        this.emit0(OpCode.POP);
      }

      if (line.command) {
        const cmdMap = { r: 'newLine', l: 'waitClick', p: 'pageClear' } as const;
        const cmdNameIdx = this.addConstant(cmdMap[line.command]);
        this.emit2(OpCode.HOST_CALL, cmdNameIdx, 0);
        this.emit0(OpCode.AWAIT);
        this.emit0(OpCode.POP);
      }
    }
  }

  // ---- Expression Code Generation ----

  private emitExpression(expr: Expression): void {
    switch (expr.kind) {
      case 'NumberLiteral':
        this.emit1(OpCode.LOAD_CONST, this.addConstant(expr.value));
        break;
      case 'StringLiteral':
        this.emit1(OpCode.LOAD_CONST, this.addConstant(expr.value));
        break;
      case 'TemplateLiteral':
        // For simple templates (single raw string), emit as string constant
        if (expr.parts.length === 1 && typeof expr.parts[0] === 'string') {
          this.emit1(OpCode.LOAD_CONST, this.addConstant(expr.parts[0]));
        } else {
          // Multi-part templates: concatenate parts
          let first = true;
          for (const part of expr.parts) {
            if (typeof part === 'string') {
              this.emit1(OpCode.LOAD_CONST, this.addConstant(part));
            } else {
              this.emitExpression(part);
            }
            if (!first) {
              this.emit0(OpCode.ADD);
            }
            first = false;
          }
        }
        break;
      case 'BooleanLiteral':
        this.emit1(OpCode.LOAD_CONST, this.addConstant(expr.value));
        break;
      case 'NullLiteral':
        this.emit1(OpCode.LOAD_CONST, this.addConstant(null));
        break;
      case 'UndefinedLiteral':
        this.emit1(OpCode.LOAD_CONST, this.addConstant(undefined));
        break;
      case 'Identifier':
        this.emitIdentifier(expr);
        break;
      case 'BinaryExpr':
        this.emitBinaryExpr(expr);
        break;
      case 'UnaryExpr':
        this.emitUnaryExpr(expr);
        break;
      case 'AssignExpr':
        this.emitAssignExpr(expr);
        break;
      case 'CallExpr':
        this.emitCallExpr(expr);
        break;
      case 'MemberExpr':
        this.emitMemberExpr(expr);
        break;
      case 'IndexExpr':
        this.emitIndexExpr(expr);
        break;
      case 'TernaryExpr':
        this.emitTernaryExpr(expr);
        break;
      case 'ArrayLiteral':
        this.emitArrayLiteral(expr);
        break;
      case 'ObjectLiteral':
        this.emitObjectLiteral(expr);
        break;
      case 'AwaitExpr':
        this.emitExpression(expr.argument);
        this.emit0(OpCode.AWAIT);
        break;
    }
  }

  private emitIdentifier(expr: { name: string }): void {
    const nameIdx = this.ensureLocal(expr.name);
    this.emit1(OpCode.LOAD_VAR, nameIdx);
  }

  private emitBinaryExpr(expr: { op: string; left: Expression; right: Expression }): void {
    // Short-circuit for && and ||
    if (expr.op === '&&') {
      this.emitExpression(expr.left);
      this.emit0(OpCode.DUP);
      const jumpToEnd = this.emit1(OpCode.JMP_IF_FALSE, 0);
      this.emit0(OpCode.POP); // remove dup'd left value
      this.emitExpression(expr.right);
      this.patch(jumpToEnd, this.currentOffset());
      return;
    }
    if (expr.op === '||') {
      this.emitExpression(expr.left);
      this.emit0(OpCode.DUP);
      // Jump if true (skip right)
      this.emit0(OpCode.NOT);
      const jumpToEnd = this.emit1(OpCode.JMP_IF_FALSE, 0);
      this.emit0(OpCode.POP); // remove dup'd left value
      this.emitExpression(expr.right);
      this.patch(jumpToEnd, this.currentOffset());
      return;
    }

    this.emitExpression(expr.left);
    this.emitExpression(expr.right);

    switch (expr.op) {
      case '+': this.emit0(OpCode.ADD); break;
      case '-': this.emit0(OpCode.SUB); break;
      case '*': this.emit0(OpCode.MUL); break;
      case '/': this.emit0(OpCode.DIV); break;
      case '%': this.emit0(OpCode.MOD); break;
      case '==': this.emit0(OpCode.CMP_EQ); break;
      case '!=': this.emit0(OpCode.CMP_NEQ); break;
      case '<': this.emit0(OpCode.CMP_LT); break;
      case '<=': this.emit0(OpCode.CMP_LTEQ); break;
      case '>': this.emit0(OpCode.CMP_GT); break;
      case '>=': this.emit0(OpCode.CMP_GTEQ); break;
      default:
        throw new EmitError(`Unknown binary operator '${expr.op}'`, 0, 0);
    }
  }

  private emitUnaryExpr(expr: { op: string; operand: Expression }): void {
    this.emitExpression(expr.operand);
    switch (expr.op) {
      case '-': this.emit0(OpCode.NEG); break;
      case '!': this.emit0(OpCode.NOT); break;
      default:
        throw new EmitError(`Unknown unary operator '${expr.op}'`, 0, 0);
    }
  }

  private emitAssignExpr(expr: {
    op: string; target: Expression; value: Expression;
  }): void {
    if (expr.target.kind === 'Identifier') {
      const nameIdx = this.ensureLocal(expr.target.name);

      if (expr.op === '=') {
        this.emitExpression(expr.value);
      } else {
        // Compound assignment: load current, compute, store
        this.emit1(OpCode.LOAD_VAR, nameIdx);
        this.emitExpression(expr.value);
        this.emitCompoundOp(expr.op);
      }

      // DUP so the assignment expression has a value
      this.emit0(OpCode.DUP);
      this.emit1(OpCode.STORE_VAR, nameIdx);
    } else if (expr.target.kind === 'MemberExpr') {
      // object.field = value
      this.emitExpression(expr.target.object);
      const fieldIdx = this.addConstant(expr.target.property);

      if (expr.op === '=') {
        this.emitExpression(expr.value);
      } else {
        // Compound: get current field value, compute
        this.emit0(OpCode.DUP); // dup object
        this.emit1(OpCode.GET_FIELD, fieldIdx);
        this.emitExpression(expr.value);
        this.emitCompoundOp(expr.op);
      }

      this.emit1(OpCode.SET_FIELD, fieldIdx);
    } else if (expr.target.kind === 'IndexExpr') {
      if (expr.op === '=') {
        // array[index] = value  →  stack: [array, index, value] → SET_INDEX
        this.emitExpression(expr.target.object);
        this.emitExpression(expr.target.index);
        this.emitExpression(expr.value);
        this.emit0(OpCode.SET_INDEX);
      } else {
        // Compound: arr[i] += v
        // Stack order for SET_INDEX: [array, index, value]
        // 1. Push array and index (for SET_INDEX later)
        this.emitExpression(expr.target.object);
        this.emitExpression(expr.target.index);
        // 2. Push array and index again (for GET_INDEX to read current value)
        this.emitExpression(expr.target.object);
        this.emitExpression(expr.target.index);
        this.emit0(OpCode.GET_INDEX);
        // Stack: [array, index, currentValue]
        // 3. Compute new value
        this.emitExpression(expr.value);
        this.emitCompoundOp(expr.op);
        // Stack: [array, index, newValue]
        this.emit0(OpCode.SET_INDEX);
      }
    } else {
      throw new EmitError('Invalid assignment target', 0, 0);
    }
  }

  private emitCompoundOp(op: string): void {
    switch (op) {
      case '+=': this.emit0(OpCode.ADD); break;
      case '-=': this.emit0(OpCode.SUB); break;
      case '*=': this.emit0(OpCode.MUL); break;
      case '/=': this.emit0(OpCode.DIV); break;
      case '%=': this.emit0(OpCode.MOD); break;
      default:
        throw new EmitError(`Unknown compound operator '${op}'`, 0, 0);
    }
  }

  private emitCallExpr(expr: {
    callee: Expression; args: Expression[];
    loc: { line: number; column: number };
  }): void {
    // Check for HOST_CALL pattern: engine.method(args)
    if (expr.callee.kind === 'MemberExpr' && this.isHostObject(expr.callee.object)) {
      this.emitHostCall(expr.callee.property, expr.args);
      return;
    }

    // Top-level billing builtins (Phase 1 Day 19) — bare `platform()`,
    // `purchase()`, `owned()`, `isEntitled()`, `restore()` compile to
    // HOST_CALL just like `engine.*`. Keeps script ergonomics short for
    // an API every work ends up using.
    if (expr.callee.kind === 'Identifier' &&
        TOP_LEVEL_HOST_CALLS.has(expr.callee.name)) {
      this.emitHostCall(expr.callee.name, expr.args);
      return;
    }

    // Check for method call: obj.method(args)
    if (expr.callee.kind === 'MemberExpr') {
      // Push object (this)
      this.emitExpression(expr.callee.object);
      // Push arguments
      for (const arg of expr.args) {
        this.emitExpression(arg);
      }
      const methodNameIdx = this.addConstant(expr.callee.property);
      this.emit2(OpCode.CALL_METHOD, expr.args.length, methodNameIdx);
      return;
    }

    // Regular function call
    // Push arguments first
    for (const arg of expr.args) {
      this.emitExpression(arg);
    }

    // Push callee
    this.emitExpression(expr.callee);

    this.emit1(OpCode.CALL, expr.args.length);
  }

  private isHostObject(expr: Expression): boolean {
    return expr.kind === 'Identifier' && expr.name === 'engine';
  }

  private emitHostCall(methodName: string, args: Expression[]): void {
    // Push arguments
    for (const arg of args) {
      this.emitExpression(arg);
    }
    const nameIdx = this.addConstant(methodName);
    this.emit2(OpCode.HOST_CALL, nameIdx, args.length);
  }

  private emitMemberExpr(expr: { object: Expression; property: string }): void {
    this.emitExpression(expr.object);
    const fieldIdx = this.addConstant(expr.property);
    this.emit1(OpCode.GET_FIELD, fieldIdx);
  }

  private emitIndexExpr(expr: { object: Expression; index: Expression }): void {
    this.emitExpression(expr.object);
    this.emitExpression(expr.index);
    this.emit0(OpCode.GET_INDEX);
  }

  private emitTernaryExpr(expr: {
    condition: Expression; consequent: Expression; alternate: Expression;
  }): void {
    this.emitExpression(expr.condition);
    const jumpToElse = this.emit1(OpCode.JMP_IF_FALSE, 0);
    this.emitExpression(expr.consequent);
    const jumpToEnd = this.emit1(OpCode.JMP, 0);
    this.patch(jumpToElse, this.currentOffset());
    this.emitExpression(expr.alternate);
    this.patch(jumpToEnd, this.currentOffset());
  }

  private emitArrayLiteral(expr: { elements: Expression[] }): void {
    for (const el of expr.elements) {
      this.emitExpression(el);
    }
    this.emit1(OpCode.MAKE_ARRAY, expr.elements.length);
  }

  private emitObjectLiteral(expr: { fields: { key: string; value: Expression }[] }): void {
    for (const f of expr.fields) {
      this.emit1(OpCode.LOAD_CONST, this.addConstant(f.key));
      this.emitExpression(f.value);
    }
    this.emit1(OpCode.MAKE_OBJECT, expr.fields.length);
  }

  // ---- Helpers ----

  private evaluateConstantExpr(expr: Expression): unknown {
    switch (expr.kind) {
      case 'NumberLiteral': return expr.value;
      case 'StringLiteral': return expr.value;
      case 'BooleanLiteral': return expr.value;
      case 'NullLiteral': return null;
      case 'UndefinedLiteral': return undefined;
      default:
        throw new EmitError(
          `Switch case value must be a constant expression`,
          expr.loc.line, expr.loc.column,
        );
    }
  }
}

// ---- Constant dedup key ----
function constantKey(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return `bool:${value}`;
  if (typeof value === 'number') return `num:${value}`;
  if (typeof value === 'string') return `str:${value}`;
  return `obj:${String(value)}`;
}

// ---- Public API ----

export function emitIR(program: Program, sourceFile?: string, options?: EmitOptions): IRModule {
  const emitter = new Emitter();
  return emitter.emit(program, sourceFile, options);
}
