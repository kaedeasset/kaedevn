import { TokenType } from '../types/token.js';
import {
  Statement, Expression, TypeAnnotation,
  VariableDecl, FunctionDecl, FunctionParam, ReturnStmt, BlockStmt, SourceLocation,
} from '../types/ast.js';
import { ParseError } from './cursor.js';
import { StatementParser } from './statements.js';

// ---- Class metadata for inheritance (Phase 1 #13 V1.1) ----
//
// When a class declares `extends ParentName`, we look up ParentName
// in the parser's metadata map to inherit its fields and methods. The map
// is local to each `parse()` invocation — separate KSC modules don't share
// state.
//
// Inheritance is implemented by *flattening* at parse time:
//   - Child inherits all parent fields + methods (child overrides by name)
//   - For overridden methods, child's instance object also gets a hidden
//     `__super_<name>__` field pointing to the parent's emitted function,
//     so `super.method()` can dispatch via CALL_METHOD without VM changes
//   - No prototype chain at runtime; each instance is a flat KscObject
//
// This approach keeps the VM's CALL_METHOD opcode unchanged — function
// index in numeric field, this auto-bound — and is inherently single-
// dispatch. Multiple inheritance / mixins are out of scope for V1.1.
interface ClassMethodMeta {
  name: string;
  params: { name: string; type: TypeAnnotation }[];
  returnType: TypeAnnotation;
  /** "__ClassName_methodName__" — the top-level FunctionDecl this binds to. */
  emittedName: string;
}
interface ClassFieldMeta {
  name: string;
  type: TypeAnnotation;
  init: Expression | null;
}
interface ClassMeta {
  name: string;
  fields: ClassFieldMeta[];
  methods: ClassMethodMeta[];
  parentName: string | null;
}

interface MethodEntry {
  name: string;
  params: FunctionParam[];
  returnType: TypeAnnotation;
  body: BlockStmt;
}
/** What the class body `{ ... }` declares by itself. */
interface ClassMembers {
  fields: ClassFieldMeta[];
  methods: MethodEntry[];
  ctorParams: FunctionParam[];
  ctorBody: Statement[];
}
interface MergedMethod {
  name: string;
  params: FunctionParam[];
  returnType: TypeAnnotation;
  emittedName: string;
  isOwn: boolean;  // true → emit a top-level FunctionDecl
  body: BlockStmt | null;  // present for own methods only
}

function cloneParams(params: { name: string; type: TypeAnnotation }[]): FunctionParam[] {
  return params.map(p => ({ name: p.name, type: p.type }));
}

// Phase 1 #7: class declaration → factory function lowering.
//
// Lowering example:
//   class Player {
//     hp: number = 100;
//     x: number = 0;
//     constructor(initX: number) { this.x = initX; }
//   }
//
// becomes the single FunctionDecl:
//   function Player(initX: number): { hp: number; x: number } {
//     const this: { hp: number; x: number } = { hp: 100, x: 0 };
//     this.x = initX;
//     return this;
//   }
//
// The synthetic local is named `this` (matching the keyword the user
// typed) so user-visible references resolve naturally. KSC's checker
// and emitter use name-based variable lookup, so 'this' as a local
// works without VM changes.
function defaultValueForType(type: TypeAnnotation, l: SourceLocation): Expression {
  if (type.kind === 'named') {
    if (type.name === 'number') return { kind: 'NumberLiteral', value: 0, loc: l };
    if (type.name === 'string') return { kind: 'StringLiteral', value: '', loc: l };
    if (type.name === 'boolean') return { kind: 'BooleanLiteral', value: false, loc: l };
    if (type.name === 'null')   return { kind: 'NullLiteral', loc: l };
    if (type.name === 'undefined') return { kind: 'UndefinedLiteral', loc: l };
  }
  if (type.kind === 'array') return { kind: 'ArrayLiteral', elements: [], loc: l };
  if (type.kind === 'object') {
    return {
      kind: 'ObjectLiteral',
      fields: type.fields.map(f => ({ key: f.name, value: defaultValueForType(f.type, l) })),
      loc: l,
    };
  }
  if (type.kind === 'union' && type.members.length > 0) {
    return defaultValueForType(type.members[0], l);
  }
  // Fallback for literal / promise — null is the safest default.
  return { kind: 'NullLiteral', loc: l };
}

/** Class declarations, lowered to a factory function + one function per method. */
export class ClassParser extends StatementParser {
  private readonly classMetadata = new Map<string, ClassMeta>();

  protected parseClassDecl(exported: boolean): Statement[] {
    const l = this.loc();
    this.expect(TokenType.Class);
    const className = this.expect(TokenType.Identifier).value;

    // V1.1: `extends ParentClass` for single inheritance.
    let parentName: string | null = null;
    let parentMeta: ClassMeta | null = null;
    if (this.match(TokenType.Extends)) {
      const parentLoc = this.loc();
      parentName = this.expect(TokenType.Identifier).value;
      parentMeta = this.classMetadata.get(parentName) ?? null;
      if (!parentMeta) {
        throw new ParseError(
          `Cannot extend unknown class '${parentName}' — it must be declared ` +
          `before '${className}' in the same file (or imported).`,
          parentLoc.line, parentLoc.column,
        );
      }
    }

    this.expect(TokenType.LBrace);

    // Push class-parsing context (used by parsePrimary for super resolution).
    const prevClassName    = this.currentClassName;
    const prevSuperParent  = this.currentSuperParent;
    this.currentClassName   = className;
    this.currentSuperParent = parentName;

    const members = this.parseClassMembers(className);
    this.expect(TokenType.RBrace);

    // Restore parser context.
    this.currentClassName   = prevClassName;
    this.currentSuperParent = prevSuperParent;

    const { mergedFields, mergedMethods } = mergeClassMembers(className, parentMeta, members, l);

    // Register this class for grandchildren before we build the AST.
    this.classMetadata.set(className, {
      name: className,
      fields: mergedFields,
      methods: mergedMethods.map(m => ({
        name: m.name,
        params: cloneParams(m.params),
        returnType: m.returnType,
        emittedName: m.emittedName,
      })),
      parentName,
    });

    return buildClassDecls(className, exported, members, mergedFields, mergedMethods, l);
  }

  /** Fields, methods and the constructor between `{` and `}`. */
  private parseClassMembers(className: string): ClassMembers {
    const members: ClassMembers = { fields: [], methods: [], ctorParams: [], ctorBody: [] };
    let sawCtor = false;

    while (!this.check(TokenType.RBrace) && !this.check(TokenType.EOF)) {
      // Constructor: parsed as identifier 'constructor' followed by '('.
      if (this.check(TokenType.Identifier) && this.current().value === 'constructor') {
        if (sawCtor) {
          throw new ParseError(
            `Class '${className}' has multiple constructors`,
            this.current().line, this.current().column,
          );
        }
        sawCtor = true;
        this.advance();
        this.expect(TokenType.LParen);
        members.ctorParams = this.parseParamList();
        this.expect(TokenType.RParen);
        members.ctorBody = this.parseBlockStmt().body;
        continue;
      }

      // Method: identifier followed by '(' — name(params): retType { body }
      // Phase 1 #13 V1: lifts to a top-level FunctionDecl with `this`
      // pre-defined in scope; the factory stores the function reference
      // in the corresponding instance field.
      if (this.check(TokenType.Identifier) && this.peekNext() === TokenType.LParen) {
        const mName = this.expect(TokenType.Identifier).value;
        this.expect(TokenType.LParen);
        const mParams = this.parseParamList();
        this.expect(TokenType.RParen);
        let mReturnType: TypeAnnotation = { kind: 'named', name: 'void' };
        if (this.match(TokenType.Colon)) {
          mReturnType = this.parseTypeAnnotation();
        }
        const mBody = this.parseBlockStmt();
        members.methods.push({ name: mName, params: mParams, returnType: mReturnType, body: mBody });
        continue;
      }

      // Field declaration: name: Type = init?
      const fName = this.expect(TokenType.Identifier).value;
      this.expect(TokenType.Colon);
      const fType = this.parseTypeAnnotation();
      let fInit: Expression | null = null;
      if (this.match(TokenType.Assign)) {
        fInit = this.parseExpression();
      }
      this.match(TokenType.Semicolon);
      members.fields.push({ name: fName, type: fType, init: fInit });
    }
    return members;
  }
}

// V1.1: merge parent fields/methods into this class.
//
//   - Parent fields are inherited unless the child redeclares them
//   - Parent methods are inherited unless the child redeclares them
//   - Overridden methods get a hidden `__super_<name>__` field so the
//     child's body can call `super.method()` via CALL_METHOD
function mergeClassMembers(
  className: string,
  parentMeta: ClassMeta | null,
  members: ClassMembers,
  l: SourceLocation,
): { mergedFields: ClassFieldMeta[]; mergedMethods: MergedMethod[] } {
  const { fields, methods } = members;
  const ownMethodNames = new Set(methods.map(m => m.name));
  const ownFieldNames  = new Set(fields.map(f => f.name));

  const mergedFields: ClassFieldMeta[] = [];
  const mergedMethods: MergedMethod[] = [];

  // 1) Inherit from parent (skip names overridden by child).
  if (parentMeta) {
    for (const pf of parentMeta.fields) {
      if (!ownFieldNames.has(pf.name)) mergedFields.push(pf);
    }
    for (const pm of parentMeta.methods) {
      if (!ownMethodNames.has(pm.name)) {
        mergedMethods.push({
          name: pm.name,
          params: cloneParams(pm.params),
          returnType: pm.returnType,
          emittedName: pm.emittedName,
          isOwn: false,
          body: null,
        });
      }
    }
  }

  // 2) Append own members.
  for (const f of fields) mergedFields.push(f);
  for (const m of methods) {
    mergedMethods.push({
      name: m.name,
      params: m.params,
      returnType: m.returnType,
      emittedName: `__${className}_${m.name}__`,
      isOwn: true,
      body: m.body,
    });
  }

  // 3) Hidden super dispatch fields (for overridden methods). They are real
  // fields on the instance object, so they go into mergedFields and get
  // inherited by grandchildren through the parent-fields loop above (next
  // class's parse).
  if (parentMeta) {
    for (const m of methods) {
      const parentMethod = parentMeta.methods.find(pm => pm.name === m.name);
      if (parentMethod) {
        // Qualified by *current* class name so multi-level overrides
        // don't collide. C's __super_C_M__ → B's M; B's __super_B_M__
        // → A's M (separate field, inherited from B's parse).
        mergedFields.push({
          name: `__super_${className}_${m.name}__`,
          type: {
            kind: 'function',
            params: cloneParams(parentMethod.params),
            returnType: parentMethod.returnType,
          },
          init: { kind: 'Identifier', name: parentMethod.emittedName, loc: l } as Expression,
        });
      }
    }
  }

  return { mergedFields, mergedMethods };
}

/** Own method FunctionDecls followed by the factory FunctionDecl. */
function buildClassDecls(
  className: string,
  exported: boolean,
  members: ClassMembers,
  mergedFields: ClassFieldMeta[],
  mergedMethods: MergedMethod[],
  l: SourceLocation,
): Statement[] {
  // Build the instance type annotation. mergedFields includes the own +
  // inherited regular fields AND the hidden __super_<Class>_<m>__
  // function-typed entries, so we just spread it.
  const instanceType: TypeAnnotation = {
    kind: 'object',
    fields: [
      ...mergedFields.map(f => ({ name: f.name, type: f.type })),
      ...mergedMethods.map(m => ({
        name: m.name,
        type: {
          kind: 'function',
          params: cloneParams(m.params),
          returnType: m.returnType,
        } as TypeAnnotation,
      })),
    ],
  };

  // Emit top-level FunctionDecls only for own methods; inherited ones
  // are already top-level from the parent's parse.
  const methodDecls: FunctionDecl[] = mergedMethods
    .filter(m => m.isOwn && m.body !== null)
    .map(m => ({
      kind: 'FunctionDecl',
      name: m.emittedName,
      params: m.params,
      returnType: m.returnType,
      body: m.body!,
      exported: false,
      thisType: instanceType,
      loc: l,
    }));

  // Build the initial object literal. Hidden __super_<Class>_<m>__
  // fields are already in mergedFields with init = Identifier(parent
  // emitted name).
  const initLiteral: Expression = {
    kind: 'ObjectLiteral',
    fields: [
      ...mergedFields.map(f => ({
        key: f.name,
        value: f.init ?? defaultValueForType(f.type, l),
      })),
      ...mergedMethods.map(m => ({
        key: m.name,
        value: { kind: 'Identifier', name: m.emittedName, loc: l } as Expression,
      })),
    ],
    loc: l,
  };

  // const this: <instanceType> = <initLiteral>;
  const thisDecl: VariableDecl = {
    kind: 'VariableDecl',
    name: 'this',
    mutable: false,
    typeAnnotation: instanceType,
    init: initLiteral,
    exported: false,
    loc: l,
  };

  // return this;
  const returnThis: ReturnStmt = {
    kind: 'ReturnStmt',
    value: { kind: 'Identifier', name: 'this', loc: l },
    loc: l,
  };

  const factory: FunctionDecl = {
    kind: 'FunctionDecl',
    name: className,
    params: members.ctorParams,
    returnType: instanceType,
    body: { kind: 'BlockStmt', body: [thisDecl, ...members.ctorBody, returnThis], loc: l },
    exported,
    loc: l,
  };

  // Method decls come BEFORE the factory so they're registered as
  // top-level functions when Pass 1 of the checker walks the program
  // body; the factory's object literal references them by Identifier
  // name and resolves at LOAD_VAR time.
  return [...methodDecls, factory];
}
