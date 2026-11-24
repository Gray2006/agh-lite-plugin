import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { auditHome } from '../lib/audit.js';
import { loadSession } from '../lib/sessions.js';

function event(type, data, time = 0) {
  return { type, time, data };
}

function buildEvents({ bigToolResult = 40000, duplicate = true } = {}) {
  const events = [
    event('session', { id: 'sess-1', cwd: 'G:\\work' }),
    event('request/header', {
      header: {
        config: { provider: 'deepseek', model: 'deepseek-v4' },
        tools: [{ name: 'read' }, { name: 'shell' }],
      },
    }),
    event('system/message', { message: { role: 'system', content: '你是助手。'.repeat(100) } }),
    event('turn/start', { turn: 1 }),
  ];
  for (let step = 1; step <= 3; step += 1) {
    events.push(
      event('assistant/message', {
        turn: 1,
        step,
        usage: { inputTokens: 40000, cacheReadTokens: 10000, outputTokens: 100, totalTokens: 50100 },
        message: { content: [{ type: 'text', text: 'ok' }] },
      }),
    );
  }
  events.push(event('tool/call', { callId: 'c1', name: 'read', arguments: '{"file_path":"a.py"}' }));
  events.push(
    event('tool/result', {
      message: { toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(bigToolResult) }] },
    }),
  );
  if (duplicate) {
    events.push(event('tool/call', { callId: 'c2', name: 'read', arguments: '{"file_path":"a.py"}' }));
    events.push(
      event('tool/result', {
        message: { toolCallId: 'c2', content: [{ type: 'text', text: 'x'.repeat(bigToolResult) }] },
      }),
    );
  }
  return events;
}

function writeSession(dir, events, { zstd = false } = {}) {
  const base = path.join(dir, 'sessions', 'ws', 'sess-1');
  fs.mkdirSync(base, { recursive: true });
  const payload = `${events.map((item) => JSON.stringify(item)).join('\n')}\n`;
  const target = path.join(base, zstd ? 'session.v4.jsonl.zstd' : 'session.v4.jsonl');
  fs.writeFileSync(target, zstd ? zlib.zstdCompressSync(Buffer.from(payload, 'utf8')) : payload);
  return target;
}

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agh-lite-plugin-'));
}

test('parses plain session and aggregates usage', () => {
  const home = tempHome();
  const file = writeSession(home, buildEvents());
  const record = loadSession(file);
  assert.equal(record.totalTokens, 150300);
  assert.equal(record.promptTokens, 150000);
  assert.equal(record.steps, 3);
  assert.equal(record.toolNames.length, 2);
  assert.ok(record.toolResultTokens > 0);
});

test('parses zstd session', () => {
  const home = tempHome();
  const file = writeSession(home, buildEvents(), { zstd: true });
  const record = loadSession(file);
  assert.equal(record.totalTokens, 150300);
});

test('audit finds duplicate and oversized waste', () => {
  const home = tempHome();
  writeSession(home, buildEvents());
  const result = auditHome(home, { days: 0 });
  assert.equal(result.totals.sessions, 1);
  assert.ok(result.totals.totalTokens > 0);
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(codes.includes('duplicate_tool_calls'));
  assert.ok(codes.includes('oversized_tool_outputs'));
  assert.ok(result.potentialSavings > 0);
});

test('no duplicate when only one call', () => {
  const home = tempHome();
  writeSession(home, buildEvents({ duplicate: false }));
  const result = auditHome(home, { days: 0 });
  assert.ok(!result.findings.some((finding) => finding.code === 'duplicate_tool_calls'));
});
