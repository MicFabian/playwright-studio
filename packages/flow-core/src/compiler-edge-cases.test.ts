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

function statementsOf(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('hostile flow names and labels', () => {
  it('escapes quotes in the test name rather than ending the string early', () => {
    const { source } = compileFlow(
      doc([{ id: 'a', kind: 'click', target: testId('x') }], { name: 'Test "quoted" flow' }),
    );

    expect(source).toContain('test("Test \\"quoted\\" flow"');
    expect(
      JSON.parse(source.slice(source.indexOf('test(') + 5, source.indexOf('", async')) + '"'),
    ).toBe('Test "quoted" flow');
  });

  it('escapes a backslash in the test name', () => {
    const { source } = compileFlow(
      doc([{ id: 'a', kind: 'click', target: testId('x') }], { name: 'Test \\ backslash' }),
    );

    expect(source).toContain('test("Test \\\\ backslash"');
  });

  it('keeps a multi-line label on one line inside test.step', () => {
    const { source } = compileFlow(
      doc([{ id: 'a', kind: 'click', target: testId('x'), label: 'Click\nthe\nbutton' }]),
    );

    const stepLine = statementsOf(source).find((line) => line.startsWith('await test.step('));

    expect(stepLine).toBeDefined();
    expect(stepLine).toContain('\\n');
    expect(stepLine!.endsWith('async () => {')).toBe(true);
  });
});

describe('a variable published on more than one path', () => {
  it('declares it once when both branches assign it', () => {
    const result = compileFlow(
      doc([
        {
          id: 'cond',
          kind: 'condition',
          predicate: { type: 'expression', code: 'true' },
          then: { steps: [{ id: 'a', kind: 'extract', target: testId('v1'), variable: 'found' }] },
          else: { steps: [{ id: 'b', kind: 'extract', target: testId('v2'), variable: 'found' }] },
        },
        {
          id: 'after',
          kind: 'fill',
          target: testId('out'),
          value: { source: 'variable', name: 'found' },
        },
      ]),
    );

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source.match(/let found;/g)).toHaveLength(1);
    expect(result.source.match(/found = await page/g)).toHaveLength(2);
  });

  it('reuses one declaration across loop iterations', () => {
    const result = compileFlow(
      doc([
        {
          id: 'loop',
          kind: 'loop',
          source: { source: 'literal', value: 'rows' },
          itemName: 'item',
          body: {
            steps: [{ id: 'x', kind: 'extract', target: testId('cell'), variable: 'cellText' }],
          },
        },
        {
          id: 'after',
          kind: 'fill',
          target: testId('out'),
          value: { source: 'variable', name: 'cellText' },
        },
      ]),
    );

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source.match(/let cellText;/g)).toHaveLength(1);
    expect(result.source).not.toContain('let item;');
  });
});

describe('nested scopes', () => {
  it('emits balanced braces for try inside loop inside condition', () => {
    const { source } = compileFlow(
      doc([
        {
          id: 'cond',
          kind: 'condition',
          predicate: { type: 'expression', code: 'true' },
          then: {
            steps: [
              {
                id: 'loop',
                kind: 'loop',
                source: { source: 'literal', value: 'rows' },
                itemName: 'row',
                body: {
                  steps: [
                    {
                      id: 'try',
                      kind: 'try',
                      body: { steps: [{ id: 'c', kind: 'click', target: testId('risky') }] },
                      catch: {
                        errorName: 'error',
                        body: {
                          steps: [
                            {
                              id: 'e',
                              kind: 'extract',
                              target: testId('msg'),
                              variable: 'failure',
                            },
                          ],
                        },
                      },
                      finally: { steps: [{ id: 'f', kind: 'comment', text: 'cleanup' }] },
                    },
                  ],
                },
              },
            ],
          },
        },
      ]),
    );

    expect((source.match(/\{/g) ?? []).length).toBe((source.match(/\}/g) ?? []).length);
    expect(source).toContain('} catch (error) {');
    expect(source).toContain('} finally {');
  });

  it('hoists a variable published three scopes deep to the top of the test', () => {
    const result = compileFlow(
      doc([
        {
          id: 'try',
          kind: 'try',
          body: {
            steps: [
              {
                id: 'loop',
                kind: 'loop',
                source: { source: 'literal', value: 'rows' },
                itemName: 'row',
                body: {
                  steps: [
                    {
                      id: 'cond',
                      kind: 'condition',
                      predicate: { type: 'expression', code: 'true' },
                      then: {
                        steps: [
                          { id: 'e', kind: 'extract', target: testId('deep'), variable: 'buried' },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
          catch: { errorName: 'error', body: { steps: [{ id: 'n', kind: 'comment', text: 'x' }] } },
        },
        {
          id: 'after',
          kind: 'fill',
          target: testId('out'),
          value: { source: 'variable', name: 'buried' },
        },
      ]),
    );

    const lines = statementsOf(result.source);

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(lines.indexOf('let buried;')).toBeLessThan(lines.indexOf('try {'));
  });
});
