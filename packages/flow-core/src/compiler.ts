import {
  type AssertStep,
  type AssertionIR,
  type CallStep,
  type CheckStep,
  type ClickStep,
  type CodeStep,
  type CommentStep,
  type CompileResult,
  type CompilerDiagnostic,
  type ConditionStep,
  type ExtractStep,
  type FillStep,
  type FlowDocument,
  type FlowStep,
  type HoverStep,
  type LocatorRef,
  type LocatorTarget,
  type LoopStep,
  type NavigateStep,
  type PageAssertionIR,
  type PredicateIR,
  type PressStep,
  type SelectOptionStep,
  type Sequence,
  type SourceLocation,
  type TryStep,
  type ValueExpr,
  type AssertPageStep,
} from './ir';

export type CompileProfile = 'commit' | 'studio-run';

export interface CompileOptions {
  profile?: CompileProfile;
  testImport?: string;
}

const RESERVED_IDENTIFIERS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'expect',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'page',
  'return',
  'super',
  'switch',
  'test',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

function quote(value: string): string {
  return JSON.stringify(value);
}

export function isValidIdentifier(candidate: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate) && !RESERVED_IDENTIFIERS.has(candidate);
}

class Emitter {
  private readonly lines: string[] = [];

  private indentLevel = 0;

  push(line: string): void {
    this.lines.push(line ? `${'  '.repeat(this.indentLevel)}${line}` : '');
  }

  indent(): void {
    this.indentLevel += 1;
  }

  dedent(): void {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
  }

  get nextLineNumber(): number {
    return this.lines.length + 1;
  }

  get lastLineNumber(): number {
    return this.lines.length;
  }

  toString(): string {
    return this.lines.join('\n');
  }
}

class Compiler {
  private readonly emitter = new Emitter();

  private readonly diagnostics: CompilerDiagnostic[] = [];

  private readonly stepLocations: Record<string, SourceLocation> = {};

  private readonly declaredVariables = new Set<string>();

  private readonly seenStepIds = new Set<string>();

  constructor(
    private readonly document: FlowDocument,
    private readonly profile: CompileProfile,
    private readonly testImport: string,
  ) {}

  private error(code: string, message: string, stepId?: string): void {
    this.diagnostics.push({ severity: 'error', code, message, stepId });
  }

  private warn(code: string, message: string, stepId?: string): void {
    this.diagnostics.push({ severity: 'warning', code, message, stepId });
  }

  private value(expr: ValueExpr | undefined, stepId: string): string {
    if (!expr) {
      return quote('');
    }

    switch (expr.source) {
      case 'literal':
        return quote(expr.value);
      case 'variable': {
        if (!isValidIdentifier(expr.name)) {
          this.error('invalid-variable', `"${expr.name}" is not a valid variable name.`, stepId);
          return quote('');
        }

        if (!this.declaredVariables.has(expr.name)) {
          this.error(
            'unknown-variable',
            `Variable "${expr.name}" is used before any step defines it.`,
            stepId,
          );
        }

        return expr.name;
      }
      case 'env': {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(expr.name)) {
          this.error('invalid-env', `"${expr.name}" is not a valid environment name.`, stepId);
          return quote('');
        }

        return `process.env[${quote(expr.name)}] ?? ''`;
      }
      default:
        return quote('');
    }
  }

  private locatorRef(ref: LocatorRef, stepId: string): string {
    switch (ref.by) {
      case 'role': {
        const options: string[] = [];

        if (ref.name) {
          options.push(`name: ${this.value(ref.name, stepId)}`);
        }

        if (ref.exact) {
          options.push('exact: true');
        }

        const suffix = options.length > 0 ? `, { ${options.join(', ')} }` : '';
        return `getByRole(${quote(ref.role)}${suffix})`;
      }
      case 'testId':
        return `getByTestId(${this.value(ref.value, stepId)})`;
      case 'label':
        return `getByLabel(${this.value(ref.text, stepId)}${ref.exact ? ', { exact: true }' : ''})`;
      case 'placeholder':
        return `getByPlaceholder(${this.value(ref.text, stepId)}${
          ref.exact ? ', { exact: true }' : ''
        })`;
      case 'text':
        return `getByText(${this.value(ref.text, stepId)}${ref.exact ? ', { exact: true }' : ''})`;
      case 'altText':
        return `getByAltText(${this.value(ref.text, stepId)}${
          ref.exact ? ', { exact: true }' : ''
        })`;
      case 'title':
        return `getByTitle(${this.value(ref.text, stepId)}${ref.exact ? ', { exact: true }' : ''})`;
      case 'css':
        return `locator(${this.value(ref.selector, stepId)})`;
      case 'xpath':
        return `locator(${this.value(ref.selector, stepId)})`;
      default:
        this.error('unknown-locator', 'Unsupported locator strategy.', stepId);
        return `locator(${quote('')})`;
    }
  }

  private locator(target: LocatorTarget | undefined, stepId: string): string {
    if (!target?.base) {
      this.error('missing-target', 'This step has no target element.', stepId);
      return `page.locator(${quote('')})`;
    }

    let expression = `page.${this.locatorRef(target.base, stepId)}`;

    if (target.hasText) {
      expression += `.filter({ hasText: ${this.value(target.hasText, stepId)} })`;
    }

    if (typeof target.nth === 'number') {
      expression += `.nth(${Math.trunc(target.nth)})`;
    }

    return expression;
  }

  private timeout(timeoutMs: number | undefined): string {
    return typeof timeoutMs === 'number' && timeoutMs > 0 ? `{ timeout: ${timeoutMs} }` : '';
  }

  private assertion(step: AssertStep): string {
    const locator = this.locator(step.target, step.id);
    const assertion: AssertionIR = step.assertion;
    const negated = 'negated' in assertion && assertion.negated ? '.not' : '';
    const subject = `expect(${locator})${negated}`;
    const timeout = this.timeout(step.timeoutMs);
    const withTimeout = (args: string[]) => [...args, timeout].filter(Boolean).join(', ');

    switch (assertion.type) {
      case 'visible':
        return `${subject}.toBeVisible(${withTimeout([])})`;
      case 'hidden':
        return `${subject}.toBeHidden(${withTimeout([])})`;
      case 'enabled':
        return `${subject}.toBeEnabled(${withTimeout([])})`;
      case 'checked':
        return `${subject}.toBeChecked(${withTimeout([])})`;
      case 'containsText':
        return `${subject}.toContainText(${withTimeout([this.value(assertion.text, step.id)])})`;
      case 'hasText':
        return `${subject}.toHaveText(${withTimeout([this.value(assertion.text, step.id)])})`;
      case 'hasValue':
        return `${subject}.toHaveValue(${withTimeout([this.value(assertion.value, step.id)])})`;
      case 'hasCount':
        return `${subject}.toHaveCount(${withTimeout([String(Math.trunc(assertion.count))])})`;
      default:
        this.error('unknown-assertion', 'Unsupported assertion.', step.id);
        return `${subject}.toBeVisible()`;
    }
  }

  private pageAssertion(step: AssertPageStep): string {
    const assertion: PageAssertionIR = step.assertion;
    const negated = assertion.negated ? '.not' : '';
    const timeout = this.timeout(step.timeoutMs);
    const args = [this.value(assertion.value, step.id), timeout].filter(Boolean).join(', ');

    return assertion.type === 'url'
      ? `expect(page)${negated}.toHaveURL(${args})`
      : `expect(page)${negated}.toHaveTitle(${args})`;
  }

  private predicate(predicate: PredicateIR, stepId: string): string {
    switch (predicate.type) {
      case 'locatorVisible': {
        const call = `await ${this.locator(predicate.target, stepId)}.isVisible()`;
        return predicate.negated ? `!(${call})` : call;
      }
      case 'locatorChecked': {
        const call = `await ${this.locator(predicate.target, stepId)}.isChecked()`;
        return predicate.negated ? `!(${call})` : call;
      }
      case 'expression': {
        const code = predicate.code.trim();

        if (!code) {
          this.error('empty-predicate', 'Condition has an empty expression.', stepId);
          return 'false';
        }

        return code;
      }
      default:
        this.error('unknown-predicate', 'Unsupported condition.', stepId);
        return 'false';
    }
  }

  private stepLabel(step: FlowStep): string {
    if (step.label && step.label.trim()) {
      return step.label.trim();
    }

    switch (step.kind) {
      case 'navigate':
        return 'Open page';
      case 'click':
        return 'Click';
      case 'fill':
        return 'Fill';
      case 'press':
        return 'Press key';
      case 'check':
        return step.checked ? 'Check' : 'Uncheck';
      case 'selectOption':
        return 'Select option';
      case 'hover':
        return 'Hover';
      case 'assert':
        return 'Assert element';
      case 'assertPage':
        return 'Assert page';
      case 'extract':
        return 'Extract value';
      case 'condition':
        return 'Condition';
      case 'loop':
        return 'Loop';
      case 'try':
        return 'Try';
      case 'call':
        return 'Call helper';
      case 'code':
        return 'Custom code';
      case 'comment':
        return 'Comment';
      default:
        return 'Step';
    }
  }

  private emitLeafBody(step: FlowStep): void {
    switch (step.kind) {
      case 'navigate': {
        const navigate = step as NavigateStep;
        const options = navigate.waitUntil ? `, { waitUntil: ${quote(navigate.waitUntil)} }` : '';
        this.emitter.push(`await page.goto(${this.value(navigate.url, step.id)}${options});`);
        return;
      }
      case 'click': {
        const click = step as ClickStep;
        const options: string[] = [];

        if (click.button && click.button !== 'left') {
          options.push(`button: ${quote(click.button)}`);
        }

        if (click.clickCount && click.clickCount > 1) {
          options.push(`clickCount: ${Math.trunc(click.clickCount)}`);
        }

        if (click.force) {
          options.push('force: true');
        }

        if (click.timeoutMs) {
          options.push(`timeout: ${Math.trunc(click.timeoutMs)}`);
        }

        const suffix = options.length > 0 ? `{ ${options.join(', ')} }` : '';
        this.emitter.push(`await ${this.locator(click.target, step.id)}.click(${suffix});`);
        return;
      }
      case 'fill': {
        const fill = step as FillStep;
        const timeout = fill.timeoutMs ? `, { timeout: ${Math.trunc(fill.timeoutMs)} }` : '';
        this.emitter.push(
          `await ${this.locator(fill.target, step.id)}.fill(${this.value(
            fill.value,
            step.id,
          )}${timeout});`,
        );
        return;
      }
      case 'press': {
        const press = step as PressStep;

        if (!press.key) {
          this.error('missing-key', 'Press step has no key.', step.id);
        }

        this.emitter.push(
          `await ${this.locator(press.target, step.id)}.press(${quote(press.key || '')});`,
        );
        return;
      }
      case 'check': {
        const check = step as CheckStep;
        this.emitter.push(
          `await ${this.locator(check.target, step.id)}.${check.checked ? 'check' : 'uncheck'}();`,
        );
        return;
      }
      case 'selectOption': {
        const select = step as SelectOptionStep;
        this.emitter.push(
          `await ${this.locator(select.target, step.id)}.selectOption(${this.value(
            select.value,
            step.id,
          )});`,
        );
        return;
      }
      case 'hover': {
        const hover = step as HoverStep;
        this.emitter.push(`await ${this.locator(hover.target, step.id)}.hover();`);
        return;
      }
      case 'assert':
        this.emitter.push(`await ${this.assertion(step as AssertStep)};`);
        return;
      case 'assertPage':
        this.emitter.push(`await ${this.pageAssertion(step as AssertPageStep)};`);
        return;
      case 'extract': {
        const extract = step as ExtractStep;

        if (!isValidIdentifier(extract.variable)) {
          this.error(
            'invalid-variable',
            `"${extract.variable}" is not a valid variable name.`,
            step.id,
          );
          return;
        }

        const locator = this.locator(extract.target, step.id);
        const accessor =
          extract.property === 'inputValue'
            ? 'inputValue()'
            : extract.property === 'count'
              ? 'count()'
              : 'textContent()';

        this.declaredVariables.add(extract.variable);
        this.emitter.push(`const ${extract.variable} = await ${locator}.${accessor};`);
        return;
      }
      case 'call': {
        const call = step as CallStep;

        if (!call.target.trim()) {
          this.error('missing-call-target', 'Call step has no target.', step.id);
          return;
        }

        const args = call.args.map((arg) => this.value(arg, step.id)).join(', ');
        const invocation = `await ${call.target}(${args});`;

        if (call.assignTo) {
          if (!isValidIdentifier(call.assignTo)) {
            this.error(
              'invalid-variable',
              `"${call.assignTo}" is not a valid variable name.`,
              step.id,
            );
            return;
          }

          this.declaredVariables.add(call.assignTo);
          this.emitter.push(`const ${call.assignTo} = ${invocation}`);
          return;
        }

        this.emitter.push(invocation);
        return;
      }
      case 'code': {
        const codeStep = step as CodeStep;
        const code = codeStep.code.trimEnd();

        if (!code.trim()) {
          this.warn('empty-code', 'Custom code step is empty.', step.id);
          return;
        }

        code.split('\n').forEach((line) => this.emitter.push(line.trimEnd()));
        return;
      }
      case 'comment': {
        const comment = step as CommentStep;
        comment.text
          .split('\n')
          .forEach((line) => this.emitter.push(`// ${line.trim()}`));
        return;
      }
      default:
        this.error('unknown-step', `Unsupported step kind "${(step as FlowStep).kind}".`, step.id);
    }
  }

  private emitScopedStep(step: FlowStep): void {
    switch (step.kind) {
      case 'condition': {
        const condition = step as ConditionStep;

        if (condition.then.steps.length === 0 && !condition.else?.steps.length) {
          this.error(
            'empty-branch',
            'Condition has no steps in any branch. Add steps or remove the condition.',
            step.id,
          );
        }

        this.emitter.push(`if (${this.predicate(condition.predicate, step.id)}) {`);
        this.emitter.indent();
        this.emitSequence(condition.then);
        this.emitter.dedent();

        if (condition.else && condition.else.steps.length > 0) {
          this.emitter.push('} else {');
          this.emitter.indent();
          this.emitSequence(condition.else);
          this.emitter.dedent();
        }

        this.emitter.push('}');
        return;
      }
      case 'loop': {
        const loop = step as LoopStep;

        if (!isValidIdentifier(loop.itemName)) {
          this.error('invalid-variable', `"${loop.itemName}" is not a valid item name.`, step.id);
          return;
        }

        if (loop.body.steps.length === 0) {
          this.error('empty-loop', 'Loop has no steps in its body.', step.id);
        }

        this.emitter.push(`for (const ${loop.itemName} of ${this.value(loop.source, step.id)}) {`);
        this.emitter.indent();
        this.declaredVariables.add(loop.itemName);
        this.emitSequence(loop.body);
        this.declaredVariables.delete(loop.itemName);
        this.emitter.dedent();
        this.emitter.push('}');
        return;
      }
      case 'try': {
        const tryStep = step as TryStep;

        if (!tryStep.catch && !tryStep.finally) {
          this.error('try-without-handler', 'Try step needs a catch or finally block.', step.id);
        }

        this.emitter.push('try {');
        this.emitter.indent();
        this.emitSequence(tryStep.body);
        this.emitter.dedent();

        if (tryStep.catch) {
          const errorName = isValidIdentifier(tryStep.catch.errorName)
            ? tryStep.catch.errorName
            : 'error';
          this.emitter.push(`} catch (${errorName}) {`);
          this.emitter.indent();
          this.declaredVariables.add(errorName);
          this.emitSequence(tryStep.catch.body);
          this.declaredVariables.delete(errorName);
          this.emitter.dedent();
        }

        if (tryStep.finally) {
          this.emitter.push(tryStep.catch ? '} finally {' : '} finally {');
          this.emitter.indent();
          this.emitSequence(tryStep.finally);
          this.emitter.dedent();
        }

        this.emitter.push('}');
        return;
      }
      default:
        this.emitLeafBody(step);
    }
  }

  private emitStep(step: FlowStep): void {
    if (this.seenStepIds.has(step.id)) {
      this.error('duplicate-step-id', `Step id "${step.id}" appears more than once.`, step.id);
    }

    this.seenStepIds.add(step.id);

    const startLine = this.emitter.nextLineNumber;
    const scoped = step.kind === 'condition' || step.kind === 'loop' || step.kind === 'try';
    const wrapped = !scoped && step.kind !== 'comment';

    if (wrapped) {
      this.emitter.push(`await test.step(${quote(this.stepLabel(step))}, async () => {`);
      this.emitter.indent();
    }

    if (scoped) {
      this.emitScopedStep(step);
    } else {
      this.emitLeafBody(step);
    }

    if (wrapped) {
      this.emitter.dedent();
      this.emitter.push('});');
    }

    if (this.profile === 'studio-run') {
      this.emitter.push(
        `await __studio.capture(${quote(step.id)}, ${quote(this.stepLabel(step))});`,
      );
    }

    this.stepLocations[step.id] = {
      line: startLine,
      endLine: this.emitter.lastLineNumber,
    };
  }

  private emitSequence(sequence: Sequence): void {
    sequence.steps.forEach((step) => this.emitStep(step));
  }

  compile(): CompileResult {
    const { document } = this;

    if (document.root.steps.length === 0) {
      this.warn('empty-flow', 'This flow has no steps.');
    }

    this.emitter.push(`import { expect, test } from ${quote(this.testImport)};`);

    if (this.profile === 'studio-run') {
      this.emitter.push("import { createStudioReporter } from './__studio-runtime';");
    }

    this.emitter.push('');

    const options: string[] = [];

    if (document.testOptions?.tags?.length) {
      options.push(`tag: [${document.testOptions.tags.map((tag) => quote(tag)).join(', ')}]`);
    }

    if (document.testOptions?.annotations?.length) {
      const annotations = document.testOptions.annotations
        .map((annotation) =>
          annotation.description
            ? `{ type: ${quote(annotation.type)}, description: ${quote(annotation.description)} }`
            : `{ type: ${quote(annotation.type)} }`,
        )
        .join(', ');
      options.push(`annotation: [${annotations}]`);
    }

    const optionsArg = options.length > 0 ? `, { ${options.join(', ')} }` : '';

    this.emitter.push(`test(${quote(document.name)}${optionsArg}, async ({ page }) => {`);
    this.emitter.indent();

    if (document.testOptions?.timeoutMs) {
      this.emitter.push(`test.setTimeout(${Math.trunc(document.testOptions.timeoutMs)});`);
    }

    if (this.profile === 'studio-run') {
      this.emitter.push('const __studio = createStudioReporter(page, test.info());');
    }

    this.emitSequence(document.root);
    this.emitter.dedent();
    this.emitter.push('});');
    this.emitter.push('');

    return {
      source: this.emitter.toString(),
      diagnostics: this.diagnostics,
      stepLocations: this.stepLocations,
    };
  }
}

export function compileFlow(document: FlowDocument, options: CompileOptions = {}): CompileResult {
  const compiler = new Compiler(
    document,
    options.profile ?? 'commit',
    options.testImport ?? '@playwright/test',
  );

  return compiler.compile();
}

export function hasBlockingDiagnostics(result: CompileResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
