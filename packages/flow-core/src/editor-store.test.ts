import { describe, expect, it } from 'vitest';
import { createStep } from './block-registry';
import { insertStep } from './commands';
import { FLOW_FORMAT_VERSION, countSteps, type FlowDocument } from './ir';

function baseDocument(id = 'flow'): FlowDocument {
  return {
    formatVersion: FLOW_FORMAT_VERSION,
    id,
    name: 'Flow',
    status: 'draft',
    root: { steps: [createStep('navigate', 'nav')] },
    layout: { positions: {} },
  };
}

// Mirrors the guard in src/stores/editorStore.ts: a workspace refresh must not
// discard edits the user has made to the flow they are still editing.
function applyLoad(
  current: { document: FlowDocument; dirty: boolean },
  incoming: FlowDocument,
): { document: FlowDocument; dirty: boolean } {
  if (current.document.id === incoming.id && current.dirty) {
    return current;
  }

  return { document: incoming, dirty: false };
}

describe('workspace refresh', () => {
  it('keeps unsaved edits when the same flow is refreshed underneath', () => {
    const edited = insertStep(baseDocument(), createStep('click', 'added'), {
      parentId: null,
      slot: null,
      index: 1,
    });

    const result = applyLoad({ document: edited, dirty: true }, baseDocument());

    expect(countSteps(result.document.root)).toBe(2);
    expect(result.dirty).toBe(true);
  });

  it('adopts a refresh once the edits are saved', () => {
    const saved = insertStep(baseDocument(), createStep('click', 'added'), {
      parentId: null,
      slot: null,
      index: 1,
    });

    const result = applyLoad({ document: saved, dirty: false }, baseDocument());

    expect(countSteps(result.document.root)).toBe(1);
  });

  it('always adopts a different flow', () => {
    const edited = insertStep(baseDocument('a'), createStep('click', 'added'), {
      parentId: null,
      slot: null,
      index: 1,
    });

    const result = applyLoad({ document: edited, dirty: true }, baseDocument('b'));

    expect(result.document.id).toBe('b');
  });
});
