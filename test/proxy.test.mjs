import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createProxy, trimMessages } from '../lib/proxy.js';

function startUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function base(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test('trim only older long tool results', () => {
  const messages = [
    { role: 'system', content: 'rules' },
    { role: 'tool', content: 'x'.repeat(10000) },
    { role: 'user', content: 'q' },
    { role: 'tool', content: 'x'.repeat(10000) },
  ];
  const stats = trimMessages(messages, { maxToolChars: 1000, keepRecent: 2 });
  assert.equal(stats.trimmed, 1);
  assert.ok(messages[1].content.includes('已裁剪'));
  assert.equal(messages[3].content.length, 10000);
});

test('proxy trims, caches and streams', async () => {
  const calls = [];
  const upstream = await startUpstream(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls.push(body);
    if (body.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: one\n\n');
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }
    const payload = {
      id: 'x',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    };
    const data = Buffer.from(JSON.stringify(payload));
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(data.length) });
    response.end(data);
  });
  const proxy = createProxy({ upstream: base(upstream), port: 0, maxToolChars: 1000, keepRecent: 2, ledger: false });
  const proxyPort = await proxy.start();
  const endpoint = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;
  const body = {
    model: 'm',
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'tool', content: 'z'.repeat(8000) },
      { role: 'user', content: 'q' },
      { role: 'tool', content: 'recent' },
    ],
  };
  const first = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const firstJson = await first.json();
  assert.equal(firstJson.choices[0].message.content, 'ok');
  assert.ok(calls[0].messages[1].content.includes('已裁剪'));
  assert.equal(calls[0].messages[3].content, 'recent');

  const second = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await second.json();
  assert.equal(calls.length, 1, 'second request should hit cache');
  assert.equal(proxy.stats.cacheHits, 1);

  const streamResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  });
  const streamText = await streamResponse.text();
  assert.ok(streamText.includes('data: one'));
  assert.equal(calls.length, 2, 'streaming requests are not cached');

  await proxy.stop();
  await new Promise((resolve) => upstream.close(resolve));
});

test('health endpoint reports stats', async () => {
  const upstream = await startUpstream((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const proxy = createProxy({ upstream: base(upstream), port: 0, ledger: false });
  const proxyPort = await proxy.start();
  const health = await fetch(`http://127.0.0.1:${proxyPort}/agh-lite-plugin/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.requests, 0);
  await proxy.stop();
  await new Promise((resolve) => upstream.close(resolve));
});
