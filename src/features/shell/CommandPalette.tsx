import { useEffect, useMemo, useRef, useState } from 'react';
import { blockLibrary, blockRegistry, type FlowStepKind } from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';
import type { StoredTestFlow } from '../../types';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  tests: StoredTestFlow[];
  onOpenTest: (testId: string) => void;
  actions: { label: string; hint?: string; run: () => void }[];
}

function score(command: Command, query: string): number {
  if (!query) {
    return 1;
  }

  const haystack = `${command.group} ${command.label}`.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack.includes(needle)) {
    return 100 - haystack.indexOf(needle);
  }

  // Subsequence match, so "opg" still finds "Open page".
  let index = 0;

  for (const character of needle) {
    index = haystack.indexOf(character, index);

    if (index === -1) {
      return 0;
    }

    index += 1;
  }

  return 1;
}

export function CommandPalette({ open, onClose, tests, onOpenTest, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const appendStep = useEditorStore((state) => state.appendStep);

  const commands = useMemo<Command[]>(
    () => [
      ...actions.map((action, index) => ({
        id: `action-${index}`,
        label: action.label,
        hint: action.hint,
        group: 'Studio',
        run: action.run,
      })),
      ...blockLibrary.map((kind: FlowStepKind) => ({
        id: `add-${kind}`,
        label: `Add ${blockRegistry[kind].title}`,
        hint: blockRegistry[kind].codeLabel,
        group: 'Insert',
        run: () => appendStep(kind),
      })),
      ...tests.map((test) => ({
        id: `open-${test.id}`,
        label: test.name,
        hint: `${test.steps} steps`,
        group: 'Open flow',
        run: () => onOpenTest(test.id),
      })),
    ],
    [actions, tests, appendStep, onOpenTest],
  );

  const matches = useMemo(
    () =>
      commands
        .map((command) => ({ command, rank: score(command, query) }))
        .filter((entry) => entry.rank > 0)
        .sort((left, right) => right.rank - left.rank)
        .slice(0, 40)
        .map((entry) => entry.command),
    [commands, query],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) {
    return null;
  }

  const choose = (command: Command | undefined) => {
    if (!command) {
      return;
    }

    onClose();
    command.run();
  };

  return (
    <div className="palette" role="dialog" aria-label="Command palette" onClick={onClose}>
      <div className="palette__panel" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder="Search commands, blocks, and flows…"
          aria-label="Command"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, matches.length - 1));
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            }

            if (event.key === 'Enter') {
              event.preventDefault();
              choose(matches[active]);
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />

        <ul className="palette__list">
          {matches.length === 0 ? <li className="palette__empty">No matches</li> : null}

          {matches.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                className={index === active ? 'is-active' : ''}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(command)}
              >
                <span className="palette__group">{command.group}</span>
                <span className="palette__label">{command.label}</span>
                {command.hint ? <span className="palette__hint">{command.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
