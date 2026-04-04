import http from 'node:http';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer as createViteServer } from 'vite';

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const isProd = process.argv.includes('--prod');
const port = Number(process.env.PORT || (isProd ? 4173 : 5173));
const host = process.env.HOST || '127.0.0.1';

const defaultProject = {
  formatVersion: 1,
  name: 'Playwright Low-Code Studio',
  paths: {
    testsDir: 'playwright-lowcode/tests',
    snippetsDir: 'playwright-lowcode/snippets',
    generatedTestsDir: 'tests/generated',
  },
};

const statusValues = new Set(['stable', 'draft', 'failing']);
const blockKinds = new Set([
  'navigate',
  'click',
  'fill',
  'assert',
  'extract',
  'condition',
  'loop',
  'snippet',
]);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const runsRootRelative = path.join('playwright-lowcode', 'runs').replaceAll('\\', '/');
const runsById = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeRunId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

function q(value) {
  return JSON.stringify(value);
}

function safeIdentifier(candidate) {
  const cleaned = String(candidate || '').replace(/[^a-zA-Z0-9_$]/g, '');

  if (!cleaned) {
    return 'value';
  }

  if (/^[0-9]/.test(cleaned)) {
    return `v${cleaned}`;
  }

  return cleaned;
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'untitled-flow';
}

function normalizePosition(position) {
  return {
    x: Number(position?.x ?? 0),
    y: Number(position?.y ?? 0),
  };
}

function sanitizeField(field, index) {
  const fallbackKey = `field_${index + 1}`;

  return {
    key: String(field?.key || fallbackKey),
    label: String(field?.label || field?.key || fallbackKey),
    value: String(field?.value ?? ''),
    ...(field?.placeholder ? { placeholder: String(field.placeholder) } : {}),
    ...(field?.multiline ? { multiline: true } : {}),
  };
}

function sanitizeNodeData(data) {
  const kind = blockKinds.has(data?.kind) ? data.kind : 'snippet';
  const status = data?.status === 'ready' ? 'ready' : 'draft';

  return {
    kind,
    category: String(data?.category || 'snippet'),
    title: String(data?.title || 'Untitled block'),
    description: String(data?.description || ''),
    accent: String(data?.accent || '#19c2b0'),
    codeLabel: String(data?.codeLabel || 'custom block'),
    status,
    fields: Array.isArray(data?.fields)
      ? data.fields.map((field, index) => sanitizeField(field, index))
      : [],
    ...(typeof data?.snippetCode === 'string'
      ? { snippetCode: data.snippetCode }
      : {}),
    ...(typeof data?.snippetRef === 'string'
      ? { snippetRef: data.snippetRef }
      : {}),
  };
}

function sanitizeNode(node) {
  return {
    id: String(node?.id || randomUUID()),
    type: 'flow',
    position: normalizePosition(node?.position),
    data: sanitizeNodeData(node?.data),
  };
}

function sanitizeEdge(edge) {
  return {
    id: String(edge?.id || randomUUID()),
    source: String(edge?.source || ''),
    target: String(edge?.target || ''),
    type: 'smoothstep',
    animated: Boolean(edge?.animated ?? true),
  };
}

function sortNodesByPosition(left, right) {
  if (left.position.x === right.position.x) {
    return left.position.y - right.position.y;
  }

  return left.position.x - right.position.x;
}

function orderNodes(nodes, edges) {
  const incoming = new Map();
  const outgoing = new Map();
  const byId = new Map(nodes.map((node) => [node.id, node]));

  nodes.forEach((node) => incoming.set(node.id, 0));

  edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    const connected = outgoing.get(edge.source) ?? [];
    connected.push(edge);
    outgoing.set(edge.source, connected);
  });

  outgoing.forEach((connected) => {
    connected.sort((left, right) => {
      const leftNode = byId.get(left.target);
      const rightNode = byId.get(right.target);

      if (!leftNode || !rightNode) {
        return 0;
      }

      return sortNodesByPosition(leftNode, rightNode);
    });
  });

  const roots = [...nodes]
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort(sortNodesByPosition);

  const ordered = [];
  const visited = new Set();

  const visit = (nodeId) => {
    if (visited.has(nodeId)) {
      return;
    }

    const node = byId.get(nodeId);

    if (!node) {
      return;
    }

    visited.add(nodeId);
    ordered.push(node);
    (outgoing.get(nodeId) ?? []).forEach((edge) => visit(edge.target));
  };

  roots.forEach((node) => visit(node.id));
  [...nodes].sort(sortNodesByPosition).forEach((node) => visit(node.id));

  return ordered;
}

function renderNode(node) {
  const fields = Object.fromEntries(
    (node.data.fields || []).map((field) => [field.key, field.value]),
  );

  switch (node.data.kind) {
    case 'navigate':
      return [`await page.goto(${q(fields.url || 'https://example.com')});`];
    case 'click':
      return [
        `await page.locator(${q(fields.locator || '[data-testid="submit"]')}).click();`,
      ];
    case 'fill':
      return [
        `await page.locator(${q(fields.locator || '[name="field"]')}).fill(${q(
          fields.value || '',
        )});`,
      ];
    case 'assert':
      return [
        `await expect(page.locator(${q(
          fields.target || '[data-testid="target"]',
        )})).toContainText(${q(fields.expectation || 'Expected text')});`,
      ];
    case 'extract':
      return [
        `const ${safeIdentifier(
          fields.variable || 'value',
        )} = await page.locator(${q(
          fields.locator || '[data-testid="value"]',
        )}).textContent();`,
      ];
    case 'condition':
      return [
        `if (await page.locator(${q(fields.guard || '[data-testid="guard"]')}).isVisible()) {`,
        '  // Attach branch blocks to this condition in the flow editor.',
        '}',
      ];
    case 'loop':
      return [
        `for (const ${safeIdentifier(fields.alias || 'item')} of ${
          fields.collection || 'items'
        }) {`,
        '  // Attach repeatable blocks or snippets inside this loop.',
        '}',
      ];
    case 'snippet': {
      const parameterLines = (node.data.fields || []).map((field) => {
        return `const ${safeIdentifier(field.key)} = ${q(field.value || field.key)};`;
      });
      const snippetLines = String(node.data.snippetCode || '// add snippet code')
        .split('\n')
        .map((line) => line.trimEnd());

      return [`// Snippet: ${node.data.title}`, ...parameterLines, ...snippetLines];
    }
    default:
      return ['// Unsupported block'];
  }
}

function generatePlaywrightSpec(title, nodes, edges) {
  const flowLines = orderNodes(nodes, edges).flatMap((node) =>
    renderNode(node).map((line) => `  ${line}`),
  );

  return [
    "import { expect, test } from '@playwright/test';",
    '',
    `test(${q(title)}, async ({ page }) => {`,
    ...flowLines,
    '});',
    '',
  ].join('\n');
}

function mapNodeFields(node) {
  return Object.fromEntries(
    (node.data.fields || []).map((field) => [field.key, field.value]),
  );
}

function resolveTemplate(value, variables) {
  return String(value ?? '').replace(/\{\{\s*([a-zA-Z0-9_$]+)\s*\}\}/g, (_, key) => {
    const resolved = variables[key];
    return resolved == null ? '' : String(resolved);
  });
}

async function executeNodeStep(node, page, variables) {
  const fields = mapNodeFields(node);

  switch (node.data.kind) {
    case 'navigate': {
      const url = resolveTemplate(fields.url || 'https://example.com', variables);
      await page.goto(url);
      return;
    }
    case 'click': {
      const locator = resolveTemplate(
        fields.locator || '[data-testid="submit"]',
        variables,
      );
      await page.locator(locator).click();
      return;
    }
    case 'fill': {
      const locator = resolveTemplate(fields.locator || '[name="field"]', variables);
      const value = resolveTemplate(fields.value || '', variables);
      await page.locator(locator).fill(value);
      return;
    }
    case 'assert': {
      const locator = resolveTemplate(
        fields.target || '[data-testid="target"]',
        variables,
      );
      const expectedText = resolveTemplate(
        fields.expectation || 'Expected text',
        variables,
      );
      const actualText = String((await page.locator(locator).textContent()) || '');

      if (!actualText.includes(expectedText)) {
        throw new Error(
          `Assertion failed for ${locator}. Expected to include "${expectedText}", got "${actualText}".`,
        );
      }

      return;
    }
    case 'extract': {
      const locator = resolveTemplate(
        fields.locator || '[data-testid="value"]',
        variables,
      );
      const variable = safeIdentifier(fields.variable || 'value');
      variables[variable] = (await page.locator(locator).textContent()) || '';
      return;
    }
    case 'condition': {
      const guard = resolveTemplate(
        fields.guard || '[data-testid="guard"]',
        variables,
      );
      variables.lastCondition = await page.locator(guard).isVisible();
      return;
    }
    case 'loop': {
      const alias = safeIdentifier(fields.alias || 'item');
      const collectionKey = String(fields.collection || 'items');
      const collection = variables[collectionKey];

      if (Array.isArray(collection) && collection.length > 0) {
        variables[alias] = collection[0];
      }

      return;
    }
    case 'snippet': {
      const snippetCode = String(node.data.snippetCode || '').trim();

      if (!snippetCode) {
        return;
      }

      const snippetParams = Object.fromEntries(
        (node.data.fields || []).map((field) => [
          field.key,
          resolveTemplate(field.value || field.key, variables),
        ]),
      );
      const snippetParamPrelude = Object.keys(snippetParams)
        .map((key) => {
          const alias = safeIdentifier(key);
          return `const ${alias} = params[${q(key)}];`;
        })
        .join('\n');
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const runSnippet = new AsyncFunction(
        'page',
        'vars',
        'params',
        snippetParamPrelude ? `${snippetParamPrelude}\n${snippetCode}` : snippetCode,
      );

      await runSnippet(page, variables, snippetParams);
      return;
    }
    default:
      return;
  }
}

function serializeRun(run) {
  return {
    id: run.id,
    testId: run.testId,
    testName: run.testName,
    status: run.status,
    liveMode: run.liveMode,
    slowMoMs: run.slowMoMs,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    currentStepIndex: run.currentStepIndex,
    totalSteps: run.totalSteps,
    error: run.error,
    stepResults: run.stepResults.map((step) => ({
      index: step.index,
      nodeId: step.nodeId,
      title: step.title,
      kind: step.kind,
      status: step.status,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      error: step.error,
      screenshotUrl: step.screenshotName
        ? `/api/runs/${run.id}/screenshots/${encodeURIComponent(step.screenshotName)}`
        : null,
    })),
  };
}

async function executeRun(run) {
  let browser = null;
  let context = null;
  let page = null;

  run.status = 'running';
  run.startedAt = nowIso();
  run.error = null;

  await fs.mkdir(run.artifactsDirAbsolute, { recursive: true });

  try {
    let chromium;

    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new Error(
        'Playwright runtime is not installed. Run `npm install playwright` and `npx playwright install chromium`.',
      );
    }

    browser = await chromium.launch({
      headless: !run.liveMode,
      slowMo: run.slowMoMs,
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();

    const variables = {};

    for (const [index, node] of run.orderedNodes.entries()) {
      const step = run.stepResults[index];
      run.currentStepIndex = index;
      step.status = 'running';
      step.startedAt = nowIso();

      try {
        await executeNodeStep(node, page, variables);
        step.status = 'passed';
      } catch (error) {
        step.status = 'failed';
        step.error = getRunErrorMessage(error);
        run.status = 'failed';
        run.error = step.error;
      } finally {
        step.finishedAt = nowIso();

        if (page) {
          const screenshotName = `${String(index + 1).padStart(2, '0')}-${slugify(
            node.data.title,
          )}.png`;

          try {
            await page.screenshot({
              path: path.join(run.artifactsDirAbsolute, screenshotName),
              fullPage: true,
            });
            step.screenshotName = screenshotName;
          } catch {
            step.screenshotName = null;
          }
        }
      }

      if (run.status === 'failed') {
        break;
      }
    }

    if (run.status !== 'failed') {
      run.status = 'passed';
    }
  } catch (error) {
    run.status = 'failed';
    run.error = getRunErrorMessage(error);
  } finally {
    run.currentStepIndex = null;
    run.finishedAt = nowIso();

    try {
      await context?.close();
    } catch {
      // noop
    }

    try {
      await browser?.close();
    } catch {
      // noop
    }
  }
}

async function startTestRun(project, payload) {
  const requestedId = slugify(payload?.testId || '');
  const liveMode = payload?.liveMode !== false;
  const slowMoMs = Number.isFinite(Number(payload?.slowMoMs))
    ? Math.max(0, Number(payload.slowMoMs))
    : liveMode
      ? 180
      : 0;
  let runNodes = [];
  let runEdges = [];
  let runTestId = requestedId;
  let runTestName = String(payload?.testName || 'Untitled flow');

  if (Array.isArray(payload?.nodes) && Array.isArray(payload?.edges) && requestedId) {
    runNodes = payload.nodes.map(sanitizeNode);
    runEdges = payload.edges
      .map(sanitizeEdge)
      .filter((edge) => edge.source && edge.target);
  } else {
    const tests = await loadTests(project);
    const selectedTest = tests.find((test) => test.id === requestedId);

    if (!selectedTest) {
      throw new Error(`Flow "${requestedId}" does not exist.`);
    }

    runNodes = selectedTest.nodes;
    runEdges = selectedTest.edges;
    runTestId = selectedTest.id;
    runTestName = selectedTest.name;
  }

  const orderedNodes = orderNodes(runNodes, runEdges);
  const runId = normalizeRunId(randomUUID());
  const run = {
    id: runId,
    testId: runTestId,
    testName: runTestName,
    status: 'queued',
    liveMode,
    slowMoMs,
    startedAt: null,
    finishedAt: null,
    currentStepIndex: null,
    totalSteps: orderedNodes.length,
    error: null,
    orderedNodes,
    artifactsDirRelative: path.join(runsRootRelative, runId).replaceAll('\\', '/'),
    artifactsDirAbsolute: path.join(rootDir, runsRootRelative, runId),
    stepResults: orderedNodes.map((node, index) => ({
      index,
      nodeId: node.id,
      title: node.data.title,
      kind: node.data.kind,
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      error: null,
      screenshotName: null,
    })),
  };

  runsById.set(runId, run);
  void executeRun(run);

  return serializeRun(run);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function ensureWorkspaceLayout(project) {
  await fs.mkdir(path.join(rootDir, project.paths.testsDir), { recursive: true });
  await fs.mkdir(path.join(rootDir, project.paths.snippetsDir), { recursive: true });
  await fs.mkdir(path.join(rootDir, project.paths.generatedTestsDir), {
    recursive: true,
  });
  await fs.mkdir(path.join(rootDir, runsRootRelative), { recursive: true });
}

async function readProject() {
  const projectPath = path.join(rootDir, 'playwright-lowcode', 'project.json');

  try {
    const parsed = await readJson(projectPath);

    return {
      formatVersion: Number(parsed.formatVersion || 1),
      name: String(parsed.name || defaultProject.name),
      paths: {
        testsDir: String(parsed.paths?.testsDir || defaultProject.paths.testsDir),
        snippetsDir: String(parsed.paths?.snippetsDir || defaultProject.paths.snippetsDir),
        generatedTestsDir: String(
          parsed.paths?.generatedTestsDir || defaultProject.paths.generatedTestsDir,
        ),
      },
    };
  } catch {
    return defaultProject;
  }
}

function materializeTest(project, relativePath, raw) {
  const id = slugify(raw.id || raw.name || path.basename(relativePath, '.flow.json'));
  const specPath = path.join(project.paths.generatedTestsDir, `${id}.spec.ts`).replaceAll('\\', '/');

  return {
    id,
    name: String(raw.name || 'Untitled flow'),
    status: statusValues.has(raw.status) ? raw.status : 'draft',
    steps: Array.isArray(raw.nodes) ? raw.nodes.length : 0,
    updatedAt: String(raw.updatedAt || ''),
    filePath: relativePath.replaceAll('\\', '/'),
    specPath,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map(sanitizeNode) : [],
    edges: Array.isArray(raw.edges)
      ? raw.edges.map(sanitizeEdge).filter((edge) => edge.source && edge.target)
      : [],
  };
}

async function loadTests(project) {
  const testsDir = path.join(rootDir, project.paths.testsDir);
  const files = await fs.readdir(testsDir);
  const tests = await Promise.all(
    files
      .filter((file) => file.endsWith('.flow.json'))
      .map(async (file) => {
        const relativePath = path.join(project.paths.testsDir, file);
        const raw = await readJson(path.join(rootDir, relativePath));
        return materializeTest(project, relativePath, raw);
      }),
  );

  return tests.sort((left, right) => left.name.localeCompare(right.name));
}

async function loadSnippets(project) {
  const snippetsDir = path.join(rootDir, project.paths.snippetsDir);
  const files = await fs.readdir(snippetsDir);
  const snippets = await Promise.all(
    files
      .filter((file) => file.endsWith('.snippet.json'))
      .map(async (file) => {
        const relativePath = path.join(project.paths.snippetsDir, file);
        const raw = await readJson(path.join(rootDir, relativePath));

        return materializeSnippet(relativePath, raw);
      }),
  );

  return snippets.sort((left, right) => left.name.localeCompare(right.name));
}

function materializeSnippet(relativePath, raw) {
  return {
    id: slugify(raw.id || raw.name || path.basename(relativePath, '.snippet.json')),
    name: String(raw.name || 'Untitled snippet'),
    description: String(raw.description || ''),
    params: Array.isArray(raw.params) ? raw.params.map(String) : [],
    code: String(raw.code || ''),
    updatedAt: String(raw.updatedAt || ''),
    filePath: relativePath.replaceAll('\\', '/'),
  };
}

async function runGit(args) {
  return execFileAsync('git', args, { cwd: rootDir });
}

async function getGitStatus() {
  try {
    const [{ stdout: root }, { stdout: statusOutput }] =
      await Promise.all([
        runGit(['rev-parse', '--show-toplevel']),
        runGit(['status', '--porcelain=v1', '--branch', '--untracked-files=all']),
      ]);
    const lines = statusOutput.trim().split('\n').filter(Boolean);
    const branchLine = lines.find((line) => line.startsWith('## '));
    const branch = branchLine
      ? branchLine
          .slice(3)
          .replace(/^No commits yet on /, '')
          .split('...')[0]
      : null;
    const stagedFiles = [];
    const unstagedFiles = [];
    const untrackedFiles = [];
    const changedFiles = [];

    lines
      .filter((line) => !line.startsWith('## '))
      .forEach((line) => {
        const stagedFlag = line[0];
        const unstagedFlag = line[1];
        const file = line.slice(3).trim();

        if (!file) {
          return;
        }

        changedFiles.push(file);

        if (stagedFlag === '?' && unstagedFlag === '?') {
          untrackedFiles.push(file);
          return;
        }

        if (stagedFlag !== ' ') {
          stagedFiles.push(file);
        }

        if (unstagedFlag !== ' ') {
          unstagedFiles.push(file);
        }
      });

    let lastCommit = null;

    try {
      const { stdout } = await runGit(['log', '-1', '--pretty=%h %s']);
      lastCommit = stdout.trim() || null;
    } catch {
      lastCommit = null;
    }

    return {
      available: true,
      branch: branch || null,
      dirty: changedFiles.length > 0,
      changedFiles,
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
      lastCommit,
      root: root.trim() || null,
    };
  } catch {
    return {
      available: false,
      branch: null,
      dirty: false,
      changedFiles: [],
      stagedFiles: [],
      unstagedFiles: [],
      untrackedFiles: [],
      lastCommit: null,
      root: null,
    };
  }
}

async function getWorkspace() {
  const project = await readProject();
  await ensureWorkspaceLayout(project);

  return {
    project,
    tests: await loadTests(project),
    snippets: await loadSnippets(project),
    git: await getGitStatus(),
  };
}

async function persistTest(project, payload, fallbackId) {
  const id = slugify(payload.id || payload.name || fallbackId || 'untitled-flow');
  const filePath = path.join(project.paths.testsDir, `${id}.flow.json`).replaceAll('\\', '/');
  const specPath = path.join(project.paths.generatedTestsDir, `${id}.spec.ts`).replaceAll('\\', '/');
  const test = materializeTest(project, filePath, {
    id,
    name: payload.name,
    status: payload.status,
    updatedAt: new Date().toISOString(),
    nodes: payload.nodes,
    edges: payload.edges,
  });

  await fs.writeFile(
    path.join(rootDir, filePath),
    `${JSON.stringify(
      {
        id: test.id,
        name: test.name,
        status: test.status,
        updatedAt: test.updatedAt,
        nodes: test.nodes,
        edges: test.edges,
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(rootDir, specPath),
    generatePlaywrightSpec(test.name, test.nodes, test.edges),
  );

  return {
    ...test,
    specPath,
  };
}

async function persistSnippet(project, payload, fallbackId) {
  const id = slugify(payload.id || payload.name || fallbackId || 'untitled-snippet');
  const filePath = path.join(project.paths.snippetsDir, `${id}.snippet.json`).replaceAll(
    '\\',
    '/',
  );
  const snippet = materializeSnippet(filePath, {
    id,
    name: payload.name,
    description: payload.description,
    params: payload.params,
    code: payload.code,
    updatedAt: new Date().toISOString(),
  });

  await fs.writeFile(
    path.join(rootDir, filePath),
    `${JSON.stringify(
      {
        id: snippet.id,
        name: snippet.name,
        description: snippet.description,
        params: snippet.params,
        code: snippet.code,
        updatedAt: snippet.updatedAt,
      },
      null,
      2,
    )}\n`,
  );

  return snippet;
}

async function createTest(project, requestedName) {
  const tests = await loadTests(project);
  const baseLabel = String(requestedName || 'Untitled flow').trim() || 'Untitled flow';
  let candidateId = slugify(baseLabel);
  let suffix = 2;

  while (tests.some((test) => test.id === candidateId)) {
    candidateId = `${slugify(baseLabel)}-${suffix}`;
    suffix += 1;
  }

  const candidateName =
    candidateId === slugify(baseLabel)
      ? baseLabel
      : `${baseLabel} ${suffix - 1}`;

  return persistTest(
    project,
    {
      id: candidateId,
      name: candidateName,
      status: 'draft',
      nodes: [],
      edges: [],
    },
    candidateId,
  );
}

async function createSnippet(project, requestedName) {
  const snippets = await loadSnippets(project);
  const baseLabel = String(requestedName || 'Untitled snippet').trim() || 'Untitled snippet';
  let candidateId = slugify(baseLabel);
  let suffix = 2;

  while (snippets.some((snippet) => snippet.id === candidateId)) {
    candidateId = `${slugify(baseLabel)}-${suffix}`;
    suffix += 1;
  }

  const candidateName =
    candidateId === slugify(baseLabel)
      ? baseLabel
      : `${baseLabel} ${suffix - 1}`;

  return persistSnippet(
    project,
    {
      id: candidateId,
      name: candidateName,
      description: '',
      params: [],
      code: '// Add snippet code here',
    },
    candidateId,
  );
}

async function initGitRepo() {
  await runGit(['init']);
}

async function stageGitWorkspace(project) {
  await runGit([
    'add',
    '--',
    path.dirname(project.paths.testsDir),
    project.paths.generatedTestsDir,
  ]);
}

async function commitGitWorkspace(message) {
  await runGit(['commit', '-m', message]);
}

async function parseBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function getErrorMessage(error) {
  if (error && typeof error === 'object') {
    if ('stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) {
      return error.stderr.trim();
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }

  return 'Unknown error';
}

function getRunErrorMessage(error) {
  const message = getErrorMessage(error);

  if (
    message.includes('MachPortRendezvous') ||
    message.includes('Target page, context or browser has been closed')
  ) {
    return 'Chromium could not launch in the current runtime. Start the app directly on your local machine and retry.';
  }

  const firstLine = message.split('\n').find((line) => line.trim());
  return firstLine ? firstLine.trim() : 'Run failed.';
}

async function handleApi(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');
  const project = await readProject();
  await ensureWorkspaceLayout(project);

  if (request.method === 'GET' && url.pathname === '/api/workspace') {
    sendJson(response, 200, await getWorkspace());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/runs') {
    const body = await parseBody(request);

    try {
      const run = await startTestRun(project, body);
      sendJson(response, 201, { run });
    } catch (error) {
      sendError(response, 400, getErrorMessage(error));
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  const runScreenshotMatch = url.pathname.match(
    /^\/api\/runs\/([^/]+)\/screenshots\/([^/]+)$/,
  );

  if (request.method === 'GET' && runMatch) {
    const runId = normalizeRunId(runMatch[1]);
    const run = runsById.get(runId);

    if (!run) {
      sendError(response, 404, `Run "${runId}" was not found.`);
      return;
    }

    sendJson(response, 200, { run: serializeRun(run) });
    return;
  }

  if (request.method === 'GET' && runScreenshotMatch) {
    const runId = normalizeRunId(runScreenshotMatch[1]);
    const fileName = path.basename(decodeURIComponent(runScreenshotMatch[2]));
    const screenshotPath = path.join(rootDir, runsRootRelative, runId, fileName);

    try {
      const screenshot = await fs.readFile(screenshotPath);
      response.statusCode = 200;
      response.setHeader(
        'Content-Type',
        contentTypes[path.extname(screenshotPath)] || 'application/octet-stream',
      );
      response.setHeader('Cache-Control', 'no-store');
      response.end(screenshot);
    } catch {
      sendError(response, 404, 'Screenshot not found');
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/tests') {
    const body = await parseBody(request);
    const test = await createTest(project, body.name);
    sendJson(response, 201, {
      test,
      git: await getGitStatus(),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/snippets') {
    const body = await parseBody(request);
    const snippet = await createSnippet(project, body.name);
    sendJson(response, 201, {
      snippet,
      git: await getGitStatus(),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/git/init') {
    try {
      await initGitRepo();
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
    } catch (error) {
      sendError(response, 400, getErrorMessage(error));
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/git/stage') {
    try {
      await stageGitWorkspace(project);
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
    } catch (error) {
      sendError(response, 400, getErrorMessage(error));
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/git/commit') {
    const body = await parseBody(request);

    try {
      await commitGitWorkspace(String(body.message || '').trim());
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
    } catch (error) {
      sendError(response, 400, getErrorMessage(error));
    }
    return;
  }

  const testMatch = url.pathname.match(/^\/api\/tests\/([^/]+)$/);
  const snippetMatch = url.pathname.match(/^\/api\/snippets\/([^/]+)$/);

  if (request.method === 'PUT' && testMatch) {
    const body = await parseBody(request);
    const requestedId = slugify(testMatch[1]);
    const test = await persistTest(project, body, requestedId);

    sendJson(response, 200, {
      test,
      git: await getGitStatus(),
    });
    return;
  }

  if (request.method === 'PUT' && snippetMatch) {
    const body = await parseBody(request);
    const requestedId = slugify(snippetMatch[1]);
    const snippet = await persistSnippet(project, body, requestedId);

    sendJson(response, 200, {
      snippet,
      git: await getGitStatus(),
    });
    return;
  }

  sendError(response, 404, 'Not found');
}

async function serveStatic(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const distPath = path.join(rootDir, 'dist', pathname);

  try {
    const file = await fs.readFile(distPath);
    response.statusCode = 200;
    response.setHeader(
      'Content-Type',
      contentTypes[path.extname(distPath)] || 'application/octet-stream',
    );
    response.end(file);
  } catch {
    const html = await fs.readFile(path.join(rootDir, 'dist', 'index.html'));
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  }
}

async function start() {
  if (isProd) {
    const server = http.createServer(async (request, response) => {
      try {
        if ((request.url || '').startsWith('/api/')) {
          await handleApi(request, response);
          return;
        }

        await serveStatic(request, response);
      } catch (error) {
        sendError(response, 500, getErrorMessage(error));
      }
    });

    server.listen(port, host, () => {
      console.log(`Playwright Low-Code Studio listening on http://${host}:${port}`);
    });

    return;
  }

  const vite = await createViteServer({
    server: {
      middlewareMode: true,
    },
    appType: 'custom',
  });

  const server = http.createServer(async (request, response) => {
    try {
      if ((request.url || '').startsWith('/api/')) {
        await handleApi(request, response);
        return;
      }

      const url = new URL(request.url || '/', 'http://localhost');
      const acceptsHtml = request.headers.accept?.includes('text/html');
      const isPageRequest =
        (request.method === 'GET' || request.method === 'HEAD') &&
        acceptsHtml &&
        !path.extname(url.pathname) &&
        !url.pathname.startsWith('/@');

      if (isPageRequest) {
        const template = await fs.readFile(path.join(rootDir, 'index.html'), 'utf8');
        const html = await vite.transformIndexHtml(url.pathname, template);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : html);
        return;
      }

      vite.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end('Not found');
      });
    } catch (error) {
      vite.ssrFixStacktrace(error);
      sendError(response, 500, getErrorMessage(error));
    }
  });

  server.listen(port, host, () => {
    console.log(`Playwright Low-Code Studio listening on http://${host}:${port}`);
  });
}

start();
