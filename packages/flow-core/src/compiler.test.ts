import { describe, expect, it } from 'vitest';
import { compileFlow, hasBlockingDiagnostics } from './compiler';
import { FLOW_FORMAT_VERSION, type FlowDocument, type FlowStep, type LocatorTarget } from './ir';

function testId(value: string): LocatorTarget {
  return { base: { by: 'testId', value: { source: 'literal', value } } };
}

function doc(steps: FlowStep[], overrides: Partial<FlowDocument> = {}): FlowDocument {
  return {
    formatVersion: FLOW_FORMAT_VERSION,
    id: 'sample',
    name: 'Sample flow',
    status: 'draft',
    root: { steps },
    layout: { positions: {} },
    ...overrides,
  };
}

function compile(steps: FlowStep[], overrides: Partial<FlowDocument> = {}) {
  return compileFlow(doc(steps, overrides));
}

function errorCodes(steps: FlowStep[]): string[] {
  return compile(steps)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);
}

describe('locator emission', () => {
  it('prefers user-facing locators over raw selectors', () => {
    const { source } = compile([
      {
        id: 'a',
        kind: 'click',
        target: { base: { by: 'role', role: 'button', name: { source: 'literal', value: 'Sign in' } } },
      },
      { id: 'b', kind: 'click', target: testId('submit') },
      {
        id: 'c',
        kind: 'click',
        target: { base: { by: 'label', text: { source: 'literal', value: 'Email' } } },
      },
    ]);

    expect(source).toContain('page.getByRole("button", { name: "Sign in" })');
    expect(source).toContain('page.getByTestId("submit")');
    expect(source).toContain('page.getByLabel("Email")');
  });

  it('supports filtering and indexing', () => {
    const { source } = compile([
      {
        id: 'a',
        kind: 'click',
        target: {
          base: { by: 'role', role: 'row' },
          hasText: { source: 'literal', value: 'Ada' },
          nth: 2,
        },
      },
    ]);

    expect(source).toContain('page.getByRole("row").filter({ hasText: "Ada" }).nth(2)');
  });

  it('escapes values rather than concatenating them into selectors', () => {
    const { source } = compile([
      { id: 'a', kind: 'fill', target: testId('q'), value: { source: 'literal', value: 'a"b\\c' } },
    ]);

    expect(source).toContain('"a\\"b\\\\c"');
  });
});

describe('injection safety', () => {
  const payloads = [
    '"); process.exit(1); ("',
    '`); require("child_process").execSync("rm -rf /"); (`',
    '\\"); console.log("pwned',
    '${process.env.SECRET}',
    'line one\nline two',
  ];

  it.each(payloads)('emits %j as an inert string literal', (payload) => {
    const { source } = compile([
      { id: 'a', kind: 'fill', target: testId('f'), value: { source: 'literal', value: payload } },
    ]);

    const line = source.split('\n').find((candidate) => candidate.includes('.fill('));

    expect(line).toBeDefined();

    const argument = line!.slice(line!.indexOf('.fill(') + 6, line!.lastIndexOf(')'));

    expect(JSON.parse(argument)).toBe(payload);
  });

  it('escapes payloads inside selectors too', () => {
    const { source } = compile([
      {
        id: 'a',
        kind: 'click',
        target: { base: { by: 'css', selector: { source: 'literal', value: '"); evil(); ("' } } },
      },
    ]);

    expect(source).toContain('page.locator("\\"); evil(); (\\"")');
  });
});

describe('assertions', () => {
  it('emits matcher-specific assertions with negation and timeout', () => {
    const { source } = compile([
      { id: 'a', kind: 'assert', target: testId('t'), assertion: { type: 'visible' } },
      {
        id: 'b',
        kind: 'assert',
        target: testId('t'),
        assertion: { type: 'containsText', text: { source: 'literal', value: 'Hi' }, negated: true },
      },
      {
        id: 'c',
        kind: 'assert',
        target: testId('t'),
        assertion: { type: 'hasCount', count: 3 },
        timeoutMs: 9000,
      },
    ]);

    expect(source).toContain('await expect(page.getByTestId("t")).toBeVisible();');
    expect(source).toContain('await expect(page.getByTestId("t")).not.toContainText("Hi");');
    expect(source).toContain('.toHaveCount(3, { timeout: 9000 });');
  });

  it('emits page-level assertions', () => {
    const { source } = compile([
      {
        id: 'a',
        kind: 'assertPage',
        assertion: { type: 'url', value: { source: 'literal', value: '/dashboard' } },
      },
    ]);

    expect(source).toContain('await expect(page).toHaveURL("/dashboard");');
  });
});

describe('nesting', () => {
  it('emits real nested bodies for conditions', () => {
    const { source } = compile([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'locatorVisible', target: testId('toast') },
        then: { steps: [{ id: 'click', kind: 'click', target: testId('dismiss') }] },
        else: { steps: [{ id: 'note', kind: 'comment', text: 'nothing to dismiss' }] },
      },
    ]);

    expect(source).toContain('if (await page.getByTestId("toast").isVisible()) {');
    expect(source).toContain('page.getByTestId("dismiss").click()');
    expect(source).toContain('} else {');
    expect(source).toContain('// nothing to dismiss');
  });

  it('scopes loop variables so the body can reference the item', () => {
    const { source, diagnostics } = compile([
      {
        id: 'loop',
        kind: 'loop',
        source: { source: 'literal', value: 'rows' },
        itemName: 'row',
        body: {
          steps: [
            { id: 'fill', kind: 'fill', target: testId('cell'), value: { source: 'variable', name: 'row' } },
          ],
        },
      },
    ]);

    expect(source).toContain('for (const row of "rows") {');
    expect(source).toContain('.fill(row);');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('rejects a loop variable that escapes its body', () => {
    expect(
      errorCodes([
        {
          id: 'loop',
          kind: 'loop',
          source: { source: 'literal', value: 'rows' },
          itemName: 'row',
          body: { steps: [{ id: 'c', kind: 'click', target: testId('x') }] },
        },
        { id: 'after', kind: 'fill', target: testId('y'), value: { source: 'variable', name: 'row' } },
      ]),
    ).toContain('unknown-variable');
  });

  it('emits try/catch/finally', () => {
    const { source } = compile([
      {
        id: 'try',
        kind: 'try',
        body: { steps: [{ id: 'c', kind: 'click', target: testId('risky') }] },
        catch: {
          errorName: 'error',
          body: { steps: [{ id: 'note', kind: 'comment', text: 'recovered' }] },
        },
        finally: { steps: [{ id: 'done', kind: 'comment', text: 'cleanup' }] },
      },
    ]);

    expect(source).toContain('try {');
    expect(source).toContain('} catch (error) {');
    expect(source).toContain('} finally {');
  });
});

describe('diagnostics', () => {
  it('fails loudly on an empty condition instead of emitting a decorative branch', () => {
    const codes = errorCodes([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'locatorVisible', target: testId('x') },
        then: { steps: [] },
      },
    ]);

    expect(codes).toContain('empty-branch');
  });

  it('fails on an empty loop body', () => {
    expect(
      errorCodes([
        {
          id: 'loop',
          kind: 'loop',
          source: { source: 'literal', value: 'rows' },
          itemName: 'row',
          body: { steps: [] },
        },
      ]),
    ).toContain('empty-loop');
  });

  it('rejects unknown and malformed variables', () => {
    expect(
      errorCodes([
        { id: 'a', kind: 'fill', target: testId('x'), value: { source: 'variable', name: 'ghost' } },
      ]),
    ).toContain('unknown-variable');

    expect(
      errorCodes([
        { id: 'a', kind: 'extract', target: testId('x'), variable: 'not valid' },
      ]),
    ).toContain('invalid-variable');
  });

  it('rejects reserved words as variable names', () => {
    expect(
      errorCodes([{ id: 'a', kind: 'extract', target: testId('x'), variable: 'page' }]),
    ).toContain('invalid-variable');
  });

  it('rejects duplicate step ids', () => {
    expect(
      errorCodes([
        { id: 'same', kind: 'click', target: testId('a') },
        { id: 'same', kind: 'click', target: testId('b') },
      ]),
    ).toContain('duplicate-step-id');
  });

  it('reports a missing target rather than emitting a broken locator', () => {
    expect(
      errorCodes([{ id: 'a', kind: 'click' } as unknown as FlowStep]),
    ).toContain('missing-target');
  });

  it('treats a valid flow as non-blocking', () => {
    const result = compile([
      { id: 'a', kind: 'navigate', url: { source: 'literal', value: 'https://example.com' } },
      { id: 'b', kind: 'assert', target: testId('title'), assertion: { type: 'visible' } },
    ]);

    expect(hasBlockingDiagnostics(result)).toBe(false);
  });
});

describe('extract binds variables for later steps', () => {
  it('allows a later step to use an extracted variable', () => {
    const result = compile([
      { id: 'x', kind: 'extract', target: testId('count'), variable: 'orderCount' },
      {
        id: 'y',
        kind: 'fill',
        target: testId('field'),
        value: { source: 'variable', name: 'orderCount' },
      },
    ]);

    expect(result.source).toContain('let orderCount;');
    expect(result.source).toContain('orderCount = await page.getByTestId("count").textContent();');
    expect(result.source).toContain('.fill(orderCount);');
    expect(hasBlockingDiagnostics(result)).toBe(false);

    const lines = result.source.split('\n').map((line) => line.trim());
    const declaration = lines.indexOf('let orderCount;');
    const wrapper = lines.findIndex((line) => line.startsWith('await test.step('));

    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(declaration).toBeLessThan(lines.length);
    expect(lines[declaration + 1]).toContain('test.step');
    expect(wrapper).toBeGreaterThanOrEqual(0);
  });
});

describe('malformed input is a diagnostic, never a crash or a broken file', () => {
  it('rejects custom code with unbalanced brackets instead of corrupting the file', () => {
    const result = compile([{ id: 'a', kind: 'code', code: 'if (true) {' }]);
    const source = result.source;

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('unbalanced-code');
    expect((source.match(/\{/g) ?? []).length).toBe((source.match(/\}/g) ?? []).length);
  });

  it('accepts code whose brackets are balanced inside strings and comments', () => {
    const result = compile([
      {
        id: 'a',
        kind: 'code',
        code: [
          'const text = "a { b";',
          "const other = 'c } d';",
          'const tpl = `e { f`;',
          '// trailing { comment',
          'await page.waitForTimeout(1);',
        ].join('\n'),
      },
    ]);

    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    ).toHaveLength(0);
  });

  it('does not crash on a call step missing its arguments', () => {
    expect(() =>
      compile([{ id: 'a', kind: 'call', target: 'helper' } as unknown as FlowStep]),
    ).not.toThrow();
  });

  it('keeps a comment on one line and cannot close a block comment', () => {
    const { source } = compile([
      { id: 'a', kind: 'comment', text: 'ends a block */ and\nspans lines' },
    ]);

    const commentLines = source.split('\n').filter((line) => line.trim().startsWith('//'));

    expect(commentLines).toHaveLength(2);
    expect(source).not.toContain('*/');
  });
});

describe('branch and loop variables stay readable afterwards', () => {
  it('declares a variable published inside a branch at the top of the test', () => {
    const result = compile([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'expression', code: 'true' },
        then: { steps: [{ id: 'x', kind: 'extract', target: testId('v'), variable: 'seen' }] },
      },
      { id: 'after', kind: 'fill', target: testId('y'), value: { source: 'variable', name: 'seen' } },
    ]);

    const lines = result.source.split('\n').map((line) => line.trim());

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(lines.indexOf('let seen;')).toBeLessThan(lines.indexOf('if (true) {'));
    expect(result.source).toContain('.fill(seen);');
  });

  it('declares a variable published inside a loop body once, outside the loop', () => {
    const result = compile([
      {
        id: 'loop',
        kind: 'loop',
        source: { source: 'literal', value: 'rows' },
        itemName: 'row',
        body: { steps: [{ id: 'x', kind: 'extract', target: testId('v'), variable: 'last' }] },
      },
      { id: 'after', kind: 'fill', target: testId('y'), value: { source: 'variable', name: 'last' } },
    ]);

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source.match(/let last;/g)).toHaveLength(1);
    expect(result.source).not.toContain('let row;');
  });
});

describe('snippet declarations are validated', () => {
  const snippetWith = (params: { name: string }[], outputs: { name: string }[]) => ({
    formatVersion: 2 as const,
    id: 's',
    name: 'S',
    description: '',
    params: params.map((param) => ({ ...param, type: 'string' as const, required: true })),
    outputs: outputs.map((output) => ({ ...output, type: 'string' as const })),
    code: 'await page.waitForTimeout(1);',
  });

  const useIt = (): FlowStep => ({
    id: 'u',
    kind: 'useSnippet',
    snippetId: 's',
    args: { a: { source: 'literal', value: 'v' } },
  });

  it('rejects a snippet whose param and output share a name', () => {
    const codes = compileFlow(doc([useIt()]), {
      snippets: [snippetWith([{ name: 'a' }], [{ name: 'a' }])],
    }).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('duplicate-snippet-name');
  });

  it('rejects a snippet param that would shadow the page fixture', () => {
    const codes = compileFlow(doc([useIt()]), {
      snippets: [snippetWith([{ name: 'page' }], [])],
    }).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('invalid-snippet-name');
  });

  it('accepts distinct, valid names', () => {
    const result = compileFlow(doc([useIt()]), {
      snippets: [snippetWith([{ name: 'a' }], [{ name: 'result' }])],
    });

    expect(hasBlockingDiagnostics(result)).toBe(false);
  });
});

describe('conditional assignment is surfaced', () => {
  it('warns that a branch-only variable can be undefined', () => {
    const result = compile([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'expression', code: 'true' },
        then: { steps: [{ id: 'x', kind: 'extract', target: testId('v'), variable: 'maybe' }] },
      },
      { id: 'after', kind: 'fill', target: testId('y'), value: { source: 'variable', name: 'maybe' } },
    ]);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'conditionally-assigned',
    );
    expect(hasBlockingDiagnostics(result)).toBe(false);
  });

  it('does not warn for a variable set at the top level', () => {
    const result = compile([
      { id: 'x', kind: 'extract', target: testId('v'), variable: 'always' },
      { id: 'after', kind: 'fill', target: testId('y'), value: { source: 'variable', name: 'always' } },
    ]);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'conditionally-assigned',
    );
  });
});

describe('declaration hygiene', () => {
  it('declares a reused variable once rather than emitting invalid duplicate lets', () => {
    const { source } = compile([
      { id: 'a', kind: 'extract', target: testId('x'), variable: 'value' },
      { id: 'b', kind: 'extract', target: testId('y'), variable: 'value' },
    ]);

    expect(source.match(/let value;/g)).toHaveLength(1);
    expect(source.match(/value = await page/g)).toHaveLength(2);
  });

  it('does not shadow a data column with a step declaration', () => {
    const { source } = compile(
      [{ id: 'a', kind: 'extract', target: testId('x'), variable: 'email' }],
      {
        data: {
          columns: [{ name: 'email' }],
          cases: [{ name: 'row', values: { email: 'qa@example.com' } }],
        },
      },
    );

    expect(source).toContain('for (const { name, email } of cases) {');
    expect(source).not.toContain('let email;');
    expect(source).toContain('email = await page.getByTestId("x").textContent();');
  });

  it('does not shadow a loop item with a step declaration', () => {
    const { source } = compile([
      {
        id: 'loop',
        kind: 'loop',
        source: { source: 'literal', value: 'rows' },
        itemName: 'row',
        body: {
          steps: [{ id: 'x', kind: 'extract', target: testId('cell'), variable: 'row' }],
        },
      },
    ]);

    expect(source).toContain('for (const row of "rows") {');
    expect(source).not.toContain('let row;');
  });
});

describe('profiles', () => {
  const steps: FlowStep[] = [
    { id: 'a', kind: 'navigate', url: { source: 'literal', value: 'https://example.com' } },
    { id: 'b', kind: 'click', target: testId('go') },
  ];

  it('wraps steps in test.step for trace structure', () => {
    expect(compile(steps).source).toContain('await test.step("Open page", async () => {');
  });

  it('studio-run decorates the same statements rather than reimplementing them', () => {
    const commit = compileFlow(doc(steps), { profile: 'commit' });
    const run = compileFlow(doc(steps), { profile: 'studio-run' });

    const meaningful = (source: string) =>
      source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('await page.') || line.startsWith('await expect('));

    expect(meaningful(run.source)).toEqual(meaningful(commit.source));
  });

  it('studio-run tags step titles with ids so the reporter can map them back', () => {
    const run = compileFlow(doc(steps), { profile: 'studio-run' });
    const commit = compileFlow(doc(steps), { profile: 'commit' });

    expect(run.source).toContain('test.step("[a] Open page"');
    expect(commit.source).toContain('test.step("Open page"');
    expect(commit.source).not.toContain('[a]');
  });

  it('respects a workspace fixture import', () => {
    const { source } = compileFlow(doc(steps), { testImport: '../fixtures' });
    expect(source).toContain('import { expect, test } from "../fixtures";');
  });

  it('maps every step to a source location', () => {
    const result = compile(steps);
    const lines = result.source.split('\n');

    for (const step of steps) {
      const location = result.stepLocations[step.id];
      expect(location).toBeDefined();
      expect(lines[location.line - 1]).toContain('test.step');
    }
  });
});

describe('test options', () => {
  it('emits tags, annotations, and timeout', () => {
    const { source } = compile(
      [{ id: 'a', kind: 'navigate', url: { source: 'literal', value: 'https://example.com' } }],
      {
        testOptions: {
          tags: ['@smoke'],
          annotations: [{ type: 'issue', description: 'FM-1' }],
          timeoutMs: 60000,
        },
      },
    );

    expect(source).toContain('tag: ["@smoke"]');
    expect(source).toContain('{ type: "issue", description: "FM-1" }');
    expect(source).toContain('test.setTimeout(60000);');
  });
});

describe('snippets', () => {
  const waitForDashboard = {
    formatVersion: 2 as const,
    id: 'wait-for-dashboard',
    name: 'Wait for dashboard',
    description: 'Confirm the dashboard headline.',
    params: [
      { name: 'headline', type: 'string' as const },
      { name: 'timeoutMs', type: 'number' as const, required: false, defaultValue: '5000' },
    ],
    outputs: [{ name: 'actual', type: 'string' as const }],
    code: [
      'const title = page.getByTestId("dashboard-title");',
      'await expect(title).toContainText(headline, { timeout: timeoutMs });',
      'actual = (await title.textContent()) ?? "";',
    ].join('\n'),
  };

  const useStep = (overrides = {}): FlowStep => ({
    id: 'use',
    kind: 'useSnippet',
    snippetId: 'wait-for-dashboard',
    args: { headline: { source: 'literal', value: 'Dashboard' } },
    ...overrides,
  });

  it('inlines the snippet with typed argument bindings', () => {
    const { source, diagnostics } = compileFlow(doc([useStep()]), {
      snippets: [waitForDashboard],
    });

    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toHaveLength(0);
    expect(source).toContain('const headline = "Dashboard";');
    expect(source).toContain('const timeoutMs = 5000;');
    expect(source).toContain('await expect(title).toContainText(headline, { timeout: timeoutMs });');
  });

  it('scopes snippet bindings to the snippet block', () => {
    const result = compileFlow(
      doc([
        useStep(),
        { id: 'after', kind: 'fill', target: testId('x'), value: { source: 'variable', name: 'headline' } },
      ]),
      { snippets: [waitForDashboard] },
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('unknown-variable');
  });

  it('captures a declared output into a caller variable', () => {
    const result = compileFlow(
      doc([
        useStep({ assign: { actual: 'seenHeadline' } }),
        {
          id: 'after',
          kind: 'fill',
          target: testId('x'),
          value: { source: 'variable', name: 'seenHeadline' },
        },
      ]),
      { snippets: [waitForDashboard] },
    );

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source).toContain('let seenHeadline;');
    expect(result.source).toContain('seenHeadline = actual;');
    expect(result.source).toContain('.fill(seenHeadline);');

    const lines = result.source.split('\n').map((line) => line.trim());

    expect(lines[lines.indexOf('let seenHeadline;') + 1]).toContain('test.step');
  });

  it('reports a missing required argument', () => {
    const codes = compileFlow(doc([useStep({ args: {} })]), {
      snippets: [waitForDashboard],
    }).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('missing-snippet-argument');
  });

  it('reports a snippet that no longer exists', () => {
    const codes = compileFlow(doc([useStep()]), { snippets: [] }).diagnostics.map(
      (diagnostic) => diagnostic.code,
    );

    expect(codes).toContain('unknown-snippet');
  });

  it('reports an output the snippet does not declare', () => {
    const codes = compileFlow(doc([useStep({ assign: { missing: 'x' } })]), {
      snippets: [waitForDashboard],
    }).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('unknown-snippet-output');
  });

  it('binds a data column as a snippet argument', () => {
    const result = compileFlow(
      {
        ...doc([useStep({ args: { headline: { source: 'variable', name: 'expected' } } })]),
        data: {
          columns: [{ name: 'expected' }],
          cases: [{ name: 'row', values: { expected: 'Dashboard' } }],
        },
      },
      { snippets: [waitForDashboard] },
    );

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source).toContain('const headline = expected;');
  });
});

describe('data-driven tests', () => {
  const loginSteps: FlowStep[] = [
    { id: 'a', kind: 'navigate', url: { source: 'literal', value: '/login' } },
    {
      id: 'b',
      kind: 'fill',
      target: testId('email'),
      value: { source: 'variable', name: 'email' },
    },
    {
      id: 'c',
      kind: 'assert',
      target: testId('result'),
      assertion: { type: 'containsText', text: { source: 'variable', name: 'expected' } },
    },
  ];

  const dataset = {
    columns: [{ name: 'email' }, { name: 'expected' }],
    cases: [
      { name: 'valid user', values: { email: 'qa@example.com', expected: 'Dashboard' } },
      { name: 'blocked user', values: { email: 'blocked@example.com', expected: 'Suspended' } },
    ],
  };

  it('emits one named test per row rather than hiding iteration in one test', () => {
    const { source } = compile(loginSteps, { data: dataset });

    expect(source).toContain('const cases = [');
    expect(source).toContain('{ name: "valid user", email: "qa@example.com", expected: "Dashboard" },');
    expect(source).toContain('for (const { name, email, expected } of cases) {');
    expect(source).toContain('test("Sample flow" + " — " + name, async ({ page }) => {');
  });

  it('puts data columns in scope for the steps', () => {
    const result = compile(loginSteps, { data: dataset });

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source).toContain('.fill(email);');
    expect(result.source).toContain('toContainText(expected);');
  });

  it('does not leak data columns outside the generated test', () => {
    const result = compile(
      [
        {
          id: 'a',
          kind: 'fill',
          target: testId('x'),
          value: { source: 'variable', name: 'notAColumn' },
        },
      ],
      { data: dataset },
    );

    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'unknown-variable'),
    ).not.toHaveLength(0);
  });

  it('falls back to a single test when there are no rows', () => {
    const { source } = compile(loginSteps, { data: { columns: [{ name: 'email' }], cases: [] } });

    expect(source).toContain('test("Sample flow", async ({ page }) => {');
    expect(source).not.toContain('const cases = [');
  });

  it('rejects a column name that is not a valid identifier', () => {
    const codes = compile(loginSteps, {
      data: { columns: [{ name: 'e-mail' }], cases: [{ name: 'row', values: {} }] },
    }).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('invalid-data-column');
  });

  it('rejects duplicate rows and unnamed rows', () => {
    expect(
      compile(loginSteps, {
        data: {
          columns: [{ name: 'email' }],
          cases: [
            { name: 'same', values: {} },
            { name: 'same', values: {} },
          ],
        },
      }).diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain('duplicate-data-case');

    expect(
      compile(loginSteps, {
        data: { columns: [{ name: 'email' }], cases: [{ name: '  ', values: {} }] },
      }).diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain('unnamed-data-case');
  });

  it('escapes row values rather than interpolating them', () => {
    const { source } = compile(loginSteps, {
      data: {
        columns: [{ name: 'email' }, { name: 'expected' }],
        cases: [{ name: 'quote "row"', values: { email: '"); evil(); ("', expected: 'x' } }],
      },
    });

    expect(source).toContain('name: "quote \\"row\\""');
    expect(source).toContain('email: "\\"); evil(); (\\""');
  });

  it('keeps tags and annotations on every generated case', () => {
    const { source } = compile(loginSteps, {
      data: dataset,
      testOptions: { tags: ['@smoke'] },
    });

    expect(source).toContain('tag: ["@smoke"]');
  });
});

describe('baseURL awareness', () => {
  const navigate = (url: string): FlowStep[] => [
    { id: 'a', kind: 'navigate', url: { source: 'literal', value: url } },
  ];

  it('shortens a URL that sits under the workspace baseURL', () => {
    const { source } = compileFlow(doc(navigate('https://app.example.com/login')), {
      baseURL: 'https://app.example.com',
    });

    expect(source).toContain('await page.goto("/login");');
  });

  it('adds the leading slash when baseURL has a trailing one', () => {
    const { source } = compileFlow(doc(navigate('https://app.example.com/login')), {
      baseURL: 'https://app.example.com/',
    });

    expect(source).toContain('await page.goto("/login");');
  });

  it('keeps an unrelated absolute URL intact', () => {
    const { source } = compileFlow(doc(navigate('https://other.example.com/x')), {
      baseURL: 'https://app.example.com',
    });

    expect(source).toContain('await page.goto("https://other.example.com/x");');
  });

  it('does not treat a lookalike host as the base origin', () => {
    const { source } = compileFlow(doc(navigate('https://app.example.com.evil.test/steal')), {
      baseURL: 'https://app.example.com',
    });

    expect(source).toContain('await page.goto("https://app.example.com.evil.test/steal");');
  });

  it('does not shorten a host that merely starts with the base host', () => {
    const { source } = compileFlow(doc(navigate('https://app.example.commercial.test/x')), {
      baseURL: 'https://app.example.com',
    });

    expect(source).toContain('await page.goto("https://app.example.commercial.test/x");');
  });

  it('respects path boundaries when baseURL carries a path', () => {
    const shortened = compileFlow(doc(navigate('https://app.example.com/base/deep?q=1#f')), {
      baseURL: 'https://app.example.com/base',
    });
    const untouched = compileFlow(doc(navigate('https://app.example.com/basement/x')), {
      baseURL: 'https://app.example.com/base',
    });

    expect(shortened.source).toContain('await page.goto("/deep?q=1#f");');
    expect(untouched.source).toContain('await page.goto("https://app.example.com/basement/x");');
  });

  it('does not shorten across a scheme change', () => {
    const { source } = compileFlow(doc(navigate('http://app.example.com/login')), {
      baseURL: 'https://app.example.com',
    });

    expect(source).toContain('await page.goto("http://app.example.com/login");');
  });

  it('leaves a malformed URL alone', () => {
    const { source } = compileFlow(doc(navigate('not a url')), {
      baseURL: 'https://app.example.com',
    });

    expect(source).toContain('await page.goto("not a url");');
  });

  it('keeps absolute URLs when no baseURL is configured', () => {
    const { source } = compileFlow(doc(navigate('https://app.example.com/login')));

    expect(source).toContain('await page.goto("https://app.example.com/login");');
  });

  it('leaves a variable URL alone', () => {
    const { source } = compileFlow(
      doc([
        { id: 'x', kind: 'extract', target: testId('t'), variable: 'target' },
        { id: 'a', kind: 'navigate', url: { source: 'variable', name: 'target' } },
      ]),
      { baseURL: 'https://app.example.com' },
    );

    expect(source).toContain('await page.goto(target);');
  });
});

describe('env values', () => {
  it('reads environment variables without inlining secrets', () => {
    const { source } = compile([
      { id: 'a', kind: 'fill', target: testId('pw'), value: { source: 'env', name: 'APP_PASSWORD' } },
    ]);

    expect(source).toContain("process.env[\"APP_PASSWORD\"] ?? ''");
  });
});
