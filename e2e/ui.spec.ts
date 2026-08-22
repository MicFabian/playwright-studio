import { expect, test, type Locator, type Page } from 'playwright/test';

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
        params: [],
        code: "const cardCount = await page.locator('[data-testid=\"results-count\"]').textContent();",
        filePath: 'playwright-lowcode/snippets/capture-card-count.snippet.json',
        updatedAt: '2026-03-20T08:00:00.000Z',
      },
      {
        id: 'switch-tenant',
        name: 'Switch tenant',
        description: 'Switch to selected tenant.',
        params: ['tenantName'],
        code: "await page.locator('[aria-haspopup=\"listbox\"]').click();\nawait page.locator(`[data-tenant=\"${tenantName}\"]`).click();",
        filePath: 'playwright-lowcode/snippets/switch-tenant.snippet.json',
        updatedAt: '2026-03-20T08:00:00.000Z',
      },
      {
        id: 'wait-for-dashboard',
        name: 'Wait for dashboard',
        description: 'Confirm dashboard visibility.',
        params: ['headline'],
        code: "await expect(page.locator('[data-testid=\"dashboard-title\"]')).toContainText(headline);",
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
  await mockWorkspace(page, workspace);
}

async function mockWorkspace(page: Page, workspace: ReturnType<typeof createWorkspace>) {
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

async function expectBoxInside(
  inner: Locator,
  outer: Locator,
  margin = 8,
  label = 'box',
) {
  const [innerBox, outerBox] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);

  if (!innerBox) {
    throw new Error(`Expected ${label} to have a bounding box`);
  }

  if (!outerBox) {
    throw new Error(`Expected outer box for ${label} to have a bounding box`);
  }

  expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x + margin);
  expect(innerBox.y).toBeGreaterThanOrEqual(outerBox.y + margin);
  expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(outerBox.x + outerBox.width - margin);
  expect(innerBox.y + innerBox.height).toBeLessThanOrEqual(
    outerBox.y + outerBox.height - margin,
  );
}

async function dragQuickInsertToTarget(
  page: Page,
  sourceTestId: string,
  target: Locator,
) {
  const source = page.getByTestId(sourceTestId);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  await source.dispatchEvent('dragstart', { dataTransfer });
  await target.waitFor({ state: 'attached' });
  const targetBox = await target.boundingBox();

  if (!targetBox) {
    await source.dispatchEvent('dragend', { dataTransfer });
    await dataTransfer.dispose();
    throw new Error('Drop target is not visible');
  }

  const clientX = targetBox.x + targetBox.width * 0.55;
  const clientY = targetBox.y + targetBox.height * 0.55;

  await target.dispatchEvent('dragenter', { dataTransfer, clientX, clientY });
  await target.dispatchEvent('dragover', { dataTransfer, clientX, clientY });
  await target.dispatchEvent('drop', { dataTransfer, clientX, clientY });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();
}

async function dragQuickInsertToCanvas(page: Page, sourceTestId: string) {
  await dragQuickInsertToTarget(page, sourceTestId, page.getByTestId('canvas-dropzone'));
}

test('filters snippets in side nav and quick insert toolbar', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Workspace sections' });
  await nav.getByRole('button', { name: /^Snippets/ }).click();
  await page.getByTestId('snippet-filter-input').fill('tenant');

  const snippetList = page.locator('.sidenav__list');
  await expect(snippetList.getByRole('button', { name: /Switch tenant/ }).first()).toBeVisible();
  await expect(snippetList.getByRole('button', { name: 'Insert' })).toHaveCount(0);
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

test('quick insert can drop into an insertion slot between existing cards', async ({
  page,
}) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await dragQuickInsertToTarget(
    page,
    'quick-block-click',
    page.getByTestId('insert-slot-edge-open-assert'),
  );

  await expect(page.getByText(/^3 blocks on canvas/)).toBeVisible();
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Click target' }),
  ).toHaveCount(1);
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

test('switching flows does not mark the active flow as unsaved', async ({ page }) => {
  const workspace = createWorkspace(true);
  workspace.tests.push({
    ...workspace.tests[0],
    id: 'login-path',
    name: 'Login path',
    filePath: 'playwright-lowcode/tests/login-path.flow.json',
    specPath: 'tests/generated/login-path.spec.ts',
    updatedAt: '2026-03-21T08:00:00.000Z',
  });

  await mockWorkspace(page, workspace);
  await page.goto('/');

  await expect(page.getByText('Unsaved edits')).toHaveCount(0);

  const secondFlow = page.locator('.nav-row').filter({ hasText: 'Login path' }).first();
  await secondFlow.click();
  await page.waitForTimeout(300);

  await expect(page.getByText('Unsaved edits')).toHaveCount(0);
  await expect(page.locator('.nav-row.is-active .nav-badge.is-dirty')).toHaveCount(0);
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
  await expect(page.getByText('Step 1 of 2')).toBeVisible();
  await expect(page.locator('.run-step.is-current')).toContainText('Open local page');

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
  await expect(stepCanvas).toBeVisible();
  await expect(stepCanvas.locator('.flow-node-card')).toHaveCount(2);
  await expect(stepCanvas.getByText('Click target').first()).toBeVisible();
  await expect(stepCanvas.getByText('Find by').first()).toBeVisible();
  await expect(stepCanvas.getByText('Selector', { exact: true }).first()).toBeVisible();
  await expect(stepCanvas.locator('select[data-testid*="locatorKind"]').first()).toHaveValue('css');
  await expect(stepCanvas.locator('input[data-testid*="locatorValue"]').first()).toHaveValue(
    '[aria-haspopup="listbox"]',
  );
  await expect(
    snippetNode.getByRole('button', { name: 'Add block after 1' }),
  ).toBeVisible();

  await snippetNode.getByRole('button', { name: 'Hide actions' }).click();
  await expect(stepCanvas).toHaveCount(0);
});

test('collapsed flow cards keep all selector fields visible when not selected', async ({
  page,
}) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await page.getByTestId('quick-block-extract').click();

  const extractNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Extract value' })
    .first();
  await expect(extractNode).toBeVisible();

  await page.locator('[data-testid="flow-node-node-open"]').click();

  await expect(extractNode.getByText('Find by').first()).toBeVisible();
  await expect(extractNode.getByText('Value').first()).toBeVisible();
  await expect(extractNode.getByText('Variable').first()).toBeVisible();
});

test('canvas chrome stays inset within the editor bounds on initial load', async ({
  page,
}) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  const canvasBody = page.getByTestId('canvas-dropzone');
  const minimap = page.locator('.react-flow__minimap');
  const controls = page.locator('.canvas-flow-controls');
  const lockButton = page.locator('.canvas-lock-button');

  await expect(canvasBody).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(controls).toBeVisible();
  await expect(lockButton).toBeVisible();

  await expectBoxInside(minimap, canvasBody, 8, 'minimap');
  await expectBoxInside(controls, canvasBody, 8, 'controls');
  await expectBoxInside(lockButton, canvasBody, 8, 'lock button');
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

  const firstStepInput = snippetNode.locator('input[data-testid*="snippet-step-field-"][data-testid$="-locatorValue"]').first();
  await firstStepInput.fill('[data-testid="tenant"]');
  await expect(firstStepInput).toHaveValue('tenant');
  await expect(
    snippetNode.locator('select[data-testid*="snippet-step-field-"][data-testid$="-locatorKind"]').first(),
  ).toHaveValue('data-testid');
});

test('selected flow cards expose inline value editors on canvas', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  const openNode = page.locator('[data-testid="flow-node-node-open"]');
  await openNode.click();

  const urlInput = page.getByTestId('canvas-inline-field-node-open-url');
  await expect(urlInput).toBeVisible();
  await urlInput.fill('https://app.example.com/pricing');
  await expect(urlInput).toHaveValue('https://app.example.com/pricing');
  await expect(page.getByText('Unsaved edits')).toBeVisible();
});

test('selector fields split into find-by and value editors', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await page.getByTestId('quick-block-fill').click();

  const fillNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Fill input' })
    .first();
  await expect(fillNode).toBeVisible();

  const selectorKind = fillNode.locator('select').first();
  const selectorValue = fillNode.locator('input').first();

  await expect(selectorKind).toHaveValue('name');
  await expect(selectorValue).toHaveValue('email');

  await selectorKind.selectOption('data-testid');
  await selectorValue.fill('email-field');

  await expect(selectorKind).toHaveValue('data-testid');
  await expect(selectorValue).toHaveValue('email-field');
});

test('free code cards can be inserted and edited inline on canvas', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await page.getByTestId('quick-block-freetext').click();

  const codeNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Free code' })
    .first();
  await expect(codeNode).toBeVisible();

  const codeInput = codeNode.getByTestId(/canvas-inline-field-.*-code/);
  await expect(codeInput).toBeVisible();
  await codeInput.fill("await page.locator('[data-testid=\"tenant\"]').click();");
  await expect(codeInput).toHaveValue("await page.locator('[data-testid=\"tenant\"]').click();");
});

test('collapsed snippet cards reuse standard field previews', async ({ page }) => {
  await mockWorkspaceOnly(page);
  await page.goto('/');

  await page.getByTestId('quick-snippet-chip-switch-tenant').click();
  await page.locator('[data-testid="flow-node-node-open"]').click();

  const snippetNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Switch tenant' })
    .first();
  await expect(snippetNode).toBeVisible();
  await expect(snippetNode.locator('.flow-node-card__field span', { hasText: 'Actions' })).toBeVisible();
  await expect(snippetNode.locator('.flow-node-card__field strong', { hasText: '2 blocks' })).toBeVisible();
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
  await snippetRow.getByRole('button', { name: 'Edit Switch tenant snippet' }).click();

  await expect(page.getByRole('heading', { name: 'Snippet canvas' })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  const snippetNode = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Click target' })
    .first();
  await expect(snippetNode).toBeVisible();
  await expect(snippetNode.getByRole('button', { name: 'Add block after 1' })).toBeVisible();

  const firstStepInput = snippetNode.locator('input[data-testid^="canvas-inline-field-"][data-testid$="-locatorValue"]').first();
  await firstStepInput.fill('[data-testid="tenant"]');
  await expect(firstStepInput).toHaveValue('[data-testid="tenant"]');

  await page.getByTestId('quick-block-fill').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Fill input' }).first(),
  ).toBeVisible();

  await page.getByTestId('quick-snippet-chip-capture-card-count').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Extract value' }).first(),
  ).toBeVisible();

  await dragQuickInsertToCanvas(page, 'quick-block-click');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Click target' }).nth(2),
  ).toBeVisible();

  await expect(page.getByText('Unsaved snippet')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Save snippet$/ })).toBeEnabled();
  await expect(page.getByLabel('Snippet name')).toBeVisible();
});
