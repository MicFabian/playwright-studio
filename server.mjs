import http from 'node:http';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer as createViteServer } from 'vite';
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
import { importSpecSource } from './packages/flow-import/dist/index.mjs';

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const isProd = process.argv.includes('--prod');
const allowNetworkListen = process.argv.includes('--unsafe-network-listen');
const port = Number(process.env.PORT || (isProd ? 4173 : 5173));
const host = allowNetworkListen ? process.env.HOST || '0.0.0.0' : '127.0.0.1';
const securityContext = createSecurityContext({ allowNetworkListen });

const defaultProject = {
  formatVersion: 2,
  name: 'Playwright Low-Code Studio',
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

const runManager = new RunManager({
  rootDir,
  runsDir: path.join(rootDir, runsRootRelative),
  compile: compileFlow,
});

function nowIso() {
  return new Date().toISOString();
}

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
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
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

async function writeFileAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, contents);
  await fs.rename(temporaryPath, filePath);
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
        testImport: String(
          parsed.playwright?.testImport || defaultProject.playwright.testImport,
        ),
      },
    };
  } catch {
    return defaultProject;
  }
}

function materializeTest(project, relativePath, raw) {
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

  const document = {
    formatVersion: FLOW_FORMAT_VERSION,
    id,
    name: String(payload.name || 'Untitled flow'),
    status: statusValues.has(payload.status) ? payload.status : 'draft',
    updatedAt: new Date().toISOString(),
    root: payload.document?.root ?? payload.root ?? { steps: [] },
    layout: payload.document?.layout ?? payload.layout ?? { positions: {} },
    ...(payload.document?.testOptions ? { testOptions: payload.document.testOptions } : {}),
  };

  const compiled = compileFlow(document, { testImport: project.playwright.testImport });

  await writeFileAtomic(
    path.join(rootDir, filePath),
    `${JSON.stringify(document, null, 2)}\n`,
  );

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

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function handleApi(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');

  try {
    if (request.method === 'POST' && url.pathname === '/api/session') {
      handleSessionExchange(securityContext, request, response, url);
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
      const lastEventId = Number(request.headers['last-event-id'] || 0);

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

      const created = [];

      for (const document of documents) {
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
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/git/stage') {
      await stageGitWorkspace(project);
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/git/commit') {
      const body = await parseBody(request);
      await commitGitWorkspace(body.message);
      sendJson(response, 200, {
        git: await getGitStatus(),
      });
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

    throw createHttpError(404, 'Not found');
  } catch (error) {
    sendError(response, getHttpStatus(error), getErrorMessage(error));
  }
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

    server.listen(port, host, () => {
      if (allowNetworkListen) {
        console.warn(
          '\\n  WARNING: --unsafe-network-listen exposes this Studio beyond loopback.\\n' +
            '  Anyone who can reach this port and obtain the launch token can execute\\n' +
            '  repository code on this machine. Do not use on untrusted networks.\\n',
        );
      }

      console.log(
        `Playwright Low-Code Studio listening on ${launchUrl(securityContext, host, port)}`,
      );
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
    if (allowNetworkListen) {
      console.warn(
        '\\n  WARNING: --unsafe-network-listen exposes this Studio beyond loopback.\\n' +
          '  Anyone who can reach this port and obtain the launch token can execute\\n' +
          '  repository code on this machine. Do not use on untrusted networks.\\n',
      );
    }

    console.log(
      `Playwright Low-Code Studio listening on ${launchUrl(securityContext, host, port)}`,
    );
  });
}

start();
