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

    expect(result.source).toContain('const orderCount = await page.getByTestId("count").textContent();');
    expect(result.source).toContain('.fill(orderCount);');
    expect(hasBlockingDiagnostics(result)).toBe(false);
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

describe('env values', () => {
  it('reads environment variables without inlining secrets', () => {
    const { source } = compile([
      { id: 'a', kind: 'fill', target: testId('pw'), value: { source: 'env', name: 'APP_PASSWORD' } },
    ]);

    expect(source).toContain("process.env[\"APP_PASSWORD\"] ?? ''");
  });
});
