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

describe('LABEL NEWLINE CHECK', () => {
  it('step label with newline', () => {
    const result = compileFlow(doc([
      { id: 'a', kind: 'click', target: testId('x'), label: 'Click\nthe\nbutton' }
    ]));

    console.log('\n=== Step label with newlines (raw console) ===');
    const testStepLine = result.source.split('\n').find(l => l.includes('test.step'));
    console.log('test.step line:');
    console.log(testStepLine);
    
    console.log('\n=== Trying to parse ===');
    try {
      new Function(result.source);
      console.log('PARSES OK');
    } catch (e) {
      console.log('PARSE ERROR:', e.message);
    }
  });
});
