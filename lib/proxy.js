// dsh-token-guard — 本地 OpenAI 兼容代理（零依赖）
//
// 和 agh-lite 的 proxy.py 同一套逻辑：裁剪较早的 tool 长结果 + 非流式缓存。
// 只监听 127.0.0.1，不是 MITM；用户把 DSH provider 的 baseUrl 指过来才生效。

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const TRIM_MARKER = (chars) => `\n…[dsh-token-guard 已裁剪 ${chars} 字符]…\n`;

export function trimMessages(messages, { maxToolChars = 4000, keepRecent = 8 } = {}) {
  let trimmed = 0;
  let charsRemoved = 0;
  const cutoff = Math.max(0, messages.length - keepRecent);
  for (let index = 0; index < cutoff; index += 1) {
    const message = messages[index];
    if (!message || message.role !== 'tool') continue;
    if (typeof message.content === 'string') {
      const result = trimText(message.content, maxToolChars);
      if (result.removed > 0) {
        message.content = result.text;
        trimmed += 1;
        charsRemoved += result.removed;
      }
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
        const result = trimText(block.text, maxToolChars);
        if (result.removed > 0) {
          block.text = result.text;
          trimmed += 1;
          charsRemoved += result.removed;
        }
      }
    }
  }
  return { trimmed, charsRemoved };
}

function trimText(text, limit) {
  if (text.length <= limit) return { text, removed: 0 };
  const head = Math.floor(limit / 2);
  const tail = limit - head;
  const removed = text.length - limit;
  return { text: text.slice(0, head) + TRIM_MARKER(removed) + text.slice(-tail), removed };
}

function usageTokens(payload) {
  const usage = payload && typeof payload === 'object' ? payload.usage : undefined;
  if (!usage || typeof usage !== 'object') return [0, 0];
  const prompt = Number(usage.prompt_tokens ?? usage.inputTokens ?? 0) || 0;
  const completion = Number(usage.completion_tokens ?? usage.outputTokens ?? 0) || 0;
  return [prompt, completion];
}

function ledgerPath() {
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'agh-lite-proxy.jsonl');
}

function appendLedger(entry) {
  try {
    const target = ledgerPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // 账本写不了不影响代理
  }
}

export function createProxy({ upstream, port = 8787, maxToolChars = 4000, keepRecent = 8, cache = true, ledger = true } = {}) {
  if (typeof upstream !== 'string' || !/^https?:\/\//.test(upstream)) {
    throw new Error('upstream 必须是 http(s) 地址');
  }
  const cacheStore = new Map();
  const stats = { requests: 0, cacheHits: 0, trimmedRequests: 0, charsRemoved: 0 };
  const upstreamUrl = new URL(upstream);

  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/token-guard/health') {
      sendJson(response, 200, { ok: true, ...stats });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method not allowed' });
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      payload = undefined;
    }
    let trimStats = { trimmed: 0, charsRemoved: 0 };
    if (payload && Array.isArray(payload.messages)) {
      trimStats = trimMessages(payload.messages, { maxToolChars, keepRecent });
      if (trimStats.trimmed > 0) body = Buffer.from(JSON.stringify(payload), 'utf8');
    }
    const stream = Boolean(payload && payload.stream);
    const key = crypto.createHash('sha256').update(body).digest('hex');
    stats.requests += 1;
    if (trimStats.trimmed > 0) {
      stats.trimmedRequests += 1;
      stats.charsRemoved += trimStats.charsRemoved;
    }
    if (cache && !stream && cacheStore.has(key)) {
      const cached = cacheStore.get(key);
      stats.cacheHits += 1;
      const [prompt, completion] = usageTokens(cached);
      record({ model: payload?.model, cacheHit: true, trimStats, prompt, completion });
      sendJson(response, 200, cached);
      return;
    }

    const target = new URL(request.url, upstreamUrl);
    const headers = { ...request.headers, host: upstreamUrl.host };
    delete headers['content-length'];
    headers['content-length'] = String(body.length);
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(target, { method: 'POST', headers, body });
    } catch (error) {
      sendJson(response, 502, { error: `上游不可达：${error?.message ?? error}` });
      return;
    }
    const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
    if (stream || !contentType.includes('application/json')) {
      response.writeHead(upstreamResponse.status, { 'content-type': contentType, connection: 'close' });
      if (upstreamResponse.body) {
        for await (const chunk of upstreamResponse.body) response.write(chunk);
      }
      response.end();
      record({ model: payload?.model, cacheHit: false, trimStats, prompt: 0, completion: 0 });
      return;
    }
    const text = await upstreamResponse.text();
    if (cache && upstreamResponse.ok) {
      try {
        cacheStore.set(key, JSON.parse(text));
      } catch {
        // 不是 JSON 就不缓存
      }
    }
    const [prompt, completion] = usageTokens(safeJson(text));
    record({ model: payload?.model, cacheHit: false, trimStats, prompt, completion });
    response.writeHead(upstreamResponse.status, { 'content-type': contentType });
    response.end(text);
  });

  function record({ model, cacheHit, trimStats, prompt, completion }) {
    if (!ledger) return;
    appendLedger({
      ts: Date.now(),
      model: model ?? '',
      stream: false,
      cache_hit: cacheHit,
      trimmed_chars: trimStats.charsRemoved,
      trimmed_tokens: Math.round(trimStats.charsRemoved / 3.6),
      prompt_tokens: prompt,
      completion_tokens: completion,
      source: 'dsh-token-guard',
    });
  }

  return {
    server,
    stats,
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      return server.address().port;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sendJson(response, status, payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.length),
  });
  response.end(data);
}
