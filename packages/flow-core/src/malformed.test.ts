import { describe, expect, it } from 'vitest';
import { compileFlow } from './compiler';
import { projectFlowToCanvas } from './projection';
import { locateStep, moveStep, removeStep } from './commands';
import { FLOW_FORMAT_VERSION, type FlowDocument } from './ir';

/**
 * Flow files are editable by hand, so every one of these shapes can reach the
 * compiler from disk. None of them may throw: a malformed flow is a diagnostic,
 * not a crashed request.
 */
const malformed: [string, unknown][] = [
  ['no kind', { id: 'a' }],
  ['unknown kind', { id: 'a', kind: 'teleport' }],
  ['click with null target', { id: 'a', kind: 'click', target: null }],
  ['click with empty target', { id: 'a', kind: 'click', target: {} }],
  [
    'condition with null then',
    { id: 'a', kind: 'condition', predicate: { type: 'expression', code: 'true' }, then: null },
  ],
  ['condition with no predicate', { id: 'a', kind: 'condition', then: { steps: [] } }],
  [
    'loop with no body',
    { id: 'a', kind: 'loop', source: { source: 'literal', value: 'r' }, itemName: 'i' },
  ],
  ['try with nothing', { id: 'a', kind: 'try' }],
  [
    'assert with no assertion',
    {
      id: 'a',
      kind: 'assert',
      target: { base: { by: 'testId', value: { source: 'literal', value: 'x' } } },
    },
  ],
  ['assertPage with no assertion', { id: 'a', kind: 'assertPage' }],
  ['call with no target', { id: 'a', kind: 'call' }],
  [
    'extract with no variable',
    {
      id: 'a',
      kind: 'extract',
      target: { base: { by: 'testId', value: { source: 'literal', value: 'x' } } },
    },
  ],
  ['comment with null text', { id: 'a', kind: 'comment', text: null }],
];

function documentWith(step: unknown): FlowDocument {
  return {
    formatVersion: FLOW_FORMAT_VERSION,
    id: 'flow',
    name: 'Flow',
    status: 'draft',
    root: { steps: [step] },
    layout: { positions: {} },
  } as FlowDocument;
}

describe('a hand-edited flow file', () => {
  it.each(malformed)('reports rather than throws: %s', (_label, step) => {
    const document = documentWith(step);

    expect(() => compileFlow(document)).not.toThrow();
    expect(() => projectFlowToCanvas(document)).not.toThrow();
    expect(() => locateStep(document, 'a')).not.toThrow();
    expect(() => removeStep(document, 'a')).not.toThrow();
    expect(() => moveStep(document, 'a', { parentId: null, slot: null, index: 0 })).not.toThrow();
  });

  it('names the missing scope body instead of failing silently', () => {
    const codes = compileFlow(
      documentWith({
        id: 'a',
        kind: 'loop',
        source: { source: 'literal', value: 'r' },
        itemName: 'i',
      }),
    ).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('malformed-scope');
  });

  it('still emits a syntactically balanced file', () => {
    malformed.forEach(([, step]) => {
      const { source } = compileFlow(documentWith(step));

      expect((source.match(/\{/g) ?? []).length).toBe((source.match(/\}/g) ?? []).length);
    });
  });
});
