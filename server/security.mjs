import { randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'studio_session';
const CSRF_HEADER = 'x-studio-csrf';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function createToken() {
  return randomBytes(32).toString('base64url');
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  const cookies = new Map();

  String(header || '')
    .split(';')
    .forEach((part) => {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex < 1) {
        return;
      }

      cookies.set(
        part.slice(0, separatorIndex).trim(),
        decodeURIComponent(part.slice(separatorIndex + 1).trim()),
      );
    });

  return cookies;
}

function hostnameOf(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    return null;
  }

  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname;
  } catch {
    return null;
  }
}

export function isLoopbackHost(host) {
  const hostname = hostnameOf(host);
  return hostname != null && LOOPBACK_HOSTNAMES.has(hostname);
}

export function createSecurityContext({ allowNetworkListen = false } = {}) {
  return {
    launchToken: createToken(),
    csrfToken: createToken(),
    sessionToken: createToken(),
    allowNetworkListen,
  };
}

export function launchUrl(security, host, port) {
  return `http://${host}:${port}/#token=${security.launchToken}`;
}

function unauthorized(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function sessionCookieValue(security) {
  return [
    `${SESSION_COOKIE}=${security.sessionToken}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=86400',
  ].join('; ');
}

export function handleSessionExchange(security, request, response, url) {
  const provided = url.searchParams.get('token');

  if (!constantTimeEquals(provided, security.launchToken)) {
    throw unauthorized('Invalid launch token.');
  }

  response.setHeader('Set-Cookie', sessionCookieValue(security));
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify({ csrfToken: security.csrfToken })}\n`);
}

function assertTrustedOrigin(security, request, expectedHost) {
  const origin = request.headers.origin;

  if (origin === undefined) {
    return;
  }

  if (origin === 'null') {
    throw forbidden('Opaque origin is not allowed.');
  }

  const originHostname = hostnameOf(origin);
  const hostHostname = hostnameOf(request.headers.host);

  if (!originHostname || originHostname !== hostHostname) {
    throw forbidden('Cross-origin request rejected.');
  }

  if (!security.allowNetworkListen && !LOOPBACK_HOSTNAMES.has(originHostname)) {
    throw forbidden('Non-loopback origin rejected.');
  }
}

function assertTrustedHost(security, request) {
  if (security.allowNetworkListen) {
    return;
  }

  if (!isLoopbackHost(request.headers.host)) {
    throw forbidden('Non-loopback Host header rejected.');
  }
}

export function authenticate(security, request, { mutating }) {
  assertTrustedHost(security, request);
  assertTrustedOrigin(security, request);

  const cookies = parseCookies(request.headers.cookie);

  if (!constantTimeEquals(cookies.get(SESSION_COOKIE), security.sessionToken)) {
    throw unauthorized('Missing or invalid Studio session.');
  }

  if (!mutating) {
    return;
  }

  if (!constantTimeEquals(request.headers[CSRF_HEADER], security.csrfToken)) {
    throw forbidden('Missing or invalid CSRF token.');
  }

  const contentType = String(request.headers['content-type'] || '');

  if (!contentType.startsWith('application/json')) {
    throw forbidden('Mutating requests must use application/json.');
  }
}

export async function readLimitedBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;

    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}
