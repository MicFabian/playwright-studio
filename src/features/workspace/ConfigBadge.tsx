import { Settings2 } from 'lucide-react';
import type { PlaywrightConfigInfo } from '../../types';

export function ConfigBadge({ config }: { config: PlaywrightConfigInfo | undefined }) {
  if (!config) {
    return null;
  }

  const missing = config.diagnostics.find((diagnostic) => diagnostic.code === 'no-config');

  return (
    <details className="config-badge">
      <summary>
        <Settings2 size={12} aria-hidden />
        <span>{missing ? 'No Playwright config' : (config.configPath ?? 'Config')}</span>
      </summary>

      <dl className="config-badge__body">
        {config.baseURL ? (
          <>
            <dt>baseURL</dt>
            <dd>{config.baseURL}</dd>
          </>
        ) : null}

        {config.testIdAttribute ? (
          <>
            <dt>test id</dt>
            <dd>{config.testIdAttribute}</dd>
          </>
        ) : null}

        {config.projects.length > 0 ? (
          <>
            <dt>projects</dt>
            <dd>{config.projects.map((project) => project.name).join(', ')}</dd>
          </>
        ) : null}

        {config.hasWebServer ? (
          <>
            <dt>webServer</dt>
            <dd>configured</dd>
          </>
        ) : null}
      </dl>

      {config.diagnostics.length > 0 ? (
        <ul className="config-badge__diagnostics">
          {config.diagnostics.map((diagnostic) => (
            <li key={diagnostic.code}>{diagnostic.message}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
