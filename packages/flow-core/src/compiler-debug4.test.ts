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

describe('DEBUG 4', () => {
  it('flow name WITH quotes gets injected into test()', () => {
    const result = compileFlow(
      doc([{ id: 'a', kind: 'click', target: testId('x') }]),
      { name: 'Test "quoted" flow' }
    );

    console.log('\n=== Flow name with quotes ===');
    console.log(result.source);
    const hasQuoteEscape = result.source.includes('Test \\"quoted\\" flow');
    console.log('Has proper escape:', hasQuoteEscape);
  });

  it('flow name with backslash', () => {
    const result = compileFlow(
      doc([{ id: 'a', kind: 'click', target: testId('x') }]),
      { name: 'Test \\ backslash flow' }
    );

    console.log('\n=== Flow name with backslash ===');
    console.log(result.source);
  });

  it('step label with newline in test.step', () => {
    const result = compileFlow(doc([
      { id: 'a', kind: 'click', target: testId('x'), label: 'Click\nthe\nbutton' }
    ]));

    console.log('\n=== Step label with newlines ===');
    console.log(result.source);
  });

  it('extract in then + else both declaring same variable', () => {
    const result = compileFlow(doc([
      {
        id: 'cond',
        kind: 'condition',
        predicate: { type: 'expression', code: 'x' },
        then: { steps: [{ id: 'a', kind: 'extract', target: testId('v1'), variable: 'result' }] },
        else: { steps: [{ id: 'b', kind: 'extract', target: testId('v2'), variable: 'result' }] }
      },
      { id: 'c', kind: 'fill', target: testId('y'), value: { source: 'variable', name: 'result' } }
    ]));

    console.log('\n=== Extract same variable in then and else ===');
    console.log(result.source);
    const letCount = (result.source.match(/let result;/g) || []).length;
    console.log('Count of "let result;":', letCount);
  });

  it('loop with extract then use same variable in next iteration', () => {
    const result = compileFlow(doc([
      {
        id: 'loop',
        kind: 'loop',
        source: { source: 'literal', value: 'items' },
        itemName: 'item',
        body: {
          steps: [
            { id: 'e', kind: 'extract', target: testId('v'), variable: 'val' },
            { id: 'c', kind: 'click', target: testId('btn') }
          ]
        }
      },
      { id: 'after', kind: 'fill', target: testId('f'), value: { source: 'variable', name: 'val' } }
    ]));

    console.log('\n=== Loop extract and use after ===');
    console.log(result.source);
  });

  it('nested try-catch-finally complex scoping', () => {
    const result = compileFlow(doc([
      {
        id: 'outer',
        kind: 'try',
        body: {
          steps: [{
            id: 'inner',
            kind: 'try',
            body: { steps: [{ id: 'c', kind: 'click', target: testId('x') }] },
            catch: {
              errorName: 'e1',
              body: { steps: [{ id: 'e', kind: 'extract', target: testId('err1'), variable: 'innerErr' }] }
            }
          }]
        },
        catch: {
          errorName: 'e2',
          body: { steps: [{ id: 'e2', kind: 'extract', target: testId('err2'), variable: 'outerErr' }] }
        }
      },
      { id: 'use', kind: 'fill', target: testId('f'), value: { source: 'variable', name: 'innerErr' } }
    ]));

    console.log('\n=== Nested try-catch ===');
    console.log(result.source);
    console.log('Errors:', result.diagnostics.filter(d => d.severity === 'error').map(d => d.code));
  });

  it('code step with actual syntax error brace', () => {
    const result = compileFlow(doc([
      { id: 'code', kind: 'code', code: 'if (true) { let x = 1; }} // double close' }
    ]));

    console.log('\n=== Code with extra close brace ===');
    console.log(result.source);
    const opens = (result.source.match(/{/g) || []).length;
    const closes = (result.source.match(/}/g) || []).length;
    console.log(`Brace count: { = ${opens}, } = ${closes}`);
  });

  it('comment step with slash-asterisk', () => {
    const result = compileFlow(doc([
      { id: 'c1', kind: 'comment', text: 'This is /* not a real comment' },
      { id: 'c2', kind: 'comment', text: 'This ends */ the block' }
    ]));

    console.log('\n=== Comments with /* and */ ===');
    console.log(result.source);
  });

  it('extract then call using extracted variable', () => {
    const result = compileFlow(doc([
      { id: 'x', kind: 'extract', target: testId('v'), variable: 'val' },
      { id: 'call', kind: 'call', target: 'process', args: [{ source: 'variable', name: 'val' }] }
    ]));

    console.log('\n=== Extract then call with variable ===');
    console.log(result.source);
  });
});
