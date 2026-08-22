import { describe, expect, it } from 'vitest';
import { compileFlow, hasBlockingDiagnostics } from '../../flow-core/src/compiler';
import { importSpecSource } from './import-spec';

function importOne(source: string) {
  const result = importSpecSource(source);
  expect(result.tests).toHaveLength(1);
  return { ...result.tests[0], scaffold: result.scaffold, fileDiagnostics: result.diagnostics };
}

describe('actions', () => {
  it('imports the common action vocabulary', () => {
    const { document, fidelity } = importOne(`
      import { expect, test } from '@playwright/test';

      test('actions', async ({ page }) => {
        await page.goto('https://example.com');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await page.getByLabel('Email').fill('qa@example.com');
        await page.getByTestId('terms').check();
        await page.getByLabel('Country').selectOption('DE');
        await page.getByTestId('search').press('Enter');
        await page.getByRole('link', { name: 'Docs' }).hover();
      });
    `);

    expect(document.root.steps.map((step) => step.kind)).toEqual([
      'navigate',
      'click',
      'fill',
      'check',
      'selectOption',
      'press',
      'hover',
    ]);
    expect(fidelity).toBe('structured');
  });

  it('preserves locator chains', () => {
    const { document } = importOne(`
      import { test } from '@playwright/test';

      test('chains', async ({ page }) => {
        await page.getByRole('row').filter({ hasText: 'Ada' }).nth(2).click();
      });
    `);

    expect(document.root.steps[0]).toMatchObject({
      kind: 'click',
      target: {
        base: { by: 'role', role: 'row' },
        hasText: { source: 'literal', value: 'Ada' },
        nth: 2,
      },
    });
  });
});

describe('assertions', () => {
  it('imports matchers including negation', () => {
    const { document } = importOne(`
      import { expect, test } from '@playwright/test';

      test('assertions', async ({ page }) => {
        await expect(page.getByTestId('title')).toBeVisible();
        await expect(page.getByTestId('title')).toContainText('Dashboard');
        await expect(page.getByTestId('rows')).toHaveCount(3);
        await expect(page.getByTestId('error')).not.toBeVisible();
        await expect(page).toHaveURL('/dashboard');
      });
    `);

    expect(document.root.steps.map((step) => step.kind)).toEqual([
      'assert',
      'assert',
      'assert',
      'assert',
      'assertPage',
    ]);
    expect(document.root.steps[3]).toMatchObject({
      assertion: { type: 'visible', negated: true },
    });
  });
});

describe('control flow', () => {
  it('imports a visibility condition with both branches', () => {
    const { document } = importOne(`
      import { test } from '@playwright/test';

      test('condition', async ({ page }) => {
        if (await page.getByTestId('toast').isVisible()) {
          await page.getByTestId('dismiss').click();
        } else {
          await page.getByTestId('other').click();
        }
      });
    `);

    const [condition] = document.root.steps;

    expect(condition).toMatchObject({
      kind: 'condition',
      predicate: { type: 'locatorVisible' },
    });
    expect(condition.kind === 'condition' && condition.then.steps).toHaveLength(1);
    expect(condition.kind === 'condition' && condition.else?.steps).toHaveLength(1);
  });

  it('imports a negated condition', () => {
    const { document } = importOne(`
      import { test } from '@playwright/test';

      test('negated', async ({ page }) => {
        if (!(await page.getByTestId('banner').isVisible())) {
          await page.getByTestId('reload').click();
        }
      });
    `);

    expect(document.root.steps[0]).toMatchObject({
      predicate: { type: 'locatorVisible', negated: true },
    });
  });

  it('imports loops and try/catch/finally', () => {
    const { document } = importOne(`
      import { test } from '@playwright/test';

      test('flow', async ({ page }) => {
        for (const row of rows) {
          await page.getByTestId('cell').click();
        }

        try {
          await page.getByTestId('risky').click();
        } catch (error) {
          await page.getByTestId('fallback').click();
        } finally {
          await page.getByTestId('cleanup').click();
        }
      });
    `);

    const [loop, tryStep] = document.root.steps;

    expect(loop).toMatchObject({ kind: 'loop', itemName: 'row' });
    expect(tryStep).toMatchObject({ kind: 'try' });
    expect(tryStep.kind === 'try' && tryStep.catch?.errorName).toBe('error');
    expect(tryStep.kind === 'try' && tryStep.finally?.steps).toHaveLength(1);
  });
});

describe('test.step and labels', () => {
  it('adopts a test.step title as the step label', () => {
    const { document } = importOne(`
      import { test } from '@playwright/test';

      test('labelled', async ({ page }) => {
        await test.step('Sign the user in', async () => {
          await page.getByTestId('submit').click();
        });
      });
    `);

    expect(document.root.steps[0]).toMatchObject({
      kind: 'click',
      label: 'Sign the user in',
    });
  });

  it('flattens a multi-statement test.step', () => {
    const { document } = importOne(`
      import { test } from '@playwright/test';

      test('grouped', async ({ page }) => {
        await test.step('Fill the form', async () => {
          await page.getByLabel('Email').fill('a@b.co');
          await page.getByTestId('submit').click();
        });
      });
    `);

    expect(document.root.steps.map((step) => step.kind)).toEqual(['fill', 'click']);
  });
});

describe('extract', () => {
  it('imports variable extraction', () => {
    const { document } = importOne(`
      import { test } from '@playwright/test';

      test('extract', async ({ page }) => {
        const orderCount = await page.getByTestId('count').textContent();
        const rows = await page.getByRole('row').count();
      });
    `);

    expect(document.root.steps[0]).toMatchObject({
      kind: 'extract',
      variable: 'orderCount',
      property: 'text',
    });
    expect(document.root.steps[1]).toMatchObject({ property: 'count' });
  });
});

describe('escape hatch', () => {
  it('keeps unmappable statements as custom code and reports them', () => {
    const { document, fidelity, opaqueSteps, diagnostics } = importOne(`
      import { test } from '@playwright/test';

      test('mixed', async ({ page }) => {
        await page.goto('https://example.com');
        await page.evaluate(() => window.scrollTo(0, 500));
        await helpers.signIn(page, user);
      });
    `);

    expect(fidelity).toBe('mixed');
    expect(opaqueSteps).toBe(2);
    expect(document.root.steps[1]).toMatchObject({ kind: 'code' });
    expect(document.root.steps[1].kind === 'code' && document.root.steps[1].code).toContain(
      'page.evaluate',
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('opaque-statement');
  });

  it('reports hooks it deliberately leaves in the scaffold', () => {
    const result = importSpecSource(`
      import { test } from '@playwright/test';

      test.beforeEach(async ({ page }) => {
        await page.goto('/');
      });

      test('after hook', async ({ page }) => {
        await page.getByTestId('go').click();
      });
    `);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('hook-preserved');
    expect(result.scaffold[0]).toContain("import { test }");
  });
});

describe('multiple tests', () => {
  it('imports every test in a file', () => {
    const result = importSpecSource(`
      import { test } from '@playwright/test';

      test('first', async ({ page }) => {
        await page.goto('/one');
      });

      test('second', async ({ page }) => {
        await page.goto('/two');
      });
    `);

    expect(result.tests.map((test) => test.document.name)).toEqual(['first', 'second']);
  });
});

describe('round trip', () => {
  it('recompiles an imported spec into equivalent Playwright code', () => {
    const source = `
      import { expect, test } from '@playwright/test';

      test('Login path', async ({ page }) => {
        await page.goto('https://app.example.com/login');
        await page.getByLabel('Email').fill('qa@example.com');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByTestId('dashboard-title')).toContainText('Dashboard');
        if (await page.getByTestId('toast').isVisible()) {
          await page.getByTestId('dismiss').click();
        }
      });
    `;

    const { document, fidelity } = importOne(source);
    const compiled = compileFlow(document);

    expect(fidelity).toBe('structured');
    expect(hasBlockingDiagnostics(compiled)).toBe(false);
    expect(compiled.source).toContain('await page.goto("https://app.example.com/login");');
    expect(compiled.source).toContain('await page.getByLabel("Email").fill("qa@example.com");');
    expect(compiled.source).toContain(
      'await page.getByRole("button", { name: "Sign in" }).click();',
    );
    expect(compiled.source).toContain(
      'await expect(page.getByTestId("dashboard-title")).toContainText("Dashboard");',
    );
    expect(compiled.source).toContain('if (await page.getByTestId("toast").isVisible()) {');
  });

  it('round trips a spec Studio itself generated', () => {
    const original = compileFlow({
      formatVersion: 2,
      id: 'generated',
      name: 'Generated flow',
      status: 'draft',
      root: {
        steps: [
          { id: 'a', kind: 'navigate', url: { source: 'literal', value: 'https://example.com' } },
          {
            id: 'b',
            kind: 'click',
            label: 'Open the menu',
            target: { base: { by: 'testId', value: { source: 'literal', value: 'menu' } } },
          },
          {
            id: 'c',
            kind: 'assert',
            target: { base: { by: 'testId', value: { source: 'literal', value: 'panel' } } },
            assertion: { type: 'visible' },
          },
        ],
      },
      layout: { positions: {} },
    });

    const { document, fidelity } = importOne(original.source);
    const recompiled = compileFlow(document);

    expect(fidelity).toBe('structured');
    expect(document.root.steps[1].label).toBe('Open the menu');

    const meaningful = (source: string) =>
      source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('await page.') || line.startsWith('await expect('));

    expect(meaningful(recompiled.source)).toEqual(meaningful(original.source));
  });
});
