import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain JavaScript module with no type declarations.
import {
  authenticate,
  createSecurityContext,
  handleSessionExchange,
  isLoopbackHost,
  launchUrl,
  readLimitedBody,
} from './security.mjs';

interface FakeRequest {
  headers: Record<string, string | undefined>;
  method?: string;
}

function request(headers: Record<string, string | undefined> = {}): FakeRequest {
  return { headers: { host: '127.0.0.1:5173', ...headers } };
}

function sessionCookie(context: { sessionToken: string }): string {
  return `studio_session=${context.sessionToken}`;
}

function expectStatus(run: () => void, status: number) {
  try {
    run();
  } catch (error) {
    expect((error as { statusCode?: number }).statusCode).toBe(status);
    return;
  }

  throw new Error(`expected the call to be rejected with ${status}`);
}

describe('loopback detection', () => {
  it('accepts the loopback names a browser can use', () => {
    ['127.0.0.1', '127.0.0.1:5173', 'localhost:9', 'http://localhost'].forEach((host) =>
      expect(isLoopbackHost(host)).toBe(true),
    );
  });

  it('rejects anything else, including a lookalike host', () => {
    ['example.com', '127.0.0.1.evil.test', 'localhost.evil.test', '', undefined].forEach((host) =>
      expect(isLoopbackHost(host)).toBe(false),
    );
  });
});

describe('session establishment', () => {
  it('issues a CSRF token and a session cookie for the launch token', () => {
    const context = createSecurityContext();
    const headers: Record<string, string> = {};
    let body = '';

    handleSessionExchange(
      context,
      request(),
      {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
        end: (chunk: string) => {
          body = chunk;
        },
      },
      new URL(`http://127.0.0.1/api/session?token=${context.launchToken}`),
    );

    expect(JSON.parse(body).csrfToken).toBe(context.csrfToken);
    expect(headers['Set-Cookie']).toContain('HttpOnly');
    expect(headers['Set-Cookie']).toContain('SameSite=Strict');
  });

  it('refuses a wrong or missing launch token', () => {
    const context = createSecurityContext();
    const response = { setHeader: () => undefined, end: () => undefined };

    ['wrong', ''].forEach((token) =>
      expectStatus(
        () =>
          handleSessionExchange(
            context,
            request(),
            response,
            new URL(`http://127.0.0.1/api/session?token=${token}`),
          ),
        401,
      ),
    );
  });

  it('puts the launch token in the URL it prints', () => {
    const context = createSecurityContext();

    expect(launchUrl(context, '127.0.0.1', 5173)).toBe(
      `http://127.0.0.1:5173/#token=${context.launchToken}`,
    );
  });
});

describe('authentication', () => {
  it('requires a session cookie', () => {
    const context = createSecurityContext();

    expectStatus(() => authenticate(context, request(), { mutating: false }), 401);
  });

  it('accepts a valid session for a read', () => {
    const context = createSecurityContext();

    expect(() =>
      authenticate(context, request({ cookie: sessionCookie(context) }), { mutating: false }),
    ).not.toThrow();
  });

  it('requires the CSRF header and a JSON body for a write', () => {
    const context = createSecurityContext();
    const cookie = sessionCookie(context);

    expectStatus(() => authenticate(context, request({ cookie }), { mutating: true }), 403);

    expectStatus(
      () =>
        authenticate(context, request({ cookie, 'x-studio-csrf': context.csrfToken }), {
          mutating: true,
        }),
      403,
    );

    expect(() =>
      authenticate(
        context,
        request({
          cookie,
          'x-studio-csrf': context.csrfToken,
          'content-type': 'application/json',
        }),
        { mutating: true },
      ),
    ).not.toThrow();
  });

  it('rejects a wrong CSRF token', () => {
    const context = createSecurityContext();

    expectStatus(
      () =>
        authenticate(
          context,
          request({
            cookie: sessionCookie(context),
            'x-studio-csrf': 'not-the-token',
            'content-type': 'application/json',
          }),
          { mutating: true },
        ),
      403,
    );
  });

  it('rejects a cross-origin request even with valid credentials', () => {
    const context = createSecurityContext();

    expectStatus(
      () =>
        authenticate(
          context,
          request({ cookie: sessionCookie(context), origin: 'http://evil.example.com' }),
          { mutating: false },
        ),
      403,
    );
  });

  it('rejects an opaque origin', () => {
    const context = createSecurityContext();

    expectStatus(
      () =>
        authenticate(context, request({ cookie: sessionCookie(context), origin: 'null' }), {
          mutating: false,
        }),
      403,
    );
  });

  it('rejects a non-loopback Host header', () => {
    const context = createSecurityContext();

    expectStatus(
      () =>
        authenticate(
          context,
          request({ host: 'studio.example.com', cookie: sessionCookie(context) }),
          {
            mutating: false,
          },
        ),
      403,
    );
  });

  it('allows a non-loopback host when network listening was opted into', () => {
    const context = createSecurityContext({ allowNetworkListen: true });

    expect(() =>
      authenticate(
        context,
        request({ host: 'studio.example.com', cookie: sessionCookie(context) }),
        { mutating: false },
      ),
    ).not.toThrow();
  });

  it('survives a cookie header with malformed percent encoding', () => {
    const context = createSecurityContext();

    // decodeURIComponent throws on this; a 500 here would be a denial of service.
    expectStatus(
      () => authenticate(context, request({ cookie: 'studio_session=%FF' }), { mutating: false }),
      401,
    );
  });

  it('keeps the first value when a cookie name is repeated', () => {
    const context = createSecurityContext();

    expect(() =>
      authenticate(
        context,
        request({ cookie: `studio_session=${context.sessionToken}; studio_session=forged` }),
        { mutating: false },
      ),
    ).not.toThrow();
  });

  it('does not accept a session token from a different context', () => {
    const context = createSecurityContext();
    const other = createSecurityContext();

    expectStatus(
      () => authenticate(context, request({ cookie: sessionCookie(other) }), { mutating: false }),
      401,
    );
  });
});

describe('request bodies', () => {
  async function* chunks(...parts: string[]) {
    for (const part of parts) {
      yield Buffer.from(part);
    }
  }

  it('reads a body in pieces', async () => {
    await expect(readLimitedBody(chunks('{"a":', '1}'))).resolves.toBe('{"a":1}');
  });

  it('refuses a body past the limit', async () => {
    const oversized = chunks('x'.repeat(9 * 1024 * 1024));

    await expect(readLimitedBody(oversized)).rejects.toMatchObject({ statusCode: 413 });
  });
});
