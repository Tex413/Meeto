'use strict';

// LM Studio backend. With it selected, meeting data may only go to the configured server, and only
// when that server is on this machine or the customer's network. There is no cloud fallback.

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const LOCAL_PROVIDER = 'lmstudio';
const PROVIDERS = new Set(['openai', 'anthropic', LOCAL_PROVIDER]);
const DEFAULT_URL = 'http://localhost:1234/v1';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// Loopback, RFC 1918, link-local, carrier-grade NAT (used by mesh VPNs) and IPv6 unique-local.
const PRIVATE_NETWORKS = new net.BlockList();
for (const [address, prefix] of [
  ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16], ['100.64.0.0', 10],
]) PRIVATE_NETWORKS.addSubnet(address, prefix, 'ipv4');
PRIVATE_NETWORKS.addAddress('::1', 'ipv6');
PRIVATE_NETWORKS.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_NETWORKS.addSubnet('fe80::', 10, 'ipv6');

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

// Reads NAME=value from .env text. Anchored to the line, so a commented or empty entry stays unset.
function envFileValue(content, name) {
  const match = content.match(new RegExp(`^[ \\t]*${name}[ \\t]*=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  return family !== 0 && PRIVATE_NETWORKS.check(address, `ipv${family}`);
}

function outsideNetworkError() {
  return httpError(502, 'LM Studio address is not on this machine or your network, so nothing was sent. '
    + 'Check LMSTUDIO_URL.');
}

// Checks the addresses the connection will actually use, so a name cannot resolve differently after the check.
function privateOnlyLookup(lookup) {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!addresses.length || !addresses.every(entry => isPrivateAddress(entry.address))) {
        return callback(outsideNetworkError());
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function parseBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { url = null; } // reported by the check below
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search) {
    throw httpError(500, 'LM Studio is not configured: LMSTUDIO_URL must be an http or https address, '
      + 'such as http://localhost:1234/v1.');
  }
  return url;
}

function postJson(url, payload, { timeoutMs, lookup }) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // Node skips `lookup` for a literal address, so that case is checked here.
    if (net.isIP(host) && !isPrivateAddress(host)) return reject(outsideNetworkError());
    const transport = url.protocol === 'https:' ? https : http;
    let timer = null;
    const fail = error => {
      clearTimeout(timer);
      if (error.statusCode) return reject(error);
      return reject(httpError(502, `LM Studio could not be reached (${error.code || error.message}). `
        + 'Check that its server is running and LMSTUDIO_URL is correct.'));
    };
    const request = transport.request(url, {
      method: 'POST',
      agent: false,
      lookup: privateOnlyLookup(lookup),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) request.destroy(httpError(502, 'LM Studio response was too large.'));
        else chunks.push(chunk);
      });
      response.on('error', fail);
      response.on('end', () => {
        clearTimeout(timer);
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    timer = setTimeout(() => {
      request.destroy(httpError(504, `LM Studio did not answer within ${Math.round(timeoutMs / 1000)} s.`));
    }, timeoutMs);
    request.on('error', fail);
    return request.end(payload);
  });
}

function parseReply(status, body) {
  let reply = null;
  try { reply = JSON.parse(body); } catch (_) { /* reported below with the HTTP status */ }
  if (status !== 200 || !reply || reply.error) {
    const detail = reply?.error?.message || reply?.error || `HTTP ${status}`;
    throw httpError(502, `LM Studio error: ${String(detail).slice(0, 300)}`);
  }
  return reply;
}

/**
 * readSetting(name) returns the configured value or ''. complete() takes the app's Anthropic-style
 * request and returns an Anthropic-style response, or throws an Error with statusCode.
 */
function createLmStudioBackend({ readSetting, lookup = dns.lookup }) {
  const model = () => (readSetting('LMSTUDIO_MODEL') || '').trim();

  async function complete({ system, messages, max_tokens: maxTokens = 1024, tools } = {}) {
    if (tools) throw httpError(403, 'Cloud web research is blocked while the LM Studio backend is selected.');
    if (!Array.isArray(messages) || !messages.length) throw httpError(400, 'messages is required');
    const modelName = model();
    if (!modelName) {
      throw httpError(500, 'LM Studio is not configured: set LMSTUDIO_MODEL to the model loaded in LM Studio.');
    }
    const base = parseBaseUrl((readSetting('LMSTUDIO_URL') || '').trim() || DEFAULT_URL);
    const url = new URL(`${base.href.replace(/\/+$/, '')}/chat/completions`);
    const timeoutMs = Number(readSetting('LMSTUDIO_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS;
    const reasoningEffort = (readSetting('LMSTUDIO_REASONING_EFFORT') || '').trim();
    const payload = JSON.stringify({
      model: modelName,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    });
    const { status, body } = await postJson(url, payload, { timeoutMs, lookup });
    const reply = parseReply(status, body);
    const choice = reply.choices?.[0];
    const text = (choice?.message?.content || '').replace(/^\s*<think>[\s\S]*?<\/think>/, '').trim();
    if (!text) {
      throw httpError(502, `LM Studio returned no answer text (finish reason: ${choice?.finish_reason || 'unknown'}). `
        + 'A reasoning model can use the whole token limit thinking: set LMSTUDIO_REASONING_EFFORT=none.');
    }
    return {
      id: reply.id || LOCAL_PROVIDER,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: reply.model || modelName,
      usage: {
        input_tokens: reply.usage?.prompt_tokens || 0,
        output_tokens: reply.usage?.completion_tokens || 0,
      },
    };
  }

  return { complete, model };
}

module.exports = { createLmStudioBackend, envFileValue, isPrivateAddress, LOCAL_PROVIDER, PROVIDERS };
