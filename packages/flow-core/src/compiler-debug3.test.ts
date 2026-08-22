import { describe, it } from 'vitest';
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

describe('DEBUG 3', () => {
  it('call step with proper args', () => {
    const result = compileFlow(doc([
      { id: 'c', kind: 'call', target: 'myFunc', args: [{ source: 'literal', value: 'test' }] }
    ]));

    console.log('\n=== Call step proper ===');
    console.log(result.source);
  });

  it('call step missing args field', () => {
    try {
      const result = compileFlow(doc([
        { id: 'c', kind: 'call', target: 'myFunc' } as any
      ]));
      console.log('\n=== Call step missing args ===');
      console.log(result.source);
    } catch (e) {
      console.log('\n=== Call step missing args CRASHED ===');
      console.log(e.message);
    }
  });

  it('test name with quotes and backslashes', () => {
    const result = compileFlow(
      doc([{ id: 'a', kind: 'click', target: testId('x') }]),
      { overrides: undefined },
    );

    console.log('\n=== Test name generation (simple) ===');
    const name = 'Sample flow';
    console.log('Name in source:', result.source.includes(`test("Sample flow"`));
  });

  it('studio-run with special label characters', () => {
    const result = compileFlow(doc([
      { id: 'a', kind: 'click', target: testId('x'), label: 'Test [a] step "click"' }
    ]), { profile: 'studio-run' });

    console.log('\n=== Studio-run with special label ===');
    console.log(result.source);
  });

  it('variable from data column vs extract step', () => {
    const result = compileFlow(
      doc([
        { id: 'x', kind: 'extract', target: testId('val'), variable: 'email' },
        { id: 'f', kind: 'fill', target: testId('f'), value: { source: 'variable', name: 'email' } }
      ]),
      { data: { columns: [{ name: 'email' }], cases: [{ name: 'row1', values: { email: 'test@example.com' } }] } }
    );

    console.log('\n=== Data column shadowing extract ===');
    console.log(result.source);
    console.log('Errors:', result.diagnostics.filter(d => d.severity === 'error').map(d => d.code));
  });

  it('condition with empty then and else', () => {
    const result = compileFlow(doc([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'expression', code: 'true' },
        then: { steps: [] },
        else: { steps: [] }
      }
    ]));

    console.log('\n=== Empty condition ===');
    console.log(result.source);
    console.log('Errors:', result.diagnostics.filter(d => d.severity === 'error').map(d => d.code));
  });

  it('tryFinally without body only finally', () => {
    const result = compileFlow(doc([
      {
        id: 'try',
        kind: 'try',
        body: { steps: [] },
        finally: { steps: [{ id: 'c', kind: 'click', target: testId('x') }] }
      }
    ]));

    console.log('\n=== Try with empty body and finally only ===');
    console.log(result.source);
    console.log('Errors:', result.diagnostics.filter(d => d.severity === 'error').map(d => d.code));
  });

  it('predicate with code containing newline', () => {
    const result = compileFlow(doc([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'expression', code: 'x > 5\n&& y < 10' },
        then: { steps: [{ id: 'c', kind: 'click', target: testId('x') }] }
      }
    ]));

    console.log('\n=== Predicate with newline ===');
    console.log(result.source);
  });

  it('flow name with quotes', () => {
    const result = compileFlow(
      doc([{ id: 'a', kind: 'click', target: testId('x') }]),
      { name: 'Test "quoted" flow' }
    );

    console.log('\n=== Flow name with quotes ===');
    console.log(result.source);
  });

  it('useSnippet with reserved param names', () => {
    const snippet = {
      formatVersion: 2 as const,
      id: 'snip',
      name: 'Snippet',
      description: 'Desc',
      params: [{ name: 'page', type: 'string' as const }],
      outputs: [],
      code: 'console.log(page);'
    };

    const result = compileFlow(doc([
      { id: 'use', kind: 'useSnippet', snippetId: 'snip', args: { page: { source: 'literal', value: 'test' } } }
    ]), { snippets: [snippet] });

    console.log('\n=== Snippet with reserved param ===');
    console.log(result.source);
  });
});
