import { describe, expect, it } from 'vitest';
import { compileFlow, hasBlockingDiagnostics } from './compiler';
import { isV1Flow, migrateV1Flow, type V1Flow } from './migrate-v1';
import { FLOW_FORMAT_VERSION } from './ir';

function node(id: string, kind: string, fields: Record<string, string>, extra: object = {}) {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      kind,
      fields: Object.entries(fields).map(([key, value]) => ({ key, value })),
      ...extra,
    },
  };
}

describe('detection', () => {
  it('recognizes v1 documents and ignores v2 ones', () => {
    expect(isV1Flow({ nodes: [], edges: [] })).toBe(true);
    expect(isV1Flow({ formatVersion: FLOW_FORMAT_VERSION, nodes: [] })).toBe(false);
    expect(isV1Flow(null)).toBe(false);
  });
});

describe('ordering', () => {
  it('follows edges rather than array order', () => {
    const raw: V1Flow = {
      id: 'ordered',
      name: 'Ordered',
      nodes: [
        node('c', 'click', { locatorKind: 'data-testid', locatorValue: 'third' }),
        node('a', 'navigate', { url: 'https://example.com' }),
        node('b', 'click', { locatorKind: 'data-testid', locatorValue: 'second' }),
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    };

    const { document } = migrateV1Flow(raw, 'ordered');

    expect(document.root.steps.map((step) => step.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('selector upgrade', () => {
  it('turns legacy data-testid selectors into getByTestId', () => {
    const { document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [node('a', 'click', { locatorKind: 'data-testid', locatorValue: 'submit' })],
        edges: [],
      },
      'f',
    );

    expect(document.root.steps[0]).toMatchObject({
      kind: 'click',
      target: { base: { by: 'testId', value: { source: 'literal', value: 'submit' } } },
    });
    expect(compileFlow(document).source).toContain('page.getByTestId("submit")');
  });

  it('keeps unmappable selectors as css instead of guessing', () => {
    const { document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [node('a', 'click', { locator: 'div.card > button:nth-child(2)' })],
        edges: [],
      },
      'f',
    );

    expect(document.root.steps[0]).toMatchObject({
      target: { base: { by: 'css' } },
    });
  });

  it('reads the assert target group, not the locator group', () => {
    const { document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [
          node('a', 'assert', {
            targetKind: 'data-testid',
            targetValue: 'dashboard-title',
            expectation: 'Dashboard',
          }),
        ],
        edges: [],
      },
      'f',
    );

    expect(compileFlow(document).source).toContain(
      'await expect(page.getByTestId("dashboard-title")).toContainText("Dashboard");',
    );
  });
});

describe('labels', () => {
  it('keeps a customized title but drops template defaults', () => {
    const { document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [
          node('a', 'click', {}, { title: 'Submit the login form' }),
          node('b', 'click', {}, { title: 'Click target' }),
        ],
        edges: [{ source: 'a', target: 'b' }],
      },
      'f',
    );

    expect(document.root.steps[0].label).toBe('Submit the login form');
    expect(document.root.steps[1].label).toBeUndefined();
  });
});

describe('presentation is dropped', () => {
  it('does not persist accent, description, or field labels', () => {
    const { document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [
          {
            id: 'a',
            position: { x: 10, y: 20 },
            data: {
              kind: 'navigate',
              title: 'Open page',
              description: 'Boot a browser page.',
              accent: '#19c2b0',
              codeLabel: 'page.goto()',
              category: 'entry',
              fields: [{ key: 'url', label: 'URL', value: 'https://example.com' }],
            },
          } as never,
        ],
        edges: [],
      },
      'f',
    );

    const serialized = JSON.stringify(document);

    expect(serialized).not.toContain('#19c2b0');
    expect(serialized).not.toContain('Boot a browser page.');
    expect(serialized).not.toContain('codeLabel');
    expect(document.layout.positions.a).toEqual({ x: 10, y: 20 });
  });
});

describe('condition and loop fail loudly', () => {
  it('reports a blocking note for a condition whose body v1 could not express', () => {
    const { document, notes } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [node('a', 'condition', { guardKind: 'data-testid', guardValue: 'toast-error' })],
        edges: [],
      },
      'f',
    );

    const blocking = notes.filter((note) => note.severity === 'error');

    expect(blocking.map((note) => note.code)).toContain('condition-body-lost');
    expect(document.root.steps[0]).toMatchObject({ kind: 'condition', then: { steps: [] } });
    expect(hasBlockingDiagnostics(compileFlow(document))).toBe(true);
  });

  it('reports a blocking note for a loop body', () => {
    const { notes, document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [node('a', 'loop', { collection: 'rows', alias: 'row' })],
        edges: [],
      },
      'f',
    );

    expect(notes.map((note) => note.code)).toContain('loop-body-lost');
    expect(hasBlockingDiagnostics(compileFlow(document))).toBe(true);
  });

  it('does not silently regenerate the old decorative comment', () => {
    const { document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [node('a', 'condition', { guardValue: 'x', guardKind: 'data-testid' })],
        edges: [],
      },
      'f',
    );

    expect(compileFlow(document).source).not.toContain('Attach branch blocks');
  });
});

describe('code and snippets', () => {
  it('preserves custom code verbatim', () => {
    const code = "await page.waitForLoadState('networkidle');";
    const { document } = migrateV1Flow(
      { id: 'f', name: 'F', nodes: [node('a', 'code', { code })], edges: [] },
      'f',
    );

    expect(document.root.steps[0]).toMatchObject({ kind: 'code', code });
  });

  it('inlines snippets and says so', () => {
    const { document, notes } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [node('a', 'snippet', {}, { snippetCode: 'await page.reload();', title: 'Reload' })],
        edges: [],
      },
      'f',
    );

    expect(document.root.steps[0]).toMatchObject({ kind: 'code', code: 'await page.reload();' });
    expect(notes.map((note) => note.code)).toContain('snippet-inlined');
  });

  it('binds snippet parameters so inlined code still resolves them', () => {
    const { document } = migrateV1Flow(
      {
        id: 'f',
        name: 'F',
        nodes: [
          {
            id: 'a',
            position: { x: 0, y: 0 },
            data: {
              kind: 'snippet',
              title: 'Wait for dashboard',
              fields: [{ key: 'headline', value: 'Dashboard' }],
              snippetCode: 'await expect(page.getByTestId("t")).toContainText(headline);',
            },
          },
        ],
        edges: [],
      },
      'f',
    );

    const { source } = compileFlow(document);

    expect(source).toContain('const headline = "Dashboard";');
    expect(source).toContain('toContainText(headline);');
  });
});

describe('round trip', () => {
  it('produces a compilable document for a realistic v1 flow', () => {
    const raw: V1Flow = {
      id: 'login-path',
      name: 'Login path',
      status: 'stable',
      nodes: [
        node('n1', 'navigate', { url: 'https://app.example.com/login' }),
        node('n2', 'fill', { locatorKind: 'name', locatorValue: 'email', value: 'qa@example.com' }),
        node('n3', 'click', { locatorKind: 'data-testid', locatorValue: 'submit-login' }),
        node('n4', 'assert', {
          targetKind: 'data-testid',
          targetValue: 'dashboard-title',
          expectation: 'Dashboard',
        }),
      ],
      edges: [
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' },
        { source: 'n3', target: 'n4' },
      ],
    };

    const { document } = migrateV1Flow(raw, 'login-path');
    const result = compileFlow(document);

    expect(document.formatVersion).toBe(FLOW_FORMAT_VERSION);
    expect(document.status).toBe('stable');
    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source).toContain('await page.goto("https://app.example.com/login");');
    expect(result.source).toContain('.fill("qa@example.com");');
    expect(result.source).toContain('page.getByTestId("submit-login").click()');
  });
});
