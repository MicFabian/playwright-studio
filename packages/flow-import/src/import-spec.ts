import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type Expression,
  type SourceFile,
  type Statement,
} from 'ts-morph';
import {
  FLOW_FORMAT_VERSION,
  type AssertionIR,
  type FlowDocument,
  type FlowStep,
  type LocatorRef,
  type LocatorTarget,
  type PageAssertionIR,
  type Sequence,
  type ValueExpr,
} from '../../flow-core/src/ir';

export type ImportFidelity = 'structured' | 'mixed' | 'opaque';

export interface ImportDiagnostic {
  severity: 'warning' | 'info';
  code: string;
  message: string;
  line: number;
}

export interface ImportedTest {
  document: FlowDocument;
  fidelity: ImportFidelity;
  structuredSteps: number;
  opaqueSteps: number;
  diagnostics: ImportDiagnostic[];
}

export interface ImportResult {
  tests: ImportedTest[];
  scaffold: string[];
  diagnostics: ImportDiagnostic[];
}

const TEXT_LOCATORS: Record<string, LocatorRef['by']> = {
  getByLabel: 'label',
  getByPlaceholder: 'placeholder',
  getByText: 'text',
  getByAltText: 'altText',
  getByTitle: 'title',
};

let stepCounter = 0;

function nextStepId(prefix: string): string {
  stepCounter += 1;
  return `${prefix}-${stepCounter}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'imported-flow';
}

function literalText(expression: Expression | undefined): string | null {
  if (!expression) {
    return null;
  }

  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.getLiteralText();
  }

  return null;
}

function valueOf(expression: Expression | undefined): ValueExpr | null {
  const text = literalText(expression);

  if (text != null) {
    return { source: 'literal', value: text };
  }

  if (expression && Node.isIdentifier(expression)) {
    return { source: 'variable', name: expression.getText() };
  }

  if (
    expression &&
    Node.isPropertyAccessExpression(expression) &&
    expression.getExpression().getText() === 'process.env'
  ) {
    return { source: 'env', name: expression.getName() };
  }

  if (expression && Node.isElementAccessExpression(expression)) {
    const target = expression.getExpression().getText();
    const argument = literalText(expression.getArgumentExpression() as Expression);

    if (target === 'process.env' && argument) {
      return { source: 'env', name: argument };
    }
  }

  return null;
}

interface LocatorChain {
  target: LocatorTarget;
  root: string;
}

function readLocatorChain(expression: Expression): LocatorChain | null {
  if (!Node.isCallExpression(expression)) {
    return null;
  }

  const callee = expression.getExpression();

  if (!Node.isPropertyAccessExpression(callee)) {
    return null;
  }

  const method = callee.getName();
  const receiver = callee.getExpression();
  const args = expression.getArguments() as Expression[];

  if (method === 'nth' || method === 'first' || method === 'last' || method === 'filter') {
    const inner = readLocatorChain(receiver);

    if (!inner) {
      return null;
    }

    if (method === 'first') {
      return { ...inner, target: { ...inner.target, nth: 0 } };
    }

    if (method === 'nth') {
      const index = Number(args[0]?.getText());
      return Number.isFinite(index)
        ? { ...inner, target: { ...inner.target, nth: index } }
        : null;
    }

    if (method === 'filter') {
      const options = args[0];

      if (options && Node.isObjectLiteralExpression(options)) {
        const hasText = options.getProperty('hasText');

        if (hasText && Node.isPropertyAssignment(hasText)) {
          const value = valueOf(hasText.getInitializer() as Expression);

          if (value) {
            return { ...inner, target: { ...inner.target, hasText: value } };
          }
        }
      }

      return null;
    }

    return inner;
  }

  const root = receiver.getText();

  if (method === 'getByRole') {
    const role = literalText(args[0]);

    if (!role) {
      return null;
    }

    const base: LocatorRef = { by: 'role', role: role as never };
    const options = args[1];

    if (options && Node.isObjectLiteralExpression(options)) {
      const name = options.getProperty('name');

      if (name && Node.isPropertyAssignment(name)) {
        const value = valueOf(name.getInitializer() as Expression);

        if (value) {
          (base as { name?: ValueExpr }).name = value;
        }
      }

      const exact = options.getProperty('exact');

      if (exact && Node.isPropertyAssignment(exact) && exact.getInitializer()?.getText() === 'true') {
        (base as { exact?: boolean }).exact = true;
      }
    }

    return { target: { base }, root };
  }

  if (method === 'getByTestId') {
    const value = valueOf(args[0]);
    return value ? { target: { base: { by: 'testId', value } }, root } : null;
  }

  if (method in TEXT_LOCATORS) {
    const value = valueOf(args[0]);
    return value
      ? { target: { base: { by: TEXT_LOCATORS[method], text: value } }, root }
      : null;
  }

  if (method === 'locator') {
    const value = valueOf(args[0]);
    return value ? { target: { base: { by: 'css', selector: value } }, root } : null;
  }

  return null;
}

function readAssertion(call: CallExpression): FlowStep | null {
  const callee = call.getExpression();

  if (!Node.isPropertyAccessExpression(callee)) {
    return null;
  }

  let matcher = callee.getName();
  let subjectHolder = callee.getExpression();
  let negated = false;

  if (Node.isPropertyAccessExpression(subjectHolder) && subjectHolder.getName() === 'not') {
    negated = true;
    subjectHolder = subjectHolder.getExpression();
  }

  if (!Node.isCallExpression(subjectHolder)) {
    return null;
  }

  if (subjectHolder.getExpression().getText() !== 'expect') {
    return null;
  }

  const subject = subjectHolder.getArguments()[0] as Expression | undefined;

  if (!subject) {
    return null;
  }

  const args = call.getArguments() as Expression[];
  const id = nextStepId('assert');

  if (subject.getText() === 'page') {
    const value = valueOf(args[0]);

    if (!value) {
      return null;
    }

    const assertion: PageAssertionIR | null =
      matcher === 'toHaveURL'
        ? { type: 'url', value, ...(negated ? { negated } : {}) }
        : matcher === 'toHaveTitle'
          ? { type: 'title', value, ...(negated ? { negated } : {}) }
          : null;

    return assertion ? { id, kind: 'assertPage', assertion } : null;
  }

  const chain = readLocatorChain(subject);

  if (!chain) {
    return null;
  }

  const build = (): AssertionIR | null => {
    switch (matcher) {
      case 'toBeVisible':
        return { type: 'visible', ...(negated ? { negated } : {}) };
      case 'toBeHidden':
        return negated ? { type: 'visible' } : { type: 'hidden' };
      case 'toBeEnabled':
        return { type: 'enabled', ...(negated ? { negated } : {}) };
      case 'toBeChecked':
        return { type: 'checked', ...(negated ? { negated } : {}) };
      case 'toContainText': {
        const text = valueOf(args[0]);
        return text ? { type: 'containsText', text, ...(negated ? { negated } : {}) } : null;
      }
      case 'toHaveText': {
        const text = valueOf(args[0]);
        return text ? { type: 'hasText', text, ...(negated ? { negated } : {}) } : null;
      }
      case 'toHaveValue': {
        const value = valueOf(args[0]);
        return value ? { type: 'hasValue', value, ...(negated ? { negated } : {}) } : null;
      }
      case 'toHaveCount': {
        const count = Number(args[0]?.getText());
        return Number.isFinite(count)
          ? { type: 'hasCount', count, ...(negated ? { negated } : {}) }
          : null;
      }
      default:
        return null;
    }
  };

  const assertion = build();
  return assertion ? { id, kind: 'assert', target: chain.target, assertion } : null;
}

function readAction(call: CallExpression): FlowStep | null {
  const callee = call.getExpression();

  if (!Node.isPropertyAccessExpression(callee)) {
    return null;
  }

  const method = callee.getName();
  const receiver = callee.getExpression();
  const args = call.getArguments() as Expression[];
  const id = nextStepId(method);

  if (receiver.getText() === 'page' && method === 'goto') {
    const url = valueOf(args[0]);
    return url ? { id, kind: 'navigate', url } : null;
  }

  const chain = readLocatorChain(receiver);

  if (!chain) {
    return null;
  }

  switch (method) {
    case 'click':
      return { id, kind: 'click', target: chain.target };
    case 'hover':
      return { id, kind: 'hover', target: chain.target };
    case 'check':
      return { id, kind: 'check', target: chain.target, checked: true };
    case 'uncheck':
      return { id, kind: 'check', target: chain.target, checked: false };
    case 'fill': {
      const value = valueOf(args[0]);
      return value ? { id, kind: 'fill', target: chain.target, value } : null;
    }
    case 'selectOption': {
      const value = valueOf(args[0]);
      return value ? { id, kind: 'selectOption', target: chain.target, value } : null;
    }
    case 'press': {
      const key = literalText(args[0]);
      return key ? { id, kind: 'press', target: chain.target, key } : null;
    }
    default:
      return null;
  }
}

interface ConversionContext {
  diagnostics: ImportDiagnostic[];
  structured: number;
  opaque: number;
}

function opaqueStep(statement: Statement, context: ConversionContext, code: string): FlowStep {
  context.opaque += 1;
  context.diagnostics.push({
    severity: 'warning',
    code: 'opaque-statement',
    message: `Kept as custom code: ${code.split('\n')[0].slice(0, 80)}`,
    line: statement.getStartLineNumber(),
  });

  return { id: nextStepId('code'), kind: 'code', code };
}

function unwrapAwait(expression: Expression): Expression {
  return Node.isAwaitExpression(expression) ? expression.getExpression() : expression;
}

function convertStatements(statements: Statement[], context: ConversionContext): Sequence {
  const steps: FlowStep[] = [];

  for (const statement of statements) {
    const text = statement.getText().trim();

    if (Node.isExpressionStatement(statement)) {
      const expression = unwrapAwait(statement.getExpression());

      if (Node.isCallExpression(expression)) {
        const callee = expression.getExpression();

        if (
          Node.isPropertyAccessExpression(callee) &&
          callee.getExpression().getText() === 'test' &&
          callee.getName() === 'step'
        ) {
          const label = literalText(expression.getArguments()[0] as Expression);
          const body = expression.getArguments()[1];

          if (body && (Node.isArrowFunction(body) || Node.isFunctionExpression(body))) {
            const inner = body.getBody();
            const nested = Node.isBlock(inner)
              ? convertStatements(inner.getStatements(), context)
              : { steps: [] };

            if (nested.steps.length === 1 && label) {
              steps.push({ ...nested.steps[0], label });
              continue;
            }

            steps.push(...nested.steps);
            continue;
          }
        }

        const action = readAction(expression) ?? readAssertion(expression);

        if (action) {
          context.structured += 1;
          steps.push(action);
          continue;
        }
      }

      steps.push(opaqueStep(statement, context, text));
      continue;
    }

    if (Node.isIfStatement(statement)) {
      const condition = unwrapAwait(statement.getExpression());
      const thenBlock = statement.getThenStatement();
      const elseBlock = statement.getElseStatement();

      let predicate: FlowStep | null = null;
      let visibilityTarget: LocatorTarget | null = null;
      let negated = false;

      let probe: Expression = condition;

      if (Node.isPrefixUnaryExpression(probe) && probe.getOperatorToken() === SyntaxKind.ExclamationToken) {
        negated = true;
        probe = unwrapAwait(probe.getOperand());
      }

      if (Node.isParenthesizedExpression(probe)) {
        probe = unwrapAwait(probe.getExpression());
      }

      if (Node.isCallExpression(probe)) {
        const callee = probe.getExpression();

        if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'isVisible') {
          const chain = readLocatorChain(callee.getExpression());
          visibilityTarget = chain?.target ?? null;
        }
      }

      const thenSequence = Node.isBlock(thenBlock)
        ? convertStatements(thenBlock.getStatements(), context)
        : convertStatements([thenBlock], context);

      const elseSequence =
        elseBlock && Node.isBlock(elseBlock)
          ? convertStatements(elseBlock.getStatements(), context)
          : elseBlock
            ? convertStatements([elseBlock], context)
            : null;

      if (visibilityTarget) {
        context.structured += 1;
        steps.push({
          id: nextStepId('condition'),
          kind: 'condition',
          predicate: {
            type: 'locatorVisible',
            target: visibilityTarget,
            ...(negated ? { negated } : {}),
          },
          then: thenSequence,
          ...(elseSequence ? { else: elseSequence } : {}),
        });
        continue;
      }

      context.structured += 1;
      steps.push({
        id: nextStepId('condition'),
        kind: 'condition',
        predicate: { type: 'expression', code: condition.getText() },
        then: thenSequence,
        ...(elseSequence ? { else: elseSequence } : {}),
      });
      continue;
    }

    if (Node.isForOfStatement(statement)) {
      const initializer = statement.getInitializer();
      const itemName = Node.isVariableDeclarationList(initializer)
        ? initializer.getDeclarations()[0]?.getName()
        : null;
      const source = valueOf(statement.getExpression());
      const body = statement.getStatement();
      const sequence = Node.isBlock(body)
        ? convertStatements(body.getStatements(), context)
        : convertStatements([body], context);

      if (itemName && source) {
        context.structured += 1;
        steps.push({ id: nextStepId('loop'), kind: 'loop', source, itemName, body: sequence });
        continue;
      }

      steps.push(opaqueStep(statement, context, text));
      continue;
    }

    if (Node.isTryStatement(statement)) {
      const body = convertStatements(statement.getTryBlock().getStatements(), context);
      const catchClause = statement.getCatchClause();
      const finallyBlock = statement.getFinallyBlock();

      context.structured += 1;
      steps.push({
        id: nextStepId('try'),
        kind: 'try',
        body,
        ...(catchClause
          ? {
              catch: {
                errorName: catchClause.getVariableDeclaration()?.getName() ?? 'error',
                body: convertStatements(catchClause.getBlock().getStatements(), context),
              },
            }
          : {}),
        ...(finallyBlock
          ? { finally: convertStatements(finallyBlock.getStatements(), context) }
          : {}),
      });
      continue;
    }

    if (Node.isVariableStatement(statement)) {
      const declaration = statement.getDeclarationList().getDeclarations()[0];
      const name = declaration?.getName();
      const initializer = declaration?.getInitializer();

      if (name && initializer) {
        const expression = unwrapAwait(initializer);

        if (Node.isCallExpression(expression)) {
          const callee = expression.getExpression();

          if (Node.isPropertyAccessExpression(callee)) {
            const method = callee.getName();
            const chain = readLocatorChain(callee.getExpression());

            if (chain && (method === 'textContent' || method === 'inputValue' || method === 'count')) {
              context.structured += 1;
              steps.push({
                id: nextStepId('extract'),
                kind: 'extract',
                target: chain.target,
                variable: name,
                property:
                  method === 'inputValue' ? 'inputValue' : method === 'count' ? 'count' : 'text',
              });
              continue;
            }
          }
        }
      }

      steps.push(opaqueStep(statement, context, text));
      continue;
    }

    steps.push(opaqueStep(statement, context, text));
  }

  return { steps };
}

function fidelityOf(structured: number, opaque: number): ImportFidelity {
  if (opaque === 0 && structured > 0) {
    return 'structured';
  }

  if (structured === 0) {
    return 'opaque';
  }

  return 'mixed';
}

function collectTestCalls(sourceFile: SourceFile): CallExpression[] {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const callee = call.getExpression();

      if (Node.isIdentifier(callee) && callee.getText() === 'test') {
        return true;
      }

      return (
        Node.isPropertyAccessExpression(callee) &&
        callee.getExpression().getText() === 'test' &&
        ['only', 'fixme', 'skip'].includes(callee.getName())
      );
    })
    .filter((call) => {
      const args = call.getArguments();
      return args.length >= 2 && literalText(args[0] as Expression) != null;
    });
}

export function importSpecSource(source: string, fileName = 'imported.spec.ts'): ImportResult {
  stepCounter = 0;

  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const sourceFile = project.createSourceFile(fileName, source);
  const diagnostics: ImportDiagnostic[] = [];
  const scaffold: string[] = [];

  sourceFile.getImportDeclarations().forEach((declaration) => {
    scaffold.push(declaration.getText());
  });

  const testCalls = collectTestCalls(sourceFile);

  if (testCalls.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'no-tests',
      message: 'No top-level test() calls were found in this file.',
      line: 1,
    });
  }

  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
    const callee = call.getExpression();

    if (
      Node.isPropertyAccessExpression(callee) &&
      ['beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'describe', 'use'].includes(
        callee.getName(),
      )
    ) {
      diagnostics.push({
        severity: 'info',
        code: 'hook-preserved',
        message: `${callee.getName()} was not imported and stays in the source scaffold.`,
        line: call.getStartLineNumber(),
      });
    }
  });

  const tests: ImportedTest[] = testCalls.map((call) => {
    const name = literalText(call.getArguments()[0] as Expression) ?? 'Imported test';
    const body = call.getArguments().at(-1);
    const context: ConversionContext = { diagnostics: [], structured: 0, opaque: 0 };

    let root: Sequence = { steps: [] };

    if (body && (Node.isArrowFunction(body) || Node.isFunctionExpression(body))) {
      const inner = body.getBody();

      if (Node.isBlock(inner)) {
        root = convertStatements(inner.getStatements(), context);
      }
    }

    return {
      document: {
        formatVersion: FLOW_FORMAT_VERSION,
        id: slugify(name),
        name,
        status: 'draft',
        root,
        layout: { positions: {} },
      },
      fidelity: fidelityOf(context.structured, context.opaque),
      structuredSteps: context.structured,
      opaqueSteps: context.opaque,
      diagnostics: context.diagnostics,
    };
  });

  return { tests, scaffold, diagnostics };
}
