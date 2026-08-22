import { useMemo, useState } from 'react';
import { compileFlow } from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';
import type { PlaywrightConfigInfo, SnippetItem } from '../../types';

interface CodePreviewProps {
  snippets?: SnippetItem[];
  playwrightConfig?: PlaywrightConfigInfo;
}

export function CodePreview({ snippets = [], playwrightConfig }: CodePreviewProps) {
  const document = useEditorStore((state) => state.document);
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () =>
      document
        ? compileFlow(document, {
            snippets,
            baseURL: playwrightConfig?.baseURL ?? null,
          })
        : null,
    [document, snippets, playwrightConfig],
  );

  if (!result) {
    return <div className="preview preview--empty">Select a flow to preview its spec.</div>;
  }

  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');

  return (
    <div className="preview">
      {errors.length > 0 ? (
        <ul className="diagnostics diagnostics--error">
          {errors.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`}>
              <strong>{diagnostic.code}</strong> {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="diagnostics diagnostics--warning">
          {warnings.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>
          ))}
        </ul>
      ) : null}

      <div className="preview__toolbar">
        <span>
          {errors.length > 0 ? 'Spec is not written while errors remain' : 'Generated spec'}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(result.source).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre className="preview__code">
        <code>{result.source}</code>
      </pre>
    </div>
  );
}
