import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  authenticate,
  createSecurityContext,
  handleSessionExchange,
  launchUrl,
  readLimitedBody,
} from './server/security.mjs';
import {
  FLOW_FORMAT_VERSION,
  compileFlow,
  countSteps,
  hasBlockingDiagnostics,
  isV1Flow,
  migrateV1Flow,
} from './packages/flow-core/dist/index.mjs';
import { RunManager } from './packages/studio-runner/src/run-manager.mjs';
import { RecordingManager } from './packages/studio-recorder/src/recording-manager.mjs';
import { importSpecSource, readPlaywrightConfig } from './packages/flow-import/dist/index.mjs';

const execFileAsync = promisify(execFile);
const installRoot = process.env.STUDIO_INSTALL_ROOT || process.cwd();
const rootDir = process.env.STUDIO_WORKSPACE_ROOT || installRoot;
const isProd = process.argv.includes('--prod') || process.env.STUDIO_PROD === '1';
const allowNetworkListen = process.argv.includes('--unsafe-network-listen');
const port = Number(process.env.PORT || (isProd ? 4173 : 5173));
const host = allowNetworkListen ? process.env.HOST || '0.0.0.0' : '127.0.0.1';
const securityContext = createSecurityContext({ allowNetworkListen });
let activePort = port;
// Test-only endpoints. Refused outright in a packaged build so setting the
// environment variable cannot turn them on for a shipped app.
const testHooksEnabled = process.env.STUDIO_E2E === '1' && process.env.STUDIO_PACKAGED !== '1';

const defaultProject = {
  formatVersion: 2,
  name: path.basename(rootDir) || 'Playwright Studio',
  paths: {
    testsDir: 'playwright-lowcode/tests',
    snippetsDir: 'playwright-lowcode/snippets',
    generatedTestsDir: 'tests/generated',
  },
  playwright: {
    testImport: '@playwright/test',
  },
};

const statusValues = new Set(['stable', 'draft', 'failing']);

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

const recordingManager = new RecordingManager({
  rootDir: installRoot,
  workspaceDir: rootDir,
  scratchDir: path.join(rootDir, '.studio-recordings'),
  importSource: (source, fileName) => importSpecSource(source, fileName),
  resolveRunnable: (relative) =>
    path.join(
      installRoot.includes('app.asar')
        ? installRoot.replace('app.asar', 'app.asar.unpacked')
        : installRoot,
      relative,
    ),
});

const runManager = new RunManager({
  rootDir: installRoot,
  workspaceDir: rootDir,
  runsDir: path.join(rootDir, runsRootRelative),
  ...(process.env.STUDIO_SCRATCH_DIR ? { scratchDir: process.env.STUDIO_SCRATCH_DIR } : {}),
  compile: compileFlow,
  resolveCompileOptions: async () => {
    const project = await readProject();
    const playwrightConfig = await discoverPlaywrightConfig(project);

    return {
      testImport: project.playwright.testImport,
      baseURL: playwrightConfig.baseURL,
      snippets: await loadSnippets(project),
    };
  },
});

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getHttpStatus(error) {
  if (error && typeof error === 'object' && Number.isInteger(error.statusCode)) {
    return error.statusCode;
  }

  return 500;
}

function normalizeRunId(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');

  if (!normalized) {
    throw createHttpError(400, 'That run id is not valid.');
  }

  return normalized;
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'untitled-flow';
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

let atomicWriteCounter = 0;

async function writeFileAtomic(filePath, contents) {
  invalidateGitStatus();
  atomicWriteCounter += 1;

  // Unique per write: two concurrent saves of the same flow would otherwise
  // share a temp path, and one rename would fail with ENOENT.
  const temporaryPath = `${filePath}.tmp-${process.pid}-${atomicWriteCounter}`;

  try {
    await fs.writeFile(temporaryPath, contents);
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
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
      playwright: {
        testImport: String(parsed.playwright?.testImport || defaultProject.playwright.testImport),
        ...(parsed.playwright?.configPath
          ? { configPath: String(parsed.playwright.configPath) }
          : {}),
      },
    };
  } catch {
    return defaultProject;
  }
}

function materializeTest(project, relativePath, raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('This file does not contain a flow document.');
  }

  if (!isV1Flow(raw) && (raw.root == null || !Array.isArray(raw.root.steps))) {
    throw new Error('This flow is missing its root step list.');
  }

  const fallbackId = path.basename(relativePath, '.flow.json');
  const document = isV1Flow(raw)
    ? migrateV1Flow(raw, fallbackId).document
    : {
        ...raw,
        formatVersion: FLOW_FORMAT_VERSION,
        id: slugify(raw.id || raw.name || fallbackId),
        name: String(raw.name || 'Untitled flow'),
        status: statusValues.has(raw.status) ? raw.status : 'draft',
        root: raw.root ?? { steps: [] },
        layout: raw.layout ?? { positions: {} },
      };

  const specPath = path
    .join(project.paths.generatedTestsDir, `${document.id}.spec.ts`)
    .replaceAll('\\', '/');

  return {
    id: document.id,
    name: document.name,
    status: document.status,
    steps: countSteps(document.root),
    updatedAt: String(document.updatedAt || ''),
    filePath: relativePath.replaceAll('\\', '/'),
    specPath,
    document,
  };
}

const workspaceProblems = [];

function recordProblem(filePath, error) {
  workspaceProblems.push({
    filePath: filePath.replaceAll('\\', '/'),
    message: error instanceof Error ? error.message : String(error),
  });
}

async function loadTests(project) {
  workspaceProblems.length = 0;

  const testsDir = path.join(rootDir, project.paths.testsDir);
  const files = await fs.readdir(testsDir);
  const loaded = await Promise.all(
    files
      .filter((file) => file.endsWith('.flow.json'))
      .map(async (file) => {
        const relativePath = path.join(project.paths.testsDir, file);

        try {
          const raw = await readJson(path.join(rootDir, relativePath));
          return materializeTest(project, relativePath, raw);
        } catch (error) {
          recordProblem(relativePath, error);
          return null;
        }
      }),
  );

  return loaded.filter(Boolean).sort((left, right) => left.name.localeCompare(right.name));
}

async function loadSnippets(project) {
  const snippetsDir = path.join(rootDir, project.paths.snippetsDir);
  const files = await fs.readdir(snippetsDir);
  const snippets = await Promise.all(
    files
      .filter((file) => file.endsWith('.snippet.json'))
      .map(async (file) => {
        const relativePath = path.join(project.paths.snippetsDir, file);

        try {
          const raw = await readJson(path.join(rootDir, relativePath));
          return materializeSnippet(relativePath, raw);
        } catch (error) {
          recordProblem(relativePath, error);
          return null;
        }
      }),
  );

  return snippets.filter(Boolean).sort((left, right) => left.name.localeCompare(right.name));
}

const SNIPPET_PARAM_TYPES = new Set(['string', 'number', 'boolean']);

function normalizeSnippetParam(raw) {
  if (typeof raw === 'string') {
    return { name: raw, type: 'string', required: true };
  }

  return {
    name: String(raw?.name || 'value'),
    type: SNIPPET_PARAM_TYPES.has(raw?.type) ? raw.type : 'string',
    ...(raw?.description ? { description: String(raw.description) } : {}),
    ...(raw?.required === false ? { required: false } : { required: true }),
    ...(raw?.defaultValue != null ? { defaultValue: String(raw.defaultValue) } : {}),
  };
}

function normalizeSnippetOutput(raw) {
  return {
    name: String(raw?.name || 'value'),
    type: SNIPPET_PARAM_TYPES.has(raw?.type) ? raw.type : 'string',
    ...(raw?.description ? { description: String(raw.description) } : {}),
  };
}

function materializeSnippet(relativePath, raw) {
  return {
    formatVersion: 2,
    id: slugify(raw.id || raw.name || path.basename(relativePath, '.snippet.json')),
    name: String(raw.name || 'Untitled snippet'),
    description: String(raw.description || ''),
    params: Array.isArray(raw.params) ? raw.params.map(normalizeSnippetParam) : [],
    outputs: Array.isArray(raw.outputs) ? raw.outputs.map(normalizeSnippetOutput) : [],
    code: String(raw.code || ''),
    updatedAt: String(raw.updatedAt || ''),
    filePath: relativePath.replaceAll('\\', '/'),
  };
}

async function runGit(args) {
  return execFileAsync('git', args, { cwd: rootDir });
}

// Three git subprocesses cost roughly 40ms, which dominates every request that
// reports status. Autosave makes that frequent, so the result is cached briefly
// and dropped whenever the workspace is written to.
const GIT_STATUS_TTL_MS = 1500;
let gitStatusCache = { at: 0, value: null, pending: null };
let lastKnownGitStatus = null;

function invalidateGitStatus() {
  gitStatusCache = { at: 0, value: null, pending: null };
}

// Saving should not wait on git. The status is refreshed in the background and
// the caller gets whatever is already known, which the UI only uses to show
// how many files changed.
function getGitStatusEventually() {
  if (!lastKnownGitStatus) {
    return getGitStatus();
  }

  // A write has just invalidated the cache, so this value is one save behind.
  // The UI uses it for a changed-file count, and the refresh already running
  // will correct it well before anyone reads it.
  void getGitStatus().catch(() => undefined);
  return lastKnownGitStatus;
}

async function getGitStatus() {
  const now = Date.now();

  if (gitStatusCache.value && now - gitStatusCache.at < GIT_STATUS_TTL_MS) {
    return gitStatusCache.value;
  }

  if (gitStatusCache.pending) {
    return gitStatusCache.pending;
  }

  const pending = readGitStatus()
    .then((value) => {
      gitStatusCache = { at: Date.now(), value, pending: null };
      lastKnownGitStatus = value;
      return value;
    })
    .catch((error) => {
      gitStatusCache = { at: 0, value: null, pending: null };
      throw error;
    });

  gitStatusCache.pending = pending;
  return pending;
}

async function readGitStatus() {
  try {
    const [{ stdout: root }, { stdout: statusOutput }] = await Promise.all([
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

const CONFIG_CANDIDATES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];

async function discoverPlaywrightConfig(project) {
  const configured = project.playwright.configPath;
  const candidates = configured ? [configured, ...CONFIG_CANDIDATES] : CONFIG_CANDIDATES;

  for (const candidate of candidates) {
    try {
      const source = await fs.readFile(path.join(rootDir, candidate), 'utf8');
      return readPlaywrightConfig(source, candidate);
    } catch {
      continue;
    }
  }

  return {
    configPath: null,
    testDir: null,
    baseURL: null,
    testIdAttribute: null,
    projects: [],
    hasWebServer: false,
    fixtureImports: [],
    diagnostics: [
      {
        code: 'no-config',
        message:
          'No Playwright config was found in this workspace. Generated specs use Studio defaults.',
      },
    ],
  };
}

async function getWorkspace() {
  const project = await readProject();
  await ensureWorkspaceLayout(project);

  const tests = await loadTests(project);
  const snippets = await loadSnippets(project);

  return {
    project,
    playwrightConfig: await discoverPlaywrightConfig(project),
    tests,
    snippets,
    problems: [...workspaceProblems],
    git: await getGitStatus(),
  };
}

async function persistTest(project, payload, fallbackId) {
  const id = slugify(payload.id || payload.name || fallbackId || 'untitled-flow');
  const filePath = path.join(project.paths.testsDir, `${id}.flow.json`).replaceAll('\\', '/');
  const specPath = path
    .join(project.paths.generatedTestsDir, `${id}.spec.ts`)
    .replaceAll('\\', '/');

  const document = {
    formatVersion: FLOW_FORMAT_VERSION,
    id,
    name: String(payload.name || 'Untitled flow'),
    status: statusValues.has(payload.status) ? payload.status : 'draft',
    updatedAt: new Date().toISOString(),
    root: payload.document?.root ?? payload.root ?? { steps: [] },
    layout: payload.document?.layout ?? payload.layout ?? { positions: {} },
    ...(payload.document?.testOptions ? { testOptions: payload.document.testOptions } : {}),
    ...(payload.document?.data ? { data: payload.document.data } : {}),
  };

  const playwrightConfig = await discoverPlaywrightConfig(project);
  const compiled = compileFlow(document, {
    testImport: project.playwright.testImport,
    baseURL: playwrightConfig.baseURL,
    snippets: await loadSnippets(project),
  });

  await writeFileAtomic(path.join(rootDir, filePath), `${JSON.stringify(document, null, 2)}\n`);

  if (!hasBlockingDiagnostics(compiled)) {
    await writeFileAtomic(path.join(rootDir, specPath), compiled.source);
  }

  return {
    id: document.id,
    name: document.name,
    status: document.status,
    steps: countSteps(document.root),
    updatedAt: document.updatedAt,
    filePath,
    specPath,
    document,
    diagnostics: compiled.diagnostics,
  };
}

async function renameTest(project, currentId, requestedName) {
  const tests = await loadTests(project);
  const existing = tests.find((test) => test.id === currentId);

  if (!existing) {
    throw createHttpError(404, `Flow "${currentId}" does not exist.`);
  }

  const label = String(requestedName || '').trim();

  if (!label) {
    throw createHttpError(400, 'A flow needs a name.');
  }

  const desiredId = slugify(label);

  if (desiredId !== currentId && tests.some((test) => test.id === desiredId)) {
    throw createHttpError(409, `A flow named "${label}" already exists.`);
  }

  const renamed = await persistTest(
    project,
    { ...existing, id: desiredId, name: label, document: { ...existing.document, name: label } },
    desiredId,
  );

  if (desiredId !== currentId) {
    await fs
      .rm(path.join(rootDir, project.paths.testsDir, `${currentId}.flow.json`), { force: true })
      .catch(() => undefined);
    await fs
      .rm(path.join(rootDir, project.paths.generatedTestsDir, `${currentId}.spec.ts`), {
        force: true,
      })
      .catch(() => undefined);
  }

  return renamed;
}

async function persistSnippet(project, payload, fallbackId) {
  const id = slugify(payload.id || payload.name || fallbackId || 'untitled-snippet');
  const filePath = path.join(project.paths.snippetsDir, `${id}.snippet.json`).replaceAll('\\', '/');
  const snippet = materializeSnippet(filePath, {
    id,
    name: payload.name,
    description: payload.description,
    params: payload.params,
    outputs: payload.outputs,
    code: payload.code,
    updatedAt: new Date().toISOString(),
  });

  await writeFileAtomic(
    path.join(rootDir, filePath),
    `${JSON.stringify(
      {
        formatVersion: 2,
        id: snippet.id,
        name: snippet.name,
        description: snippet.description,
        params: snippet.params,
        outputs: snippet.outputs,
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
    candidateId === slugify(baseLabel) ? baseLabel : `${baseLabel} ${suffix - 1}`;

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
    candidateId === slugify(baseLabel) ? baseLabel : `${baseLabel} ${suffix - 1}`;

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
  const workspaceRoot = path.dirname(project.paths.testsDir);
  const projectFile = path.join(workspaceRoot, 'project.json');

  await runGit([
    'add',
    '-A',
    '--',
    projectFile,
    project.paths.testsDir,
    project.paths.snippetsDir,
    project.paths.generatedTestsDir,
  ]);
}

async function commitGitWorkspace(message) {
  const trimmedMessage = String(message || '').trim();

  if (!trimmedMessage) {
    throw createHttpError(400, 'Commit message is required.');
  }

  await runGit(['commit', '-m', trimmedMessage]);
}

async function parseBody(request) {
  const raw = (await readLimitedBody(request)).trim();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw createHttpError(400, 'Request body must be valid JSON.');
  }
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

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function handleApi(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');

  try {
    if (request.method === 'POST' && url.pathname === '/api/session') {
      handleSessionExchange(securityContext, request, response, url);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/launch-token' && testHooksEnabled) {
      sendJson(response, 200, { token: securityContext.launchToken });
      return;
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/api/test-reset' &&
      testHooksEnabled &&
      process.env.STUDIO_SEED_ROOT
    ) {
      const seedTests = path.join(process.env.STUDIO_SEED_ROOT, 'playwright-lowcode', 'tests');
      const liveTests = path.join(rootDir, 'playwright-lowcode', 'tests');

      await fs.rm(liveTests, { recursive: true, force: true });
      await fs.mkdir(liveTests, { recursive: true });

      for (const file of await fs.readdir(seedTests)) {
        await fs.copyFile(path.join(seedTests, file), path.join(liveTests, file));
      }

      sendJson(response, 200, { reset: true });
      return;
    }

    authenticate(securityContext, request, {
      mutating: mutatingMethods.has(request.method),
    });
  } catch (error) {
    sendError(response, getHttpStatus(error), getErrorMessage(error));
    return;
  }

  const project = await readProject();
  await ensureWorkspaceLayout(project);

  try {
    if (request.method === 'GET' && url.pathname === '/api/workspace') {
      sendJson(response, 200, await getWorkspace());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/runs') {
      const body = await parseBody(request);

      if (Array.isArray(body?.nodes) || Array.isArray(body?.edges)) {
        throw createHttpError(
          400,
          'Runs execute persisted flows only. Save the flow, then run it by id.',
        );
      }

      const requestedId = slugify(body?.testId || '');
      const tests = await loadTests(project);
      const selected = tests.find((test) => test.id === requestedId);

      if (!selected) {
        throw createHttpError(404, `Flow "${requestedId}" does not exist.`);
      }

      const run = await runManager.start({
        testId: selected.id,
        testName: selected.name,
        liveMode: body?.liveMode === true,
        document: selected.document,
      });

      sendJson(response, 201, { run });
      return;
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    const runEventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    const runCancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    const runArtifactMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/(.+)$/);

    if (request.method === 'GET' && url.pathname === '/api/runs') {
      sendJson(response, 200, { runs: await runManager.listRuns() });
      return;
    }

    if (request.method === 'GET' && runMatch) {
      const runId = normalizeRunId(runMatch[1]);
      const run = await runManager.readManifest(runId);

      if (!run) {
        throw createHttpError(404, `Run "${runId}" was not found.`);
      }

      sendJson(response, 200, { run });
      return;
    }

    if (request.method === 'GET' && runEventsMatch) {
      const runId = normalizeRunId(runEventsMatch[1]);
      const requestedEventId = Number.parseInt(String(request.headers['last-event-id'] ?? ''), 10);
      const lastEventId =
        Number.isFinite(requestedEventId) && requestedEventId > 0 ? requestedEventId : 0;

      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.flushHeaders?.();

      const send = (event) => {
        response.write(`id: ${event.seq}\n`);
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      (await runManager.readEvents(runId, lastEventId)).forEach(send);

      const onEvent = (eventRunId, event) => {
        if (eventRunId === runId) {
          send(event);
        }
      };

      runManager.on('event', onEvent);

      const heartbeat = setInterval(() => response.write(': ping\n\n'), 15000);

      request.on('close', () => {
        clearInterval(heartbeat);
        runManager.off('event', onEvent);
      });

      return;
    }

    if (request.method === 'POST' && runCancelMatch) {
      const runId = normalizeRunId(runCancelMatch[1]);
      const cancelled = await runManager.cancel(runId);
      sendJson(response, cancelled ? 200 : 409, { cancelled });
      return;
    }

    if (request.method === 'GET' && runArtifactMatch) {
      const runId = normalizeRunId(runArtifactMatch[1]);
      const requested = decodeURIComponent(runArtifactMatch[2]);
      const artifactsRoot = path.join(runManager.runDirectory(runId), 'artifacts');
      const artifactPath = path.resolve(artifactsRoot, requested);

      if (!artifactPath.startsWith(path.resolve(artifactsRoot) + path.sep)) {
        throw createHttpError(403, 'Artifact path escapes the run directory.');
      }

      try {
        const artifact = await fs.readFile(artifactPath);
        response.statusCode = 200;
        response.setHeader(
          'Content-Type',
          contentTypes[path.extname(artifactPath)] || 'application/octet-stream',
        );
        response.setHeader('Cache-Control', 'no-store');
        response.end(artifact);
      } catch {
        throw createHttpError(404, 'Artifact not found');
      }

      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/import/preview') {
      const body = await parseBody(request);
      const source = String(body?.source || '');

      if (!source.trim()) {
        throw createHttpError(400, 'Paste or upload a spec file to import.');
      }

      const result = importSpecSource(source, String(body?.fileName || 'imported.spec.ts'));

      sendJson(response, 200, {
        scaffold: result.scaffold,
        diagnostics: result.diagnostics,
        tests: result.tests.map((test) => ({
          name: test.document.name,
          fidelity: test.fidelity,
          structuredSteps: test.structuredSteps,
          opaqueSteps: test.opaqueSteps,
          diagnostics: test.diagnostics,
          document: test.document,
          preview: compileFlow(test.document).source,
        })),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/import/adopt') {
      const body = await parseBody(request);
      const documents = Array.isArray(body?.documents) ? body.documents : [];

      if (documents.length === 0) {
        throw createHttpError(400, 'Select at least one imported test to adopt.');
      }

      const existing = new Set((await loadTests(project)).map((test) => test.id));
      const created = [];

      for (const document of documents) {
        if (existing.has(slugify(document.id))) {
          throw createHttpError(
            409,
            `A flow named "${document.name}" already exists. Rename it before importing.`,
          );
        }

        existing.add(slugify(document.id));
        created.push(
          await persistTest(
            project,
            {
              id: document.id,
              name: document.name,
              status: 'draft',
              document,
            },
            document.id,
          ),
        );
      }

      sendJson(response, 201, { tests: created, git: await getGitStatus() });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/recordings') {
      const body = await parseBody(request);

      // Strict allowlist: the recorder must never take a command, a path, or
      // anything resembling source from the client.
      const allowed = new Set(['testId', 'startUrl']);
      const unexpected = Object.keys(body ?? {}).filter((key) => !allowed.has(key));

      if (unexpected.length > 0) {
        throw createHttpError(400, `A recording does not accept: ${unexpected.join(', ')}.`);
      }

      const tests = await loadTests(project);
      const selected = tests.find((test) => test.id === slugify(body?.testId || ''));

      if (!selected) {
        throw createHttpError(404, 'Record into a saved flow.');
      }

      const playwrightConfig = await discoverPlaywrightConfig(project);

      const recording = await recordingManager.start({
        flowId: selected.id,
        startUrl: String(body?.startUrl || playwrightConfig.baseURL || 'about:blank'),
        testIdAttribute: playwrightConfig.testIdAttribute || 'data-testid',
      });

      sendJson(response, 201, { recording });
      return;
    }

    const recordingMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)$/);
    const recordingStopMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/stop$/);
    const recordingAcceptMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/accept$/);
    const recordingEventsMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/events$/);

    if (request.method === 'GET' && recordingMatch) {
      const recording = recordingManager.describe();

      if (!recording || recording.id !== normalizeRunId(recordingMatch[1])) {
        throw createHttpError(404, 'That recording is no longer active.');
      }

      sendJson(response, 200, { recording });
      return;
    }

    if (request.method === 'GET' && recordingEventsMatch) {
      const recordingId = normalizeRunId(recordingEventsMatch[1]);

      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.flushHeaders?.();

      const current = recordingManager.describe();

      if (current?.id === recordingId) {
        response.write(`data: ${JSON.stringify({ type: 'recording:snapshot', ...current })}\n\n`);
      }

      const onEvent = (event) => {
        if (event.id === recordingId) {
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      recordingManager.on('recording', onEvent);

      const heartbeat = setInterval(() => response.write(': ping\n\n'), 15000);

      request.on('close', () => {
        clearInterval(heartbeat);
        recordingManager.off('recording', onEvent);
      });

      return;
    }

    if (request.method === 'POST' && recordingStopMatch) {
      const recording = await recordingManager.stop(normalizeRunId(recordingStopMatch[1]));
      sendJson(response, 200, { recording });
      return;
    }

    if (request.method === 'POST' && recordingAcceptMatch) {
      const recordingId = normalizeRunId(recordingAcceptMatch[1]);
      const current = recordingManager.describe();

      if (!current || current.id !== recordingId) {
        throw createHttpError(404, 'That recording is no longer available.');
      }

      if (current.status !== 'review') {
        throw createHttpError(409, 'Stop the recording before adding its steps.');
      }

      const steps = await recordingManager.accept(recordingId);
      sendJson(response, 200, { steps: steps ?? [] });
      return;
    }

    if (request.method === 'DELETE' && recordingMatch) {
      await recordingManager.discard(normalizeRunId(recordingMatch[1]));
      sendJson(response, 200, { discarded: true });
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
      await initGitRepo();
      invalidateGitStatus();
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/git/stage') {
      await stageGitWorkspace(project);
      invalidateGitStatus();
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/git/commit') {
      const body = await parseBody(request);
      await commitGitWorkspace(body.message);
      invalidateGitStatus();
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
      return;
    }

    const testMatch = url.pathname.match(/^\/api\/tests\/([^/]+)$/);
    const testRenameMatch = url.pathname.match(/^\/api\/tests\/([^/]+)\/rename$/);
    const snippetMatch = url.pathname.match(/^\/api\/snippets\/([^/]+)$/);

    if (request.method === 'PUT' && testMatch) {
      const body = await parseBody(request);
      const requestedId = slugify(testMatch[1]);
      const test = await persistTest(project, body, requestedId);

      sendJson(response, 200, {
        test,
        git: await getGitStatusEventually(),
      });
      return;
    }

    if (request.method === 'POST' && testRenameMatch) {
      const body = await parseBody(request);
      const currentId = slugify(testRenameMatch[1]);
      const renamed = await renameTest(project, currentId, body.name);

      sendJson(response, 200, {
        test: renamed,
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

    throw createHttpError(404, 'Not found');
  } catch (error) {
    sendError(response, getHttpStatus(error), getErrorMessage(error));
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const distPath = path.join(installRoot, 'dist', pathname);

  try {
    const file = await fs.readFile(distPath);
    response.statusCode = 200;
    response.setHeader(
      'Content-Type',
      contentTypes[path.extname(distPath)] || 'application/octet-stream',
    );
    response.end(file);
  } catch {
    const html = await fs.readFile(path.join(installRoot, 'dist', 'index.html'));
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  }
}

async function start() {
  await fs.mkdir(path.join(rootDir, runsRootRelative), { recursive: true });
  await runManager.reconcile();
  void runManager.collectGarbage();

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

    const boundPort = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve(server.address().port);
      });
    });

    activePort = boundPort;
    announce();

    return { server, url: launchUrl(securityContext, host, boundPort), port: boundPort, host };
  }

  const { createServer: createViteServer } = await import('vite');
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
        const template = await fs.readFile(path.join(installRoot, 'index.html'), 'utf8');
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

  const boundPort = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });

  activePort = boundPort;
  announce();

  return { server, url: launchUrl(securityContext, host, boundPort), port: boundPort, host };
}

function announce() {
  if (allowNetworkListen) {
    console.warn(
      '\n  WARNING: --unsafe-network-listen exposes this Studio beyond loopback.\n' +
        '  Anyone who can reach this port and obtain the launch token can execute\n' +
        '  repository code on this machine. Do not use on untrusted networks.\n',
    );
  }

  console.log(
    `Playwright Low-Code Studio listening on ${launchUrl(securityContext, host, activePort)}`,
  );
}

export async function startStudio() {
  return start();
}

export async function stopStudio() {
  await recordingManager.shutdown().catch(() => undefined);
  await runManager.shutdown().catch(() => undefined);
}

export function studioLaunchUrl() {
  return launchUrl(securityContext, host, activePort);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void start();
}
