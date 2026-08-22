import { describe, it, expect } from 'vitest';
import { compileFlow } from './compiler';
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

describe('ADVERSARIAL: Edge cases', () => {
  it('a variable extracted inside a branch is still readable after the branch closes', () => {
    const result = compile([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'expression', code: 'true' },
        then: {
          steps: [{ id: 'x', kind: 'extract', target: testId('val'), variable: 'extracted' }],
        },
      },
      {
        id: 'after',
        kind: 'fill',
        target: testId('y'),
        value: { source: 'variable', name: 'extracted' },
      },
    ]);

    const errors = result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
    const lines = result.source.split('\n').map((line) => line.trim());

    expect(errors).toEqual([]);
    expect(lines.indexOf('let extracted;')).toBeLessThan(lines.indexOf('if (true) {'));
    expect(result.source).toContain('.fill(extracted);');
  });

  it('code step with return statement inside test.step wrapper', () => {
    const result = compile([{ id: 'code', kind: 'code', code: 'return;' }]);

    const source = result.source;
    expect(source).toMatch(/await test\.step\(.*async \(\) => \{[\s\S]*return;[\s\S]*\}\)/);
  });

  it('comment with */ in the text', () => {
    const result = compile([
      { id: 'note', kind: 'comment', text: 'Note: this comment ends block */' },
    ]);

    const commentLine = result.source.split('\n').find((line) => line.includes('Note:'));

    expect(commentLine).toBeDefined();
    expect(commentLine!.trim()).toMatch(/^\/\//);
    expect(commentLine).not.toContain('*/');
  });

  it('step label with double quotes gets escaped', () => {
    const result = compile([
      { id: 'a', kind: 'click', target: testId('x'), label: 'Click the "submit" button' },
    ]);

    const source = result.source;
    expect(source).toContain('test.step("Click the \\"submit\\" button"');
  });

  it('deeply nested scopes maintain brace balance', () => {
    const result = compile([
      {
        id: 'try1',
        kind: 'try',
        body: {
          steps: [
            {
              id: 'loop1',
              kind: 'loop',
              source: { source: 'literal', value: 'items' },
              itemName: 'item',
              body: {
                steps: [
                  {
                    id: 'cond1',
                    kind: 'condition',
                    predicate: { type: 'expression', code: 'item > 5' },
                    then: { steps: [{ id: 'c', kind: 'click', target: testId('x') }] },
                  },
                ],
              },
            },
          ],
        },
        catch: {
          errorName: 'e',
          body: { steps: [{ id: 'note', kind: 'comment', text: 'error' }] },
        },
        finally: { steps: [{ id: 'cleanup', kind: 'comment', text: 'cleanup' }] },
      },
    ]);

    const source = result.source;
    const openBraces = (source.match(/{/g) || []).length;
    const closeBraces = (source.match(/}/g) || []).length;
    expect(openBraces).toBe(closeBraces);
  });

  it('hoisted variable declaration in correct position for catch-nested extract', () => {
    const result = compile([
      {
        id: 'try',
        kind: 'try',
        body: { steps: [{ id: 'risky', kind: 'click', target: testId('btn') }] },
        catch: {
          errorName: 'e',
          body: {
            steps: [{ id: 'x', kind: 'extract', target: testId('error'), variable: 'errorMsg' }],
          },
        },
      },
      {
        id: 'after',
        kind: 'fill',
        target: testId('log'),
        value: { source: 'variable', name: 'errorMsg' },
      },
    ]);

    const lines = result.source.split('\n').map((l) => l.trim());
    const hoistIdx = lines.indexOf('let errorMsg;');
    const tryIdx = lines.findIndex((l) => l === 'try {');

    expect(hoistIdx).toBeGreaterThanOrEqual(0);
    expect(tryIdx).toBeGreaterThan(hoistIdx);
  });

  it('code step with template literals and interpolation does not break', () => {
    const result = compile([
      { id: 'code', kind: 'code', code: 'const msg = `Hello ${name}`; console.log(msg);' },
    ]);

    const source = result.source;
    const openBraces = (source.match(/{/g) || []).length;
    const closeBraces = (source.match(/}/g) || []).length;
    expect(openBraces).toBe(closeBraces);
  });

  it('code step with unbalanced brace still maintains wrapping structure', () => {
    const result = compile([
      { id: 'code', kind: 'code', code: 'if (true) { console.log("unclosed")' },
    ]);

    const source = result.source;
    const openBraces = (source.match(/{/g) || []).length;
    const closeBraces = (source.match(/}/g) || []).length;
    expect(openBraces).toBe(closeBraces);
  });

  it('loop with only comment steps does not flag empty-loop error', () => {
    const result = compile([
      {
        id: 'loop',
        kind: 'loop',
        source: { source: 'literal', value: 'items' },
        itemName: 'item',
        body: { steps: [{ id: 'note', kind: 'comment', text: 'just a comment' }] },
      },
    ]);

    const errorCodes = result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
    expect(errorCodes).not.toContain('empty-loop');
  });

  it('try with empty body but finally block is valid', () => {
    const result = compile([
      {
        id: 'try',
        kind: 'try',
        body: { steps: [] },
        finally: { steps: [{ id: 'cleanup', kind: 'comment', text: 'cleanup' }] },
      },
    ]);

    expect(result.source).toContain('try {');
    expect(result.source).toContain('} finally {');
  });

  it('snippet with return statement in block scope', () => {
    const snippet = {
      formatVersion: 2 as const,
      id: 'test-snippet',
      name: 'Test snippet',
      description: 'Test',
      params: [],
      outputs: [{ name: 'result', type: 'string' as const }],
      code: 'result = "value";\nreturn result;',
    };

    const result = compileFlow(
      doc([{ id: 'use', kind: 'useSnippet', snippetId: 'test-snippet', args: {} }]),
      { snippets: [snippet] },
    );

    const source = result.source;
    const openBraces = (source.match(/{/g) || []).length;
    const closeBraces = (source.match(/}/g) || []).length;
    expect(openBraces).toBe(closeBraces);
  });
});
