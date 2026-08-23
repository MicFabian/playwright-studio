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
  type SnippetDefinition,
  type UseSnippetStep,
  childSequences,
} from './ir';

export type CompileProfile = 'commit' | 'studio-run';

export interface CompileOptions {
  profile?: CompileProfile;
  testImport?: string;
  baseURL?: string | null;
  snippets?: SnippetDefinition[];
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

export function isBalanced(source: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const previous = source[index - 1];
    const escaped = previous === '\\' && source[index - 2] !== '\\';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingle) {
      if (char === "'" && !escaped) {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (char === '"' && !escaped) {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (char === '`' && !escaped) {
        inTemplate = false;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      stack.push(char);
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== pairs[char]) {
        return false;
      }
    }
  }

  return stack.length === 0 && !inSingle && !inDouble && !inTemplate && !inBlockComment;
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

  private readonly hoistedNames = new Set<string>();

  constructor(
    private readonly document: FlowDocument,
    private readonly profile: CompileProfile,
    private readonly testImport: string,
    private readonly baseURL: string | null,
    private readonly snippets: Map<string, SnippetDefinition>,
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

  private navigationUrl(step: NavigateStep): string {
    const relative = this.relativeToBaseUrl(step.url);
    return relative == null ? this.value(step.url, step.id) : quote(relative);
  }

  private relativeToBaseUrl(url: ValueExpr): string | null {
    if (!this.baseURL || url.source !== 'literal') {
      return null;
    }

    let base: URL;
    let target: URL;

    try {
      base = new URL(this.baseURL);
      target = new URL(url.value);
    } catch {
      return null;
    }

    if (base.origin !== target.origin) {
      return null;
    }

    const basePath = base.pathname.replace(/\/$/, '');
    const targetPath = target.pathname;

    if (basePath && targetPath !== basePath && !targetPath.startsWith(`${basePath}/`)) {
      return null;
    }

    const remainder = `${targetPath.slice(basePath.length)}${target.search}${target.hash}`;
    return remainder.startsWith('/') ? remainder : `/${remainder}`;
  }

  private literalForType(type: 'string' | 'number' | 'boolean', raw: string): string {
    if (type === 'number') {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? String(parsed) : '0';
    }

    if (type === 'boolean') {
      return raw === 'true' ? 'true' : 'false';
    }

    return quote(raw);
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

  private boundInSequence(sequence: Sequence, into: Set<string>): void {
    sequence.steps.forEach((step) => {
      if (step.kind === 'loop') {
        into.add(step.itemName);
      }

      if (step.kind === 'try' && step.catch) {
        into.add(step.catch.errorName);
      }

      if (step.kind === 'useSnippet') {
        const snippet = this.snippets.get(step.snippetId);
        snippet?.params.forEach((param) => into.add(param.name));
        snippet?.outputs.forEach((output) => into.add(output.name));
      }

      childSequences(step).forEach((child) => this.boundInSequence(child, into));
    });
  }

  private publishedInSequence(sequence: Sequence, into: Set<string>): void {
    sequence.steps.forEach((step) => {
      this.hoistedVariables(step).forEach((name) => into.add(name));
      childSequences(step).forEach((child) => this.publishedInSequence(child, into));
    });
  }

  private hoistedVariables(step: FlowStep): string[] {
    if (step.kind === 'extract') {
      return isValidIdentifier(step.variable) ? [step.variable] : [];
    }

    if (step.kind === 'call') {
      return step.assignTo && isValidIdentifier(step.assignTo) ? [step.assignTo] : [];
    }

    if (step.kind === 'useSnippet') {
      const snippet = this.snippets.get(step.snippetId);

      return Object.entries(step.assign ?? {})
        .filter(([outputName]) => snippet?.outputs.some((output) => output.name === outputName))
        .map(([, variableName]) => variableName)
        .filter((variableName) => isValidIdentifier(variableName));
    }

    return [];
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
        this.emitter.push(`await page.goto(${this.navigationUrl(navigate)}${options});`);
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
        this.emitter.push(`${extract.variable} = await ${locator}.${accessor};`);
        return;
      }
      case 'call': {
        const call = step as CallStep;

        if (!call.target.trim()) {
          this.error('missing-call-target', 'Call step has no target.', step.id);
          return;
        }

        const args = (call.args ?? []).map((arg) => this.value(arg, step.id)).join(', ');
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
          this.emitter.push(`${call.assignTo} = ${invocation}`);
          return;
        }

        this.emitter.push(invocation);
        return;
      }
      case 'useSnippet': {
        const useStep = step as UseSnippetStep;
        const snippet = this.snippets.get(useStep.snippetId);

        if (!snippet) {
          this.error(
            'unknown-snippet',
            useStep.snippetId
              ? `Snippet "${useStep.snippetId}" no longer exists in this workspace.`
              : 'This step has no snippet selected.',
            step.id,
          );
          return;
        }

        const declaredNames = new Set<string>();
        let invalidDeclaration = false;

        [...snippet.params, ...snippet.outputs].forEach((entry) => {
          if (!isValidIdentifier(entry.name)) {
            this.error(
              'invalid-snippet-name',
              `Snippet "${snippet.name}" declares "${entry.name}", which is not a usable name here.`,
              step.id,
            );
            invalidDeclaration = true;
            return;
          }

          if (declaredNames.has(entry.name)) {
            this.error(
              'duplicate-snippet-name',
              `Snippet "${snippet.name}" declares "${entry.name}" more than once.`,
              step.id,
            );
            invalidDeclaration = true;
            return;
          }

          declaredNames.add(entry.name);
        });

        if (invalidDeclaration) {
          return;
        }

        const missing = snippet.params
          .filter((param) => param.required !== false)
          .filter((param) => {
            const supplied = useStep.args[param.name];
            return supplied == null && param.defaultValue == null;
          });

        if (missing.length > 0) {
          this.error(
            'missing-snippet-argument',
            `Snippet "${snippet.name}" needs ${missing.map((param) => param.name).join(', ')}.`,
            step.id,
          );
          return;
        }

        const bodyLines = snippet.code.trimEnd().split('\n');

        if (bodyLines.every((line) => !line.trim())) {
          this.warn('empty-snippet', `Snippet "${snippet.name}" has no code.`, step.id);
          return;
        }

        const assignments = Object.entries(useStep.assign ?? {}).filter(
          ([outputName, variableName]) => {
            if (!snippet.outputs.some((output) => output.name === outputName)) {
              this.error(
                'unknown-snippet-output',
                `Snippet "${snippet.name}" does not produce "${outputName}".`,
                step.id,
              );
              return false;
            }

            if (!isValidIdentifier(variableName)) {
              this.error(
                'invalid-variable',
                `"${variableName}" is not a valid variable name.`,
                step.id,
              );
              return false;
            }

            return true;
          },
        );

        this.emitter.push('{');
        this.emitter.indent();

        snippet.params.forEach((param) => {
          const supplied = useStep.args[param.name];
          const expression = supplied
            ? this.value(supplied, step.id)
            : this.literalForType(param.type, param.defaultValue ?? '');

          this.emitter.push(`const ${param.name} = ${expression};`);
          this.declaredVariables.add(param.name);
        });

        snippet.outputs.forEach((output) => {
          this.emitter.push(`let ${output.name};`);
          this.declaredVariables.add(output.name);
        });

        bodyLines.forEach((line) => this.emitter.push(line.trimEnd()));

        assignments.forEach(([outputName, variableName]) =>
          this.emitter.push(`${variableName} = ${outputName};`),
        );

        this.emitter.dedent();
        this.emitter.push('}');

        snippet.params.forEach((param) => this.declaredVariables.delete(param.name));
        snippet.outputs.forEach((output) => this.declaredVariables.delete(output.name));

        assignments.forEach(([, variableName]) => this.declaredVariables.add(variableName));

        return;
      }
      case 'code': {
        const codeStep = step as CodeStep;
        const code = String(codeStep.code ?? '').trimEnd();

        if (!code.trim()) {
          this.warn('empty-code', 'Custom code step is empty.', step.id);
          return;
        }

        if (!isBalanced(code)) {
          this.error(
            'unbalanced-code',
            'Custom code has unbalanced brackets, so it would break the generated file.',
            step.id,
          );
          return;
        }

        code.split('\n').forEach((line) => this.emitter.push(line.trimEnd()));
        return;
      }
      case 'comment': {
        const comment = step as CommentStep;
        String(comment.text ?? '')
          .split(/\r?\n/)
          .forEach((line) => this.emitter.push(`// ${line.trim().replace(/\*\//g, '*\\/')}`));
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
        this.hoistedNames.add(loop.itemName);
        this.emitSequence(loop.body);
        this.declaredVariables.delete(loop.itemName);
        this.hoistedNames.delete(loop.itemName);
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

    const title =
      this.profile === 'studio-run' ? `[${step.id}] ${this.stepLabel(step)}` : this.stepLabel(step);

    if (wrapped) {
      this.emitter.push(`await test.step(${quote(title)}, async () => {`);
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

    this.stepLocations[step.id] = {
      line: startLine,
      endLine: this.emitter.lastLineNumber,
    };
  }

  private emitSequence(sequence: Sequence): void {
    sequence.steps.forEach((step) => this.emitStep(step));
  }

  private emitTestBody(): void {
    if (this.document.testOptions?.timeoutMs) {
      this.emitter.push(`test.setTimeout(${Math.trunc(this.document.testOptions.timeoutMs)});`);
    }

    const published = new Set<string>();
    this.publishedInSequence(this.document.root, published);

    const bound = new Set<string>();
    this.boundInSequence(this.document.root, bound);

    if (this.document.data && this.document.data.cases.length > 0) {
      this.document.data.columns.forEach((column) => bound.add(column.name));
    }

    // A name that a loop item, catch clause, snippet, or data column already
    // binds cannot also be declared here: assigning to it would either hit an
    // undeclared variable or overwrite a const the generated code owns.
    [...published]
      .filter((name) => bound.has(name))
      .forEach((name) =>
        this.error(
          'name-collides-with-binding',
          `"${name}" is already bound by a loop, catch, snippet, or data column in this flow. ` +
            'Rename one of them.',
        ),
      );

    const declarations = [...published].filter(
      (name) =>
        !bound.has(name) && !this.hoistedNames.has(name) && !this.declaredVariables.has(name),
    );

    const unconditional = new Set<string>();
    this.document.root.steps.forEach((step) =>
      this.hoistedVariables(step).forEach((name) => unconditional.add(name)),
    );

    declarations.forEach((name) => {
      this.hoistedNames.add(name);
      this.emitter.push(`let ${name};`);

      if (!unconditional.has(name)) {
        this.warn(
          'conditionally-assigned',
          `"${name}" is only set inside a branch or loop, so it is undefined when that path does not run.`,
        );
      }
    });

    this.emitSequence(this.document.root);

    declarations.forEach((name) => this.hoistedNames.delete(name));
  }

  private testOptionsArgument(): string {
    const options: string[] = [];
    const testOptions = this.document.testOptions;

    if (testOptions?.tags?.length) {
      options.push(`tag: [${testOptions.tags.map((tag) => quote(tag)).join(', ')}]`);
    }

    if (testOptions?.annotations?.length) {
      const annotations = testOptions.annotations
        .map((annotation) =>
          annotation.description
            ? `{ type: ${quote(annotation.type)}, description: ${quote(annotation.description)} }`
            : `{ type: ${quote(annotation.type)} }`,
        )
        .join(', ');
      options.push(`annotation: [${annotations}]`);
    }

    return options.length > 0 ? `, { ${options.join(', ')} }` : '';
  }

  private validateDataSet(): boolean {
    const data = this.document.data;

    if (!data || data.cases.length === 0) {
      return false;
    }

    const seenColumns = new Set<string>();

    for (const column of data.columns) {
      if (!isValidIdentifier(column.name)) {
        this.error(
          'invalid-data-column',
          `"${column.name}" is not a valid column name. Use a JavaScript identifier.`,
        );
        return false;
      }

      if (seenColumns.has(column.name)) {
        this.error('duplicate-data-column', `Column "${column.name}" appears more than once.`);
        return false;
      }

      seenColumns.add(column.name);
    }

    const seenCases = new Set<string>();

    for (const dataCase of data.cases) {
      if (!dataCase.name.trim()) {
        this.error('unnamed-data-case', 'Every data row needs a name so its test can be found.');
        return false;
      }

      if (seenCases.has(dataCase.name)) {
        this.error('duplicate-data-case', `Two data rows are both named "${dataCase.name}".`);
        return false;
      }

      seenCases.add(dataCase.name);
    }

    return true;
  }

  private emitDataDrivenTests(): void {
    const data = this.document.data!;
    const columns = data.columns.map((column) => column.name);

    this.emitter.push('const cases = [');
    this.emitter.indent();

    const caseLabel = columns.includes('name') ? '__caseName' : 'name';

    data.cases.forEach((dataCase) => {
      const entries = [
        `${caseLabel}: ${quote(dataCase.name)}`,
        ...columns.map((column) => `${column}: ${quote(dataCase.values[column] ?? '')}`),
      ];
      this.emitter.push(`{ ${entries.join(', ')} },`);
    });

    this.emitter.dedent();
    this.emitter.push('];');
    this.emitter.push('');

    const destructured = columns.length > 0 ? `, ${columns.join(', ')}` : '';

    this.emitter.push(`for (const { ${caseLabel}${destructured} } of cases) {`);
    this.emitter.indent();
    this.emitter.push(
      `test(${quote(this.document.name)} + " — " + ${caseLabel}${this.testOptionsArgument()}, async ({ page }) => {`,
    );
    this.emitter.indent();

    columns.forEach((column) => {
      this.declaredVariables.add(column);
      this.hoistedNames.add(column);
    });

    this.emitTestBody();

    columns.forEach((column) => {
      this.declaredVariables.delete(column);
      this.hoistedNames.delete(column);
    });

    this.emitter.dedent();
    this.emitter.push('});');
    this.emitter.dedent();
    this.emitter.push('}');
  }
  compile(): CompileResult {
    const { document } = this;

    if (document.root.steps.length === 0) {
      this.warn('empty-flow', 'This flow has no steps.');
    }

    this.emitter.push(`import { expect, test } from ${quote(this.testImport)};`);

    this.emitter.push('');

    if (document.data && document.data.cases.length > 0 && this.validateDataSet()) {
      this.emitDataDrivenTests();
    } else {
      this.emitter.push(
        `test(${quote(document.name)}${this.testOptionsArgument()}, async ({ page }) => {`,
      );
      this.emitter.indent();
      this.emitTestBody();
      this.emitter.dedent();
      this.emitter.push('});');
    }

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
    options.baseURL ?? null,
    new Map((options.snippets ?? []).map((snippet) => [snippet.id, snippet])),
  );

  return compiler.compile();
}

export function hasBlockingDiagnostics(result: CompileResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
