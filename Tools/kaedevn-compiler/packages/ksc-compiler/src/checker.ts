/** KSC Type Checker
 *
 * 2パスアルゴリズム:
 *   Pass 1: トップレベルの関数宣言と型エイリアスを先行登録（前方参照対応）
 *   Pass 2: 全文を順に型チェック
 */

import type { Program, Statement, Expression, TypeAnnotation } from './types/ast.js';
import {
  KscType, ParamInfo,
  NUMBER_TYPE, STRING_TYPE, BOOLEAN_TYPE, NULL_TYPE,
  UNDEFINED_TYPE, VOID_TYPE, ERROR_TYPE,
  typeToString, isAssignableTo, resolveAnnotation,
} from './types/ksc-type.js';
import { Scope } from './checker/scope.js';
import { TypeCheckError, makeError, E } from './checker/errors.js';
import { getBuiltinMethods } from './checker/builtins.js';
import { STDLIB_NAMES } from './stdlib.js';

// ---- Public API ----

export interface TypeCheckResult {
  errors: TypeCheckError[];
}

export function typeCheck(program: Program): TypeCheckResult {
  const checker = new Checker();
  checker.check(program);
  return { errors: checker.errors };
}

// ---- Checker ----

class Checker {
  errors: TypeCheckError[] = [];
  private scope: Scope;
  private typeAliases = new Map<string, KscType>();
  private currentReturnType: KscType | null = null; // null = outside function

  constructor() {
    this.scope = new Scope(null, 'global');
    // ビルトイン関数を engine としてグローバルに登録
    const builtins = getBuiltinMethods();
    const engineFields = new Map<string, KscType>();
    for (const [name, type] of builtins) {
      engineFields.set(name, type);
    }
    this.scope.define({
      name: 'engine',
      type: { kind: 'object', fields: engineFields },
      mutable: false,
      declLoc: { line: 0, column: 0 },
    });

    // Billing / platform functions also available as top-level globals
    // (Phase 1 Day 19). These are fundamentally platform-state queries
    // rather than engine operations, and appear in every KSC work that
    // sells content — mandating the `engine.` prefix there hurts DX.
    //
    // ECS / Entity functions (Phase 1 #2) — also top-level. Entity ops are
    // composed into chains (spawn → setPos → setSprite) and threading
    // `engine.` through every call hurts readability significantly.
    const topLevelBillingNames = [
      'platform', 'isEntitled', 'owned', 'purchase', 'restore',
      'spawn', 'destroy', 'isAlive', 'setPos', 'getPos',
      'setSprite', 'setLayer', 'entityCount',
      // Camera (Phase 1 #3)
      'setCamera', 'getCamera', 'cameraFollow', 'cameraTarget',
      // Tween (Phase 1 #4)
      'tweenTo', 'tweenStop', 'tweenActive', 'tweenCount',
      // Collision (Phase 1 #5)
      'setCollider', 'removeCollider', 'hasCollider', 'overlap', 'aabbQuery',
      // Input (Phase 2 #1)
      'pressed', 'justPressed', 'justReleased', 'axis', 'pointer',
      // Frame loops in KSC need bare `await wait(ms)` — Phase 2 #3
      'wait',
      // stdlib pure math (2026-06-13) — bare floor()/min()/etc. Intercepted
      // in-VM; reserved names. Source of truth: STDLIB_NAMES in stdlib.ts.
      ...STDLIB_NAMES,
    ];
    for (const name of topLevelBillingNames) {
      const type = builtins.get(name);
      if (type) {
        this.scope.define({
          name,
          type,
          mutable: false,
          declLoc: { line: 0, column: 0 },
        });
      }
    }
  }

  check(program: Program): void {
    // Pass 1: トップレベルの関数宣言と型エイリアスを先行登録
    for (const stmt of program.body) {
      if (stmt.kind === 'FunctionDecl') {
        this.registerFunction(stmt);
      } else if (stmt.kind === 'TypeAliasDecl') {
        this.registerTypeAlias(stmt);
      } else if (stmt.kind === 'ExportDecl') {
        const inner = stmt.declaration;
        if (inner.kind === 'FunctionDecl') {
          this.registerFunction(inner);
        } else if (inner.kind === 'TypeAliasDecl') {
          this.registerTypeAlias(inner);
        }
      }
    }

    // Pass 2: 全文を型チェック
    for (const stmt of program.body) {
      this.checkStatement(stmt);
    }
  }

  // ---- Pass 1: Registration ----

  private registerFunction(stmt: {
    kind: 'FunctionDecl';
    name: string;
    params: { name: string; type: TypeAnnotation }[];
    returnType: TypeAnnotation;
    isAsync?: boolean;
    loc: { line: number; column: number };
  }): void {
    const params: ParamInfo[] = stmt.params.map(p => ({
      name: p.name,
      type: this.resolveType(p.type),
    }));
    const inner = this.resolveType(stmt.returnType);
    // `async function f(): T {}` → external callers see f returning Promise<T>.
    // If the author already wrote Promise<X>, don't double-wrap.
    const returnType: KscType =
      stmt.isAsync && inner.kind !== 'promise'
        ? { kind: 'promise', inner }
        : inner;
    const fnType: KscType = { kind: 'function', params, returnType };
    this.scope.define({
      name: stmt.name,
      type: fnType,
      mutable: false,
      declLoc: stmt.loc,
    });
  }

  private registerTypeAlias(stmt: { kind: 'TypeAliasDecl'; name: string; type: TypeAnnotation }): void {
    const resolved = this.resolveType(stmt.type);
    this.typeAliases.set(stmt.name, resolved);
  }

  // ---- Statement Checking ----

  private checkStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case 'VariableDecl':
        this.checkVariableDecl(stmt);
        break;
      case 'FunctionDecl':
        this.checkFunctionDecl(stmt);
        break;
      case 'ReturnStmt':
        this.checkReturnStmt(stmt);
        break;
      case 'IfStmt':
        this.checkIfStmt(stmt);
        break;
      case 'ForStmt':
        this.checkForStmt(stmt);
        break;
      case 'WhileStmt':
        this.checkWhileStmt(stmt);
        break;
      case 'SwitchStmt':
        this.checkSwitchStmt(stmt);
        break;
      case 'BreakStmt':
      case 'ContinueStmt':
      case 'LabelStmt':
      case 'JumpStmt':
        // 常に valid（ラベル存在チェックは emitter 側で行う）
        break;
      case 'BlockStmt':
        this.checkBlockStmt(stmt);
        break;
      case 'ExpressionStmt':
        this.inferExpr(stmt.expression);
        break;
      case 'TypeAliasDecl':
        // Pass 1 で登録済み
        break;
      case 'ImportDecl':
        // import は型チェッカーではスキップ
        break;
      case 'ExportDecl':
        this.checkStatement(stmt.declaration);
        break;
      case 'DialogueBlock':
        // 常に valid
        break;
      case 'AtCommandStmt':
        // raw テキストの検証は emit 時の atCommandParser（KS commandRegistry）が担う
        break;
    }
  }

  private checkVariableDecl(stmt: {
    name: string; mutable: boolean;
    typeAnnotation: TypeAnnotation | null; init: Expression | null;
    loc: { line: number; column: number };
  }): void {
    let declaredType: KscType | null = null;
    if (stmt.typeAnnotation) {
      declaredType = this.resolveType(stmt.typeAnnotation);
    }

    let initType: KscType | null = null;
    if (stmt.init) {
      initType = this.inferExpr(stmt.init);
    }

    // 型の決定
    let varType: KscType;
    if (declaredType && initType) {
      // 両方ある場合: 互換性チェック
      if (!isAssignableTo(initType, declaredType)) {
        this.errors.push(makeError(
          E.TYPE_MISMATCH,
          `Type '${typeToString(initType)}' is not assignable to type '${typeToString(declaredType)}'`,
          stmt.loc,
        ));
      }
      varType = declaredType;
    } else if (declaredType) {
      varType = declaredType;
    } else if (initType) {
      varType = initType;
    } else {
      varType = UNDEFINED_TYPE;
    }

    // スコープに登録
    const ok = this.scope.define({
      name: stmt.name,
      type: varType,
      mutable: stmt.mutable,
      declLoc: stmt.loc,
    });
    if (!ok) {
      this.errors.push(makeError(
        E.DUPLICATE_DECLARATION,
        `Duplicate declaration '${stmt.name}'`,
        stmt.loc,
      ));
    }
  }

  private checkFunctionDecl(stmt: {
    name: string; params: { name: string; type: TypeAnnotation }[];
    returnType: TypeAnnotation; body: { kind: 'BlockStmt'; body: Statement[] };
    isAsync?: boolean;
    thisType?: TypeAnnotation;
    loc: { line: number; column: number };
  }): void {
    // Pass 1 で既にスコープに登録済み
    const declared = this.resolveType(stmt.returnType);
    // async function の body 内では return は「解決後の値型」を返す。
    // 外部の呼出者は Promise<T> を観測するが、body 内の `return x;` は
    // x が T に一致すればよい。
    const returnType: KscType =
      stmt.isAsync && declared.kind === 'promise'
        ? declared.inner
        : declared;

    // 新しい function スコープ
    const prevScope = this.scope;
    const prevReturn = this.currentReturnType;
    this.scope = new Scope(prevScope, 'function');
    this.currentReturnType = returnType;

    // Phase 1 #13 V1: クラスメソッドの場合、thisType に基づいて `this` を
    // スコープに事前定義。VM の CALL_METHOD は receiver を 'this' という
    // local として inject するので、ここで宣言しておけば method body 内の
    // `this.field` が型チェック通る。
    if (stmt.thisType) {
      this.scope.define({
        name: 'this',
        type: this.resolveType(stmt.thisType),
        mutable: false,
        declLoc: stmt.loc,
      });
    }

    // パラメータをスコープに登録
    for (const p of stmt.params) {
      this.scope.define({
        name: p.name,
        type: this.resolveType(p.type),
        mutable: true, // パラメータは再代入可能
        declLoc: stmt.loc,
      });
    }

    // body をチェック
    for (const s of stmt.body.body) {
      this.checkStatement(s);
    }

    this.scope = prevScope;
    this.currentReturnType = prevReturn;
  }

  private checkReturnStmt(stmt: { value: Expression | null; loc: { line: number; column: number } }): void {
    if (this.currentReturnType === null) {
      this.errors.push(makeError(
        E.RETURN_OUTSIDE_FUNCTION,
        `'return' statement used outside of a function`,
        stmt.loc,
      ));
      return;
    }

    if (stmt.value) {
      const valueType = this.inferExpr(stmt.value);
      if (!isAssignableTo(valueType, this.currentReturnType)) {
        this.errors.push(makeError(
          E.RETURN_TYPE_MISMATCH,
          `Type '${typeToString(valueType)}' is not assignable to return type '${typeToString(this.currentReturnType)}'`,
          stmt.loc,
        ));
      }
    } else {
      // return; は void を返す
      if (!isAssignableTo(VOID_TYPE, this.currentReturnType) &&
          !isAssignableTo(UNDEFINED_TYPE, this.currentReturnType)) {
        // void 戻り値の関数で return; は OK
        // non-void 戻り値の関数で return; はエラーだが、
        // void 関数ではそもそも return; は許可
        if (this.currentReturnType.kind !== 'void') {
          this.errors.push(makeError(
            E.RETURN_TYPE_MISMATCH,
            `Function must return a value of type '${typeToString(this.currentReturnType)}'`,
            stmt.loc,
          ));
        }
      }
    }
  }

  private checkIfStmt(stmt: {
    condition: Expression;
    consequent: { kind: 'BlockStmt'; body: Statement[] };
    alternate: Statement | null;
    loc: { line: number; column: number };
  }): void {
    this.inferExpr(stmt.condition);

    // consequent ブロックスコープ
    const prevScope = this.scope;
    this.scope = new Scope(prevScope, 'block');
    for (const s of stmt.consequent.body) {
      this.checkStatement(s);
    }
    this.scope = prevScope;

    // alternate
    if (stmt.alternate) {
      if (stmt.alternate.kind === 'BlockStmt') {
        const prevScope2 = this.scope;
        this.scope = new Scope(prevScope2, 'block');
        for (const s of stmt.alternate.body) {
          this.checkStatement(s);
        }
        this.scope = prevScope2;
      } else {
        this.checkStatement(stmt.alternate);
      }
    }
  }

  private checkForStmt(stmt: {
    init: Statement | null; condition: Expression | null;
    update: Expression | null; body: { kind: 'BlockStmt'; body: Statement[] };
  }): void {
    const prevScope = this.scope;
    this.scope = new Scope(prevScope, 'block');

    if (stmt.init) this.checkStatement(stmt.init);
    if (stmt.condition) this.inferExpr(stmt.condition);
    if (stmt.update) this.inferExpr(stmt.update);

    for (const s of stmt.body.body) {
      this.checkStatement(s);
    }

    this.scope = prevScope;
  }

  private checkWhileStmt(stmt: {
    condition: Expression;
    body: { kind: 'BlockStmt'; body: Statement[] };
  }): void {
    this.inferExpr(stmt.condition);

    const prevScope = this.scope;
    this.scope = new Scope(prevScope, 'block');
    for (const s of stmt.body.body) {
      this.checkStatement(s);
    }
    this.scope = prevScope;
  }

  private checkSwitchStmt(stmt: {
    discriminant: Expression;
    cases: { test: Expression | null; body: Statement[] }[];
  }): void {
    this.inferExpr(stmt.discriminant);

    for (const c of stmt.cases) {
      if (c.test) this.inferExpr(c.test);
      const prevScope = this.scope;
      this.scope = new Scope(prevScope, 'block');
      for (const s of c.body) {
        this.checkStatement(s);
      }
      this.scope = prevScope;
    }
  }

  private checkBlockStmt(stmt: { body: Statement[] }): void {
    const prevScope = this.scope;
    this.scope = new Scope(prevScope, 'block');
    for (const s of stmt.body) {
      this.checkStatement(s);
    }
    this.scope = prevScope;
  }

  // ---- Expression Type Inference ----

  private inferExpr(expr: Expression): KscType {
    switch (expr.kind) {
      case 'NumberLiteral':
        return { kind: 'literal', value: expr.value };
      case 'StringLiteral':
        return { kind: 'literal', value: expr.value };
      case 'TemplateLiteral':
        return STRING_TYPE;
      case 'BooleanLiteral':
        return { kind: 'literal', value: expr.value };
      case 'NullLiteral':
        return NULL_TYPE;
      case 'UndefinedLiteral':
        return UNDEFINED_TYPE;
      case 'Identifier':
        return this.inferIdentifier(expr);
      case 'BinaryExpr':
        return this.inferBinaryExpr(expr);
      case 'UnaryExpr':
        return this.inferUnaryExpr(expr);
      case 'AssignExpr':
        return this.inferAssignExpr(expr);
      case 'CallExpr':
        return this.inferCallExpr(expr);
      case 'MemberExpr':
        return this.inferMemberExpr(expr);
      case 'IndexExpr':
        return this.inferIndexExpr(expr);
      case 'TernaryExpr':
        return this.inferTernaryExpr(expr);
      case 'ArrayLiteral':
        return this.inferArrayLiteral(expr);
      case 'ObjectLiteral':
        return this.inferObjectLiteral(expr);
      case 'AwaitExpr':
        return this.inferAwaitExpr(expr);
    }
  }

  private inferIdentifier(expr: { name: string; loc: { line: number; column: number } }): KscType {
    const sym = this.scope.lookup(expr.name);
    if (!sym) {
      this.errors.push(makeError(
        E.UNDEFINED_VARIABLE,
        `Cannot find name '${expr.name}'`,
        expr.loc,
      ));
      return ERROR_TYPE;
    }
    return sym.type;
  }

  private inferBinaryExpr(expr: {
    op: string; left: Expression; right: Expression;
    loc: { line: number; column: number };
  }): KscType {
    const leftType = this.inferExpr(expr.left);
    const rightType = this.inferExpr(expr.right);

    // error は伝播
    if (leftType.kind === 'error' || rightType.kind === 'error') return ERROR_TYPE;

    switch (expr.op) {
      case '+': {
        // number + number → number
        if (isAssignableTo(leftType, NUMBER_TYPE) && isAssignableTo(rightType, NUMBER_TYPE)) {
          return NUMBER_TYPE;
        }
        // string + string → string
        if (isAssignableTo(leftType, STRING_TYPE) && isAssignableTo(rightType, STRING_TYPE)) {
          return STRING_TYPE;
        }
        // 混在 → エラー
        this.errors.push(makeError(
          E.STRING_NUMBER_ADD,
          `Operator '+' cannot be applied to types '${typeToString(leftType)}' and '${typeToString(rightType)}'`,
          expr.loc,
        ));
        return ERROR_TYPE;
      }
      case '-':
      case '*':
      case '/':
      case '%':
        return NUMBER_TYPE;

      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=':
        return BOOLEAN_TYPE;

      case '&&':
      case '||':
        return BOOLEAN_TYPE;

      default:
        return ERROR_TYPE;
    }
  }

  private inferUnaryExpr(expr: {
    op: string; operand: Expression;
    loc: { line: number; column: number };
  }): KscType {
    const operandType = this.inferExpr(expr.operand);
    if (operandType.kind === 'error') return ERROR_TYPE;

    switch (expr.op) {
      case '-':
        return NUMBER_TYPE;
      case '!':
        return BOOLEAN_TYPE;
      default:
        return ERROR_TYPE;
    }
  }

  private inferAssignExpr(expr: {
    op: string; target: Expression; value: Expression;
    loc: { line: number; column: number };
  }): KscType {
    const valueType = this.inferExpr(expr.value);

    // target が Identifier の場合: const チェック + 型チェック
    if (expr.target.kind === 'Identifier') {
      const sym = this.scope.lookup(expr.target.name);
      if (!sym) {
        this.errors.push(makeError(
          E.UNDEFINED_VARIABLE,
          `Cannot find name '${expr.target.name}'`,
          expr.loc,
        ));
        return ERROR_TYPE;
      }
      if (!sym.mutable) {
        this.errors.push(makeError(
          E.CONST_REASSIGN,
          `Cannot assign to '${expr.target.name}' because it is a constant`,
          expr.loc,
        ));
        return ERROR_TYPE;
      }

      if (expr.op === '=') {
        if (!isAssignableTo(valueType, sym.type)) {
          this.errors.push(makeError(
            E.TYPE_MISMATCH,
            `Type '${typeToString(valueType)}' is not assignable to type '${typeToString(sym.type)}'`,
            expr.loc,
          ));
        }
        return sym.type;
      }
      // 複合代入 (+=, -=, *=, /=, %=)
      return sym.type;
    }

    // member/index の場合は target の型を推論する
    this.inferExpr(expr.target);
    return valueType;
  }

  private inferCallExpr(expr: {
    callee: Expression; args: Expression[];
    loc: { line: number; column: number };
  }): KscType {
    const calleeType = this.inferExpr(expr.callee);

    if (calleeType.kind === 'error') {
      // 引数も推論して潜在エラーを収集
      for (const arg of expr.args) this.inferExpr(arg);
      return ERROR_TYPE;
    }

    if (calleeType.kind !== 'function') {
      this.errors.push(makeError(
        E.NOT_CALLABLE,
        `Type '${typeToString(calleeType)}' is not callable`,
        expr.loc,
      ));
      for (const arg of expr.args) this.inferExpr(arg);
      return ERROR_TYPE;
    }

    // 引数数チェック
    const requiredCount = calleeType.params.filter(p => !p.optional).length;
    const maxCount = calleeType.params.length;

    if (expr.args.length < requiredCount || expr.args.length > maxCount) {
      this.errors.push(makeError(
        E.ARG_COUNT_MISMATCH,
        `Expected ${requiredCount}${maxCount !== requiredCount ? '-' + maxCount : ''} arguments, but got ${expr.args.length}`,
        expr.loc,
      ));
    }

    // 引数型チェック
    for (let i = 0; i < expr.args.length && i < calleeType.params.length; i++) {
      const argType = this.inferExpr(expr.args[i]);
      const paramType = calleeType.params[i].type;
      if (!isAssignableTo(argType, paramType)) {
        this.errors.push(makeError(
          E.TYPE_MISMATCH,
          `Argument of type '${typeToString(argType)}' is not assignable to parameter '${calleeType.params[i].name}' of type '${typeToString(paramType)}'`,
          expr.args[i].loc,
        ));
      }
    }

    // 余分な引数の型推論
    for (let i = calleeType.params.length; i < expr.args.length; i++) {
      this.inferExpr(expr.args[i]);
    }

    return calleeType.returnType;
  }

  private inferMemberExpr(expr: {
    object: Expression; property: string;
    loc: { line: number; column: number };
  }): KscType {
    const objType = this.inferExpr(expr.object);

    if (objType.kind === 'error') return ERROR_TYPE;

    if (objType.kind === 'object') {
      const fieldType = objType.fields.get(expr.property);
      if (!fieldType) {
        this.errors.push(makeError(
          E.NO_SUCH_PROPERTY,
          `Property '${expr.property}' does not exist on type '${typeToString(objType)}'`,
          expr.loc,
        ));
        return ERROR_TYPE;
      }
      return fieldType;
    }

    // array.length
    if (objType.kind === 'array' && expr.property === 'length') {
      return NUMBER_TYPE;
    }

    // array.push 等のメソッド
    if (objType.kind === 'array') {
      if (expr.property === 'push') {
        return { kind: 'function', params: [{ name: 'item', type: objType.element }], returnType: NUMBER_TYPE };
      }
      if (expr.property === 'pop') {
        return { kind: 'function', params: [], returnType: objType.element };
      }
      if (expr.property === 'indexOf') {
        return { kind: 'function', params: [{ name: 'item', type: objType.element }], returnType: NUMBER_TYPE };
      }
    }

    // string.length
    if (objType.kind === 'string' && expr.property === 'length') {
      return NUMBER_TYPE;
    }

    this.errors.push(makeError(
      E.NO_SUCH_PROPERTY,
      `Property '${expr.property}' does not exist on type '${typeToString(objType)}'`,
      expr.loc,
    ));
    return ERROR_TYPE;
  }

  private inferIndexExpr(expr: {
    object: Expression; index: Expression;
    loc: { line: number; column: number };
  }): KscType {
    const objType = this.inferExpr(expr.object);
    this.inferExpr(expr.index);

    if (objType.kind === 'error') return ERROR_TYPE;

    if (objType.kind === 'array') {
      return objType.element;
    }

    // string indexing → string
    if (objType.kind === 'string') {
      return STRING_TYPE;
    }

    return ERROR_TYPE;
  }

  private inferTernaryExpr(expr: {
    condition: Expression; consequent: Expression; alternate: Expression;
    loc: { line: number; column: number };
  }): KscType {
    this.inferExpr(expr.condition);
    const consequentType = this.inferExpr(expr.consequent);
    const alternateType = this.inferExpr(expr.alternate);

    // 同じ型なら統一
    if (isAssignableTo(consequentType, alternateType)) return alternateType;
    if (isAssignableTo(alternateType, consequentType)) return consequentType;

    // union
    return { kind: 'union', members: [consequentType, alternateType] };
  }

  private inferArrayLiteral(expr: {
    elements: Expression[];
    loc: { line: number; column: number };
  }): KscType {
    if (expr.elements.length === 0) {
      return { kind: 'array', element: ERROR_TYPE };
    }

    const elementTypes = expr.elements.map(e => this.inferExpr(e));
    // 最初の要素の型を基準
    const baseType = elementTypes[0];
    return { kind: 'array', element: baseType };
  }

  private inferObjectLiteral(expr: {
    fields: { key: string; value: Expression }[];
    loc: { line: number; column: number };
  }): KscType {
    const fields = new Map<string, KscType>();
    for (const f of expr.fields) {
      fields.set(f.key, this.inferExpr(f.value));
    }
    return { kind: 'object', fields };
  }

  private inferAwaitExpr(expr: {
    argument: Expression;
    loc: { line: number; column: number };
  }): KscType {
    const argType = this.inferExpr(expr.argument);

    if (argType.kind === 'error') return ERROR_TYPE;

    if (argType.kind === 'promise') {
      return argType.inner;
    }

    this.errors.push(makeError(
      E.AWAIT_NON_PROMISE,
      `'await' expression requires a Promise, but got '${typeToString(argType)}'`,
      expr.loc,
    ));
    return ERROR_TYPE;
  }

  // ---- Helpers ----

  private resolveType(ann: TypeAnnotation): KscType {
    return resolveAnnotation(ann, this.typeAliases);
  }
}
