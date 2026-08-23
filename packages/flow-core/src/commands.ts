import { childSequences, type FlowDocument, type FlowStep, type Sequence } from './ir';

export type ScopeSlot = 'then' | 'else' | 'body' | 'catch' | 'finally';

export interface StepPath {
  parentId: string | null;
  slot: ScopeSlot | null;
  index: number;
}

function cloneSequence(sequence: Sequence | undefined): Sequence {
  // Hand-edited files can omit a scope body; treat it as empty rather than
  // throwing while copying the document.
  return { steps: Array.isArray(sequence?.steps) ? sequence.steps.map(cloneStep) : [] };
}

function cloneStep(step: FlowStep): FlowStep {
  switch (step.kind) {
    case 'condition':
      return {
        ...step,
        then: cloneSequence(step.then),
        ...(step.else ? { else: cloneSequence(step.else) } : {}),
      };
    case 'loop':
      return { ...step, body: cloneSequence(step.body) };
    case 'try':
      return {
        ...step,
        body: cloneSequence(step.body),
        ...(step.catch ? { catch: { ...step.catch, body: cloneSequence(step.catch.body) } } : {}),
        ...(step.finally ? { finally: cloneSequence(step.finally) } : {}),
      };
    default:
      return { ...step };
  }
}

export function sequenceAt(
  document: FlowDocument,
  parentId: string | null,
  slot: ScopeSlot | null,
): Sequence | null {
  if (parentId == null) {
    return document.root;
  }

  let found: Sequence | null = null;

  const search = (sequence: Sequence) => {
    for (const step of sequence.steps) {
      if (step.id === parentId) {
        if (step.kind === 'condition') {
          if (slot === 'then') {
            found = step.then;
          } else if (slot === 'else') {
            if (!step.else) {
              step.else = { steps: [] };
            }
            found = step.else;
          }
        } else if (step.kind === 'loop' && slot === 'body') {
          found = step.body;
        } else if (step.kind === 'try') {
          if (slot === 'body') {
            found = step.body;
          } else if (slot === 'catch') {
            if (!step.catch) {
              step.catch = { errorName: 'error', body: { steps: [] } };
            }
            found = step.catch.body;
          } else if (slot === 'finally') {
            if (!step.finally) {
              step.finally = { steps: [] };
            }
            found = step.finally;
          }
        }

        return;
      }

      childSequences(step).forEach(search);

      if (found) {
        return;
      }
    }
  };

  search(document.root);
  return found;
}

export function locateStep(document: FlowDocument, stepId: string): StepPath | null {
  let path: StepPath | null = null;

  const search = (sequence: Sequence, parentId: string | null, slot: ScopeSlot | null) => {
    sequence.steps.forEach((step, index) => {
      if (step.id === stepId) {
        path = { parentId, slot, index };
        return;
      }

      const searchIfPresent = (sequence: Sequence | undefined, slot: ScopeSlot) => {
        if (sequence && Array.isArray(sequence.steps)) {
          search(sequence, step.id, slot);
        }
      };

      if (step.kind === 'condition') {
        searchIfPresent(step.then, 'then');
        searchIfPresent(step.else, 'else');
      } else if (step.kind === 'loop') {
        searchIfPresent(step.body, 'body');
      } else if (step.kind === 'try') {
        searchIfPresent(step.body, 'body');
        searchIfPresent(step.catch?.body, 'catch');
        searchIfPresent(step.finally, 'finally');
      }
    });
  };

  search(document.root, null, null);
  return path;
}

export function isDescendant(
  document: FlowDocument,
  ancestorId: string,
  candidateId: string,
): boolean {
  let ancestor: FlowStep | null = null;

  const find = (sequence: Sequence) => {
    for (const step of sequence.steps) {
      if (step.id === ancestorId) {
        ancestor = step;
        return;
      }

      childSequences(step).forEach(find);

      if (ancestor) {
        return;
      }
    }
  };

  find(document.root);

  if (!ancestor) {
    return false;
  }

  let contains = false;

  const scan = (sequence: Sequence) => {
    for (const step of sequence.steps) {
      if (step.id === candidateId) {
        contains = true;
        return;
      }

      childSequences(step).forEach(scan);
    }
  };

  childSequences(ancestor).forEach(scan);
  return contains;
}

function withDocument(document: FlowDocument, mutate: (draft: FlowDocument) => void): FlowDocument {
  const draft: FlowDocument = {
    ...document,
    root: cloneSequence(document.root),
    layout: {
      ...document.layout,
      positions: { ...document.layout.positions },
      ...(document.layout.collapsedScopes
        ? { collapsedScopes: { ...document.layout.collapsedScopes } }
        : {}),
    },
  };

  mutate(draft);
  return draft;
}

export function insertStep(document: FlowDocument, step: FlowStep, at: StepPath): FlowDocument {
  return withDocument(document, (draft) => {
    const sequence = sequenceAt(draft, at.parentId, at.slot);

    if (!sequence) {
      return;
    }

    const index = Math.max(0, Math.min(at.index, sequence.steps.length));
    sequence.steps.splice(index, 0, step);
  });
}

export function removeStep(document: FlowDocument, stepId: string): FlowDocument {
  return withDocument(document, (draft) => {
    const path = locateStep(draft, stepId);

    if (!path) {
      return;
    }

    const sequence = sequenceAt(draft, path.parentId, path.slot);
    sequence?.steps.splice(path.index, 1);
    delete draft.layout.positions[stepId];
  });
}

export function moveStep(document: FlowDocument, stepId: string, to: StepPath): FlowDocument {
  if (to.parentId === stepId || (to.parentId && isDescendant(document, stepId, to.parentId))) {
    return document;
  }

  return withDocument(document, (draft) => {
    const path = locateStep(draft, stepId);

    if (!path) {
      return;
    }

    const from = sequenceAt(draft, path.parentId, path.slot);

    if (!from) {
      return;
    }

    const [step] = from.steps.splice(path.index, 1);
    const target = sequenceAt(draft, to.parentId, to.slot);

    if (!target) {
      from.steps.splice(path.index, 0, step);
      return;
    }

    const sameSequence = path.parentId === to.parentId && path.slot === to.slot;
    const adjusted = sameSequence && to.index > path.index ? to.index - 1 : to.index;
    target.steps.splice(Math.max(0, Math.min(adjusted, target.steps.length)), 0, step);
  });
}

export function updateStep(
  document: FlowDocument,
  stepId: string,
  update: (step: FlowStep) => FlowStep,
): FlowDocument {
  return withDocument(document, (draft) => {
    const apply = (sequence: Sequence) => {
      sequence.steps.forEach((step, index) => {
        if (step.id === stepId) {
          sequence.steps[index] = update(step);
          return;
        }

        childSequences(step).forEach(apply);
      });
    };

    apply(draft.root);
  });
}

export function wrapInScope(
  document: FlowDocument,
  stepIds: string[],
  scope: FlowStep,
): FlowDocument {
  if (stepIds.length === 0) {
    return document;
  }

  const firstPath = locateStep(document, stepIds[0]);

  if (!firstPath) {
    return document;
  }

  return withDocument(document, (draft) => {
    const sequence = sequenceAt(draft, firstPath.parentId, firstPath.slot);

    if (!sequence) {
      return;
    }

    const moved: FlowStep[] = [];

    for (const stepId of stepIds) {
      const index = sequence.steps.findIndex((step) => step.id === stepId);

      if (index >= 0) {
        moved.push(...sequence.steps.splice(index, 1));
      }
    }

    const target =
      scope.kind === 'condition'
        ? scope.then
        : scope.kind === 'loop'
          ? scope.body
          : scope.kind === 'try'
            ? scope.body
            : null;

    if (target) {
      target.steps.push(...moved);
    }

    sequence.steps.splice(Math.min(firstPath.index, sequence.steps.length), 0, scope);
  });
}

export function setPosition(
  document: FlowDocument,
  stepId: string,
  position: { x: number; y: number },
): FlowDocument {
  return withDocument(document, (draft) => {
    draft.layout.positions[stepId] = position;
  });
}
