import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[] = [];
let responder: (url: string, init: RequestInit) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function freshClient() {
  // Session state lives in module scope, so each test needs its own copy.
  vi.resetModules();
  return import('./workspaceClient');
}

beforeEach(() => {
  calls = [];
  responder = () => json({});

  vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(responder(String(input), init));
  });

  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/#token=launch-token-123');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session bootstrap', () => {
  it('exchanges the launch token once and reuses the session', async () => {
    responder = (url) =>
      url.includes('/api/session') ? json({ csrfToken: 'csrf-1' }) : json({ tests: [] });

    const client = await freshClient();
    await client.loadWorkspace();
    await client.loadWorkspace();

    const exchanges = calls.filter((call) => call.url.includes('/api/session'));

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].url).toContain('token=launch-token-123');
  });

  it('strips the token from the address bar after exchanging it', async () => {
    responder = (url) => (url.includes('/api/session') ? json({ csrfToken: 'c' }) : json({}));

    const client = await freshClient();
    await client.loadWorkspace();

    expect(window.location.hash).toBe('');
  });

  it('reuses an existing session cookie when the token is gone', async () => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.setItem('studio.csrf', 'stored-csrf');
    responder = () => json({ tests: [] });

    const client = await freshClient();
    await expect(client.loadWorkspace()).resolves.toBeDefined();

    expect(calls.some((call) => call.url.includes('/api/session'))).toBe(false);
  });

  it('explains itself when there is no token and no session', async () => {
    window.history.replaceState(null, '', '/');
    responder = () => json({ error: 'nope' }, 401);

    const client = await freshClient();

    await expect(client.loadWorkspace()).rejects.toThrow(/launch token/i);
  });
});

describe('requests', () => {
  beforeEach(() => {
    responder = (url) =>
      url.includes('/api/session') ? json({ csrfToken: 'csrf-1' }) : json({ ok: true });
  });

  it('sends the CSRF header on writes but not on reads', async () => {
    const client = await freshClient();

    await client.loadWorkspace();
    await client.createTest('New flow');

    const read = calls.find((call) => call.url.endsWith('/api/workspace'))!;
    const write = calls.find((call) => call.init.method === 'POST' && call.url === '/api/tests')!;

    expect(new Headers(read.init.headers).get('x-studio-csrf')).toBeNull();
    expect(new Headers(write.init.headers).get('x-studio-csrf')).toBe('csrf-1');
    expect(new Headers(write.init.headers).get('content-type')).toBe('application/json');
  });

  it('always sends credentials so the session cookie travels', async () => {
    const client = await freshClient();
    await client.loadWorkspace();

    expect(calls.at(-1)!.init.credentials).toBe('same-origin');
  });

  it('surfaces the server error message', async () => {
    responder = (url) =>
      url.includes('/api/session')
        ? json({ csrfToken: 'c' })
        : json({ error: 'Flow "x" does not exist.' }, 404);

    const client = await freshClient();

    await expect(client.loadWorkspace()).rejects.toThrow('Flow "x" does not exist.');
  });

  it('falls back to the status when the body is not JSON', async () => {
    responder = (url) =>
      url.includes('/api/session')
        ? json({ csrfToken: 'c' })
        : new Response('gateway exploded', { status: 502 });

    const client = await freshClient();

    await expect(client.loadWorkspace()).rejects.toThrow('gateway exploded');
  });
});

describe('run endpoints', () => {
  beforeEach(() => {
    responder = (url) =>
      url.includes('/api/session') ? json({ csrfToken: 'csrf-1' }) : json({ run: { id: 'r1' } });
  });

  it('starts a run by id, never by sending steps', async () => {
    const client = await freshClient();
    await client.startRun({ testId: 'login', testName: 'Login', liveMode: true });

    const call = calls.find((entry) => entry.url === '/api/runs')!;
    const body = JSON.parse(String(call.init.body));

    expect(body).toEqual({ testId: 'login', testName: 'Login', liveMode: true });
    expect(body).not.toHaveProperty('nodes');
  });

  it('encodes ids into artifact URLs', async () => {
    const client = await freshClient();

    expect(client.artifactUrl('run 1', 'trace/a b.zip')).toBe(
      '/api/runs/run%201/artifacts/trace/a%20b.zip',
    );
  });
});
