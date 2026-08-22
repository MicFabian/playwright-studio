import * as icons from 'lucide-react';
import { blockLibrary, blockRegistry, type BlockCategory } from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';

const CATEGORY_ORDER: BlockCategory[] = ['entry', 'action', 'assertion', 'logic', 'annotation'];

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  entry: 'Entry',
  action: 'Actions',
  assertion: 'Assertions',
  logic: 'Logic',
  annotation: 'Notes',
};

function Icon({ name }: { name: string }) {
  const Component = (icons as unknown as Record<string, icons.LucideIcon>)[name];
  return Component ? <Component size={14} aria-hidden /> : null;
}

export function BlockLibrary() {
  const appendStep = useEditorStore((state) => state.appendStep);
  const hasDocument = useEditorStore((state) => state.document != null);

  return (
    <nav className="library" aria-label="Block library">
      {CATEGORY_ORDER.map((category) => {
        const kinds = blockLibrary.filter((kind) => blockRegistry[kind].category === category);

        if (kinds.length === 0) {
          return null;
        }

        return (
          <section key={category} className="library__group">
            <h2 className="library__heading">{CATEGORY_LABELS[category]}</h2>
            {kinds.map((kind) => {
              const definition = blockRegistry[kind];

              return (
                <button
                  key={kind}
                  type="button"
                  className="library__block"
                  disabled={!hasDocument}
                  title={definition.description}
                  style={{ '--block-accent': definition.accentToken } as React.CSSProperties}
                  onClick={() => appendStep(kind)}
                >
                  <Icon name={definition.icon} />
                  <span>{definition.title}</span>
                </button>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}
