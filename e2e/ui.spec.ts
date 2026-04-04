import { expect, test, type Page } from 'playwright/test';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z8n8AAAAASUVORK5CYII=',
  'base64',
);

function createWorkspace(
  withTests = true,
  options?: {
    emptyFlow?: boolean;
  },
) {
  const emptyFlow = Boolean(options?.emptyFlow);
  const nodes = emptyFlow
    ? []
    : [
        {
          id: 'node-open',
          type: 'flow',
          position: { x: 40, y: 120 },
          data: {
            kind: 'navigate',
            category: 'entry',
            title: 'Open local page',
            description: 'Start from a deterministic blank page.',
            accent: '#19c2b0',
            codeLabel: 'page.goto()',
            status: 'ready',
            fields: [{ key: 'url', label: 'URL', value: 'about:blank' }],
          },
        },
        {
          id: 'node-assert',
          type: 'flow',
          position: { x: 360, y: 120 },
          data: {
            kind: 'assert',
            category: 'assertion',
            title: 'Assert title',
            description: 'Validate page title.',
            accent: '#ff825b',
            codeLabel: 'expect()',
            status: 'ready',
            fields: [
              { key: 'target', label: 'Target', value: 'title' },
              { key: 'expectation', label: 'Expectation', value: 'Example' },
            ],
          },
        },
      ];
  const edges = emptyFlow
    ? []
    : [
        {
          id: 'edge-open-assert',
          source: 'node-open',
          target: 'node-assert',
          type: 'smoothstep',
          animated: true,
        },
      ];

  return {
    project: {
      formatVersion: 1,
      name: 'Playwright Low-Code Studio',
      paths: {
        testsDir: 'playwright-lowcode/tests',
        snippetsDir: 'playwright-lowcode/snippets',
        generatedTestsDir: 'tests/generated',
      },
    },
    tests: withTests
      ? [
          {
            id: 'checkout-totals',
            name: 'Checkout totals',
            status: 'stable',
            steps: nodes.length,
            updatedAt: '2026-03-20T08:00:00.000Z',
            filePath: 'playwright-lowcode/tests/checkout-totals.flow.json',
            specPath: 'tests/generated/checkout-totals.spec.ts',
            nodes,
            edges,
          },
        ]
      : [],
    snippets: [
      {
        id: 'capture-card-count',
        name: 'Capture card count',
        description: 'Capture current card count.',
        params: ['varName'],
        code: "const result = await page.locator('[data-testid=\"count\"]').textContent();",
        filePath: 'playwright-lowcode/snippets/capture-card-count.snippet.json',
        updatedAt: '2026-03-20T08:00:00.000Z',
      },
      {
        id: 'switch-tenant',
        name: 'Switch tenant',
        description: 'Switch to selected tenant.',
        params: ['tenantName'],
        code: "await page.getByRole('option', { name: tenantName }).click();",
        filePath: 'playwright-lowcode/snippets/switch-tenant.snippet.json',
        updatedAt: '2026-03-20T08:00:00.000Z',
      },
      {
        id: 'wait-for-dashboard',
        name: 'Wait for dashboard',
        description: 'Confirm dashboard visibility.',
        params: ['headline'],
        code: "await page.waitForLoadState('domcontentloaded');",
        filePath: 'playwright-lowcode/snippets/wait-for-dashboard.snippet.json',
        updatedAt: '2026-03-20T08:00:00.000Z',
      },
    ],
    git: {
      available: false,
      branch: null,
      dirty: false,
      changedFiles: [],
      stagedFiles: [],
      unstagedFiles: [],
      untrackedFiles: [],
      lastCommit: null,
      root: null,
    },
  };
}

function createRunState(
  status: 'queued' | 'running' | 'passed',
  withScreenshots = false,
  liveMode = true,
) {
  const screenshotBase = '/api/runs/run-ui-1/screenshots';

  return {
    id: 'run-ui-1',
    testId: 'checkout-totals',
    testName: 'Checkout totals',
    status,
    liveMode,
    slowMoMs: liveMode ? 180 : 0,
    startedAt: '2026-03-20T08:15:00.000Z',
    finishedAt: status === 'passed' ? '2026-03-20T08:15:04.000Z' : null,
    currentStepIndex: status === 'running' ? 0 : null,
    totalSteps: 2,
    error: null,
    stepResults: [
      {
        index: 0,
        nodeId: 'node-open',
        title: 'Open local page',
        kind: 'navigate',
        status: status === 'queued' ? 'queued' : 'passed',
        startedAt: '2026-03-20T08:15:00.000Z',
        finishedAt: status === 'queued' ? null : '2026-03-20T08:15:02.000Z',
        error: null,
        screenshotUrl: withScreenshots ? `${screenshotBase}/01-open-local-page.png` : null,
      },
      {
        index: 1,
        nodeId: 'node-assert',
        title: 'Assert title',
        kind: 'assert',
        status: status === 'passed' ? 'passed' : status === 'running' ? 'running' : 'queued',
        startedAt: status === 'passed' ? '2026-03-20T08:15:02.000Z' : null,
        finishedAt: status === 'passed' ? '2026-03-20T08:15:04.000Z' : null,
        error: null,
        screenshotUrl: withScreenshots ? `${screenshotBase}/02-assert-title.png` : null,
      },
    ],
  };
}

async function mockWorkspaceOnly(
  page: Page,
  withTests = true,
  options?: {
    emptyFlow?: boolean;
  },
) {
  const workspace = createWorkspace(withTests, options);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/workspace') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(workspace),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not found in test mock' }),
    });
  });
}

async function dragQuickInsertToCanvas(page: Page, sourceTestId: string) {
  const source = page.getByTestId(sourceTestId);
  const target = page.getByTestId('canvas-dropzone');
  const targetBox = await target.boundingBox();

  if (!targetBox) {
    throw new Error('Canvas dropzone is not visible');
  }

  const clientX = targetBox.x + targetBox.width * 0.55;
  const clientY = targetBox.y + targetBox.height * 0.55;
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  await source.dispatchEvent('dragstart', { dataTransfer });
  await target.dispatchEvent('dragenter', { dataTransfer, clientX, clientY });
  await target.dispatchEvent('dragover', { dataTransfer, clientX, clientY });
  await target.dispatchEvent('drop', { dataTransfer, clientX, clientY });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();
}

test('filters snippets in side nav and quick insert toolbar', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Workspace sections' });
  await nav.getByRole('button', { name: /^Snippets/ }).click();
  await page.getByTestId('snippet-filter-input').fill('tenant');

  const snippetList = page.locator('.sidenav__list');
  await expect(snippetList.getByRole('button', { name: /Switch tenant/ }).first()).toBeVisible();
  await expect(snippetList.getByRole('button', { name: /Capture card count/ })).toHaveCount(0);
  await expect(page.locator('.canvas-toolbar__snippet-list .snippet-chip')).toHaveCount(1);

  await page.getByTestId('snippet-filter-input').fill('no-match');
  await expect(page.getByText('No snippets match this filter.').first()).toBeVisible();
});

test('quick insert supports dragging blocks and snippets to canvas', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await dragQuickInsertToCanvas(page, 'quick-block-click');
  await expect(page.getByText(/^3 blocks on canvas/)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  await dragQuickInsertToCanvas(page, 'quick-snippet-chip-switch-tenant');
  await expect(page.getByText(/^4 blocks on canvas/)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
});

test('canvas lock blocks quick insert edits until unlocked', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  const lockButton = page.locator('.canvas-lock-button');
  await lockButton.click();
  await expect(page.locator('.canvas-lock-button')).toHaveText('Unlock');

  await page.getByTestId('quick-block-click').click();
  await expect(page.getByText(/^2 blocks on canvas/)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  await page.locator('.canvas-lock-button').click();
  await expect(page.locator('.canvas-lock-button')).toHaveText('Lock');
  await page.getByTestId('quick-block-click').click();
  await expect(page.getByText(/^3 blocks on canvas/)).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
});

test('run panel disables duplicate starts and renders step progress artifacts', async ({
  page,
}) => {
  const workspace = createWorkspace(true);
  let postRunCount = 0;
  let pollCount = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/workspace') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(workspace),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/runs') {
      postRunCount += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          run: createRunState('queued'),
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/api/runs/run-ui-1') {
      pollCount += 1;
      const run = pollCount < 5 ? createRunState('running') : createRunState('passed', true);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ run }),
      });
      return;
    }

    if (
      request.method() === 'GET' &&
      url.pathname.startsWith('/api/runs/run-ui-1/screenshots/')
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: onePixelPng,
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not found in test mock' }),
    });
  });

  await page.goto('/');

  const runButton = page.getByTestId('run-test-button');
  await runButton.click();

  await expect(runButton).toBeDisabled();
  await expect(runButton).toHaveText(/Starting run…|Running…/);
  await expect(page.locator('.run-status')).toHaveText('running');

  await expect(page.locator('.run-status')).toHaveText('passed');
  await expect(page.getByText('2 / 2 complete')).toBeVisible();
  const stepScreenshot = page.getByAltText('Step 1 screenshot');
  await expect(stepScreenshot).toBeVisible();

  await stepScreenshot.click();
  await expect(page.getByTestId('run-screenshot-popover')).toBeVisible();
  await expect(page.getByTestId('run-screenshot-popover-image')).toBeVisible();

  await page.getByRole('button', { name: 'Close screenshot preview' }).click();
  await expect(page.getByTestId('run-screenshot-popover')).toHaveCount(0);

  await expect(runButton).toHaveText('Run live');
  await expect(runButton).toBeEnabled();
  expect(postRunCount).toBe(1);
});

test('run mode toggle switches button label and start payload', async ({ page }) => {
  const workspace = createWorkspace(true);
  let capturedStartBody: Record<string, unknown> | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/workspace') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(workspace),
      });
      return;
    }

    if (request.method() === 'POST' && url.pathname === '/api/runs') {
      capturedStartBody = JSON.parse(request.postData() || '{}') as Record<
        string,
        unknown
      >;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          run: createRunState('queued', false, false),
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/api/runs/run-ui-1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ run: createRunState('passed', false, false) }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not found in test mock' }),
    });
  });

  await page.goto('/');

  const liveModeToggle = page.getByLabel('Live browser actions');
  const runButton = page.getByTestId('run-test-button');

  await expect(runButton).toHaveText('Run live');
  await liveModeToggle.uncheck();
  await expect(runButton).toHaveText('Run headless');
  await runButton.click();

  await expect(page.locator('.run-status')).toHaveText('passed');
  expect(capturedStartBody?.liveMode).toBe(false);
  expect(capturedStartBody?.slowMoMs).toBe(0);
});

test('empty workspace keeps clear onboarding states', async ({ page }) => {
  await mockWorkspaceOnly(page, false);
  await page.goto('/');

  await expect(page.getByText('No persisted flows yet.')).toBeVisible();
  await expect(page.getByText('Create a flow file from the left rail to start editing.')).toBeVisible();
  await expect(page.getByTestId('run-test-button')).toBeDisabled();
});

test('active flow with zero blocks requires adding a step before run', async ({ page }) => {
  await mockWorkspaceOnly(page, true, { emptyFlow: true });
  await page.goto('/');

  const runButton = page.getByTestId('run-test-button');
  await expect(runButton).toBeDisabled();
  await expect(runButton).toHaveText('Add a step first');
});

test('snippet nodes can expand to show all snippet actions on canvas', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await page.getByTestId('quick-snippet-chip-switch-tenant').click();

  const snippetNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Switch tenant' })
    .first();
  await expect(snippetNode).toBeVisible();

  await snippetNode.getByRole('button', { name: 'Show actions' }).click();
  await expect(snippetNode.getByRole('button', { name: 'Hide actions' })).toBeVisible();
  const stepCanvas = snippetNode.locator('[data-testid^="snippet-step-canvas-"]');
  const firstStepInput = snippetNode.locator('textarea[data-testid^="snippet-step-input-"]').first();
  await expect(stepCanvas).toBeVisible();
  await expect(firstStepInput).toHaveValue(
    "await page.getByRole('option', { name: tenantName }).click();",
  );
  await expect(
    snippetNode.getByRole('button', { name: 'Add snippet step after 1' }),
  ).toBeVisible();

  await snippetNode.getByRole('button', { name: 'Hide actions' }).click();
  await expect(stepCanvas).toHaveCount(0);
});

test('snippet nodes can be edited directly on canvas', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await page.getByTestId('quick-snippet-chip-switch-tenant').click();

  const snippetNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Switch tenant' })
    .first();
  await expect(snippetNode).toBeVisible();

  await snippetNode
    .getByRole('button', { name: 'Show actions' })
    .dispatchEvent('click');

  const inlineTitleInput = snippetNode.locator('input[data-testid^="snippet-inline-title-"]');
  await snippetNode
    .getByRole('button', { name: 'Edit in canvas' })
    .dispatchEvent('click');
  await inlineTitleInput.fill('Switch tenant inline');
  await expect(snippetNode.getByText('Switch tenant inline')).toBeVisible();

  const firstStepInput = snippetNode.locator('textarea[data-testid^="snippet-step-input-"]').first();
  await firstStepInput.fill("await page.locator('[data-testid=\"tenant\"]').click();");
  await expect(firstStepInput).toHaveValue(
    "await page.locator('[data-testid=\"tenant\"]').click();",
  );
});

test('selecting a snippet opens it on canvas as editable snippet flow', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Workspace sections' });
  await nav.getByRole('button', { name: /^Snippets/ }).click();

  const snippetRow = page
    .locator('.nav-row--stacked')
    .filter({ hasText: 'Switch tenant' })
    .first();
  await snippetRow.getByRole('button', { name: 'Edit' }).click();

  await expect(page.getByRole('heading', { name: 'Snippet canvas' })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  const snippetNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Step 1' })
    .first();
  await expect(snippetNode).toBeVisible();
  await expect(snippetNode.getByRole('button', { name: 'Add snippet step after 1' })).toBeVisible();

  const firstStepInput = snippetNode.locator('textarea[data-testid^="snippet-step-card-input-"]').first();
  await firstStepInput.fill("await page.locator('[data-testid=\"tenant\"]').click();");
  await expect(firstStepInput).toHaveValue(
    "await page.locator('[data-testid=\"tenant\"]').click();",
  );

  await page.getByTestId('quick-block-fill').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(
    page.locator('textarea[data-testid^="snippet-step-card-input-"]').nth(1),
  ).toHaveValue("await page.locator('[name=\"email\"]').fill('qa@example.com');");

  await page.getByTestId('quick-snippet-chip-capture-card-count').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(
    page.locator('textarea[data-testid^="snippet-step-card-input-"]').nth(2),
  ).toHaveValue(
    "const result = await page.locator('[data-testid=\"count\"]').textContent();",
  );

  await dragQuickInsertToCanvas(page, 'quick-block-click');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  const snippetStepValues = await page
    .locator('textarea[data-testid^="snippet-step-card-input-"]')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLTextAreaElement).value),
    );
  expect(
    snippetStepValues.includes("await page.locator('[data-testid=\"submit\"]').click();"),
  ).toBeTruthy();

  await expect(page.getByText('Unsaved snippet')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Save snippet$/ })).toBeEnabled();
  await expect(page.getByLabel('Snippet name')).toBeVisible();
});
