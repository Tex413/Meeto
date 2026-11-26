'use strict';

const crypto = require('node:crypto');

// A loopback socket alone proves nothing behind a same-host proxy: every outside request arrives from 127.0.0.1.
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROXY_HEADERS = [
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'via', 'cf-connecting-ip',
];
const LOOPBACK_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function isLoopbackUrl(value) {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).hostname);
  } catch (_) {
    return false; // an address we cannot read is treated as public
  }
}

// True only for a request that shows no sign of having come from anywhere but this machine.
function isDirectLocalRequest(req) {
  const { headers } = req;
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress || '')) return false;
  if (PROXY_HEADERS.some(name => headers[name] !== undefined)) return false;
  // Also stops DNS rebinding, where a web page's own host name resolves to 127.0.0.1.
  if (!LOOPBACK_HOST_HEADER.test(headers.host || '')) return false;
  // Stream Deck and MCP send no Origin; a browser sends one on a cross-origin request.
  if (headers.origin !== undefined && !isLoopbackUrl(headers.origin)) return false;
  return headers['sec-fetch-site'] !== 'cross-site';
}

function bearerMatches(header, token) {
  const match = /^Bearer (.+)$/.exec(header || '');
  if (!match) return false;
  // Hashing gives timingSafeEqual the equal lengths it requires.
  const digest = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(match[1]), digest(token));
}

// Line-anchored and same-line only, so a commented-out or empty setting never picks up other text.
function envFileValue(text, name) {
  const match = new RegExp(`^[ \\t]*${name}[ \\t]*=(.*)$`, 'm').exec(text);
  return match ? match[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
}

// The process environment wins; DATA_DIR/.env fills in what it leaves unset.
function resolveLocalControlSettings({ env, envFileText = '', desktopMode = false }) {
  const setting = name => (env[name] || envFileValue(envFileText, name)).trim();
  return {
    publicUrl: setting('PUBLIC_URL') || setting('APP_URL') || 'http://localhost',
    token: setting('LOCAL_CONTROL_TOKEN'),
    tokenlessAllowed: desktopMode || setting('LOCAL_CONTROL_ALLOW_TOKENLESS') === '1',
  };
}

// Fails closed: no setting can show that no proxy is in front, so running without a token has to be chosen.
function createLocalControlGuard({ publicUrl, token = '', tokenlessAllowed = false }) {
  const isPublicDeployment = !isLoopbackUrl(publicUrl);

  // Returns null when a start/stop command may run, otherwise the refusal to send.
  function refuseCommand(req) {
    if (!isDirectLocalRequest(req)) return { status: 403, error: 'forbidden' };
    if (token) return bearerMatches(req.headers.authorization, token) ? null : { status: 401, error: 'unauthorized' };
    return tokenlessAllowed && !isPublicDeployment ? null : { status: 403, error: 'local_control_token_required' };
  }

  function startupNotice() {
    if (token) return null;
    if (isPublicDeployment) {
      return 'Local recording start/stop is disabled: PUBLIC_URL is not a loopback address and '
        + 'LOCAL_CONTROL_TOKEN is not set.';
    }
    if (!tokenlessAllowed) {
      return 'Local recording start/stop is disabled: set LOCAL_CONTROL_TOKEN, or, only if no proxy or tunnel '
        + 'forwards to this server, LOCAL_CONTROL_ALLOW_TOKENLESS=1.';
    }
    return 'WARNING: local recording start/stop is running without LOCAL_CONTROL_TOKEN. Never put a proxy or '
      + 'tunnel in front of this server without setting it.';
  }

  return { isDirectLocalRequest, refuseCommand, startupNotice };
}

module.exports = { createLocalControlGuard, resolveLocalControlSettings };
