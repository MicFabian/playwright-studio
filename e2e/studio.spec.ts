import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __studioStepCount?: () => number;
  }
}

const library = (page: Page) => page.locator('.library');
const canvasNodes = (page: Page) => page.locator('.react-flow__node');

function stepCount(page: Page) {
  return page.evaluate(() => window.__studioStepCount?.() ?? 0);
}

async function addBlock(page: Page, name: string) {
  const button = library(page).getByRole('button', { name, exact: true });

  await expect(button).toBeEnabled();

  const before = await stepCount(page);

  await button.click();
  await expect.poll(() => stepCount(page)).toBe(before + 1);
}

async function openStudio(page: Page, baseURL: string) {
  const response = await page.request.get(`${baseURL}/api/launch-token`);
  const { token } = await response.json();
  await page.goto(`/#token=${token}`);
  await expect(page.locator('.studio')).toBeVisible();
}

test.beforeEach(async ({ page, baseURL }) => {
  // Reset before the first load: resetting afterwards would need a second page
  // load in every test just to see the restored workspace.
  await page.request.post(`${baseURL}/api/test-reset`);
  await openStudio(page, baseURL!);
  await expect(canvasNodes(page).first()).toBeVisible();
  await expect(library(page).getByRole('button', { name: 'Condition', exact: true })).toBeEnabled();
});

test('loads the workspace from disk', async ({ page }) => {
  await expect(page.locator('.explorer__list button')).not.toHaveCount(0);
  await expect(canvasNodes(page).first()).toBeVisible();
});

test('switching flows loads a different document', async ({ page }) => {
  const flows = page.locator('.explorer__list button');
  const first = await flows.first().textContent();

  await flows.nth(1).click();

  await expect(page.locator('.topbar__name')).not.toHaveValue(first?.trim() ?? '');
  await expect(canvasNodes(page).first()).toBeVisible();
});

test('adding a block marks the flow unsaved and updates the canvas', async ({ page }) => {
  await addBlock(page, 'Click');

  await expect(page.locator('.topbar__badge')).toHaveText('Unsaved');
});

test('a nested condition generates real branch code', async ({ page }) => {
  await addBlock(page, 'Condition');
  await page.locator('.step-node__slot', { hasText: 'then' }).click();

  await page.locator('.panel-tabs button', { hasText: 'Code' }).click();

  const code = page.locator('.preview__code');
  await expect(code).toContainText('isVisible()) {');
  await expect(page.locator('.diagnostics--error')).toHaveCount(0);
});

test('an empty branch blocks the spec instead of emitting a comment', async ({ page }) => {
  await addBlock(page, 'Condition');
  await page.locator('.panel-tabs button', { hasText: 'Code' }).click();

  await expect(page.locator('.diagnostics--error')).toContainText('empty-branch');
  await expect(page.locator('.preview__toolbar')).toContainText('not written');
  await expect(page.locator('.preview__code')).not.toContainText('Attach branch blocks');
});

test('the inspector edits a step and the code follows', async ({ page }) => {
  await addBlock(page, 'Fill input');
  await canvasNodes(page).last().click();

  const value = page.locator('.inspector-field', { hasText: 'Value' }).locator('input').first();
  await value.fill('imported@example.com');

  await page.locator('.panel-tabs button', { hasText: 'Code' }).click();
  await expect(page.locator('.preview__code')).toContainText('imported@example.com');
});

test('generated code prefers user-facing locators', async ({ page }) => {
  await page.locator('.panel-tabs button', { hasText: 'Code' }).click();

  const code = await page.locator('.preview__code').textContent();

  expect(code).toContain('test.step(');
  expect(code).toMatch(/getByTestId|getByRole|getByLabel/);
});

test('undo reverses an edit', async ({ page }) => {
  const before = await stepCount(page);

  await addBlock(page, 'Hover');

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => stepCount(page)).toBe(before);
});

test('a corrupt flow file does not stop the app from loading', async ({ page }) => {
  await expect(page.locator('.explorer__list button').first()).toBeVisible();
  await expect(page.locator('.explorer__problems')).toContainText('could not be read');

  await page.locator('.explorer__problems summary').click();
  await expect(page.locator('.explorer__problems')).toContainText('corrupt.flow.json');
});

test('edits are saved without pressing save', async ({ page }) => {
  await addBlock(page, 'Hover');

  await expect(page.locator('.topbar__badge')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.topbar__actions')).toContainText('Saved');

  await page.reload();
  await expect(page.locator('.studio')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__studioStepCount?.() ?? 0))
    .toBeGreaterThan(0);
});

test('switching flows keeps an edit that has not autosaved yet', async ({ page }) => {
  const before = await stepCount(page);

  await library(page).getByRole('button', { name: 'Hover', exact: true }).click();
  await expect.poll(() => stepCount(page)).toBe(before + 1);

  // Switch away immediately, well inside the autosave debounce.
  await page.locator('.explorer__list button').nth(1).click();
  await expect.poll(() => stepCount(page)).not.toBe(before + 1);

  await page.locator('.explorer__list button').first().click();
  await expect.poll(() => stepCount(page)).toBe(before + 1);
});

test('renaming a flow renames its files', async ({ page }) => {
  const name = page.locator('.topbar__name');

  await name.fill('Renamed by test');
  await name.press('Enter');

  await expect(
    page.locator('.explorer__list button', { hasText: 'Renamed by test' }),
  ).toBeVisible();
  await expect(name).toHaveValue('Renamed by test');
});

test('importing a spec previews fidelity before adopting', async ({ page }) => {
  await page.locator('.explorer').getByRole('button', { name: 'Import spec' }).click();

  await page
    .locator('.modal__source')
    .fill(
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('Imported flow', async ({ page }) => {",
        "  await page.goto('https://example.com');",
        "  await page.getByRole('button', { name: 'Go' }).click();",
        "  await expect(page.getByTestId('done')).toBeVisible();",
        '  await page.evaluate(() => window.scrollTo(0, 100));',
        '});',
      ].join('\n'),
    );

  await page.getByRole('button', { name: 'Analyze' }).click();

  await expect(page.locator('.import-card__badge')).toHaveText('mixed');
  await expect(page.locator('.import-card__meta')).toContainText('3 mapped');
  await expect(page.locator('.import-card__meta')).toContainText('1 kept as code');
  await expect(page.locator('.import-card__diagnostics')).toContainText('page.evaluate');
});

test('a run shows what the page looked like after each step', async ({ page }) => {
  await page.locator('.explorer__list button', { hasText: 'Login path' }).click();
  await page.locator('.topbar').getByRole('button', { name: 'Run', exact: true }).click();

  await expect(page.locator('.run__head')).toContainText('Passed', { timeout: 90_000 });
  await expect(page.locator('.run__shot').first()).toBeVisible();

  const loaded = await page
    .locator('.run__shot img')
    .first()
    .evaluate((image: HTMLImageElement) => image.naturalWidth > 0);

  expect(loaded).toBe(true);

  await page.locator('.run__shot').first().click();
  await expect(page.locator('.run__lightbox img')).toBeVisible();

  await page.locator('.run__lightbox').click();
  await expect(page.locator('.run__lightbox')).toHaveCount(0);
});

test('running a flow reports per-step results from the real runner', async ({ page }) => {
  await page.locator('.explorer__list button', { hasText: 'Login path' }).click();
  await page.locator('.topbar').getByRole('button', { name: 'Run', exact: true }).click();

  const head = page.locator('.run__head');
  await expect(head).toContainText(/Passed|Failed/, { timeout: 90_000 });
  await expect(head).toContainText('Passed');

  const steps = page.locator('.run__step');
  await expect(steps).not.toHaveCount(0);
  await expect(page.locator('.run__dot--passed').first()).toBeVisible();
  await expect(page.locator('.run__artifacts')).toContainText('trace');
});
