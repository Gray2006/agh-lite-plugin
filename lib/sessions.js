// agh-lite-plugin — DSH 会话解析（零依赖，Node 22+ 自带 zstd）
//
// 只读：找会话文件、解压、抽 usage 与工具调用，不做写操作。

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const SESSION_SUFFIXES = ['.jsonl', '.jsonl.zstd', '.jsonl.zst'];
const CHARS_PER_TOKEN = 3.6;

export function resolveDshHome(explicit) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  else {
    if (process.env.DSH_HOME) candidates.push(path.resolve(process.env.DSH_HOME));
    candidates.push(path.join(os.homedir(), '.dsh'));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'sessions'))) return candidate;
    if (path.basename(candidate) === 'sessions' && fs.existsSync(candidate)) return path.dirname(candidate);
  }
  throw new Error(`找不到 DSH 会话目录：${candidates.join('、')}`);
}

export function findSessionFiles(home, { sinceMs } = {}) {
  const root = path.join(home, 'sessions');
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SESSION_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
      try {
        const stat = fs.statSync(full);
        if (sinceMs !== undefined && stat.mtimeMs < sinceMs) continue;
        files.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // 读不到的文件直接跳过
      }
    }
  };
  walk(root);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

function readLines(file) {
  const raw = fs.readFileSync(file);
  const text = file.endsWith('.zstd') || file.endsWith('.zst')
    ? decodeZstd(raw).toString('utf8')
    : raw.toString('utf8');
  return text.split('\n');
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Node 的 zstd 解压只处理第一帧，而 DSH 会分很多帧写。
 * 按帧魔数切片，逐帧解压；魔数偶尔出现在压缩数据里，失败就往后找下一段。
 */
export function decodeZstd(buffer) {
  const positions = [];
  let index = buffer.indexOf(ZSTD_MAGIC);
  while (index !== -1) {
    positions.push(index);
    index = buffer.indexOf(ZSTD_MAGIC, index + 4);
  }
  if (positions.length <= 1) return zlib.zstdDecompressSync(buffer);
  positions.push(buffer.length);

  const chunks = [];
  let start = 0;
  while (start < positions.length - 1) {
    let end = start + 1;
    let ok = false;
    for (; end < positions.length; end += 1) {
      try {
        chunks.push(zlib.zstdDecompressSync(buffer.subarray(positions[start], positions[end])));
        ok = true;
        break;
      } catch {
        // 这段不是完整帧，继续找下一个边界
      }
    }
    if (!ok) break; // 尾部残帧，丢掉
    start = end;
  }
  return Buffer.concat(chunks);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === 'string' ? block : String(block?.text ?? '')))
      .join('\n');
  }
  return '';
}

export function loadSession(file) {
  const record = {
    file,
    id: '',
    cwd: '',
    model: '',
    turns: 0,
    steps: new Set(),
    promptTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    systemChars: 0,
    schemaChars: 0,
    toolNames: [],
    toolSchemaSizes: {},
    toolCallCounts: {},
    compressed: false,
    calls: [],
    results: {},
    toolResultChars: 0,
    errorResults: 0,
  };

  for (const line of readLines(file)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const type = event?.type;
    const data = event?.data ?? {};
    if (type === 'session') {
      record.id = String(data.id ?? record.id);
      record.cwd = String(data.cwd ?? record.cwd);
    } else if (type === 'request/header') {
      const header = data.header ?? {};
      const config = header.config ?? {};
      record.model = String(config.model ?? record.model);
      if (Array.isArray(header.tools)) {
        record.toolNames = header.tools
          .map((tool) => (typeof tool?.name === 'string' ? tool.name : ''))
          .filter(Boolean);
        record.schemaChars = Math.max(
          record.schemaChars,
          JSON.stringify(header.tools).length,
        );
        for (const tool of header.tools) {
          if (typeof tool?.name !== 'string') continue;
          const size = JSON.stringify(tool).length;
          record.toolSchemaSizes[tool.name] = Math.max(record.toolSchemaSizes[tool.name] ?? 0, size);
        }
      }
    } else if (type === 'system/message') {
      record.systemChars = Math.max(record.systemChars, textOf(data.message?.content).length);
    } else if (type === 'assistant/message') {
      const usage = data.usage ?? {};
      record.steps.add(`${data.turn ?? 0}:${data.step ?? 0}`);
      record.promptTokens += Number(usage.inputTokens ?? 0) + Number(usage.cacheReadTokens ?? 0);
      record.cacheReadTokens += Number(usage.cacheReadTokens ?? 0);
      record.outputTokens += Number(usage.outputTokens ?? 0);
      record.totalTokens += Number(
        usage.totalTokens ?? Number(usage.inputTokens ?? 0) + Number(usage.cacheReadTokens ?? 0) + Number(usage.outputTokens ?? 0),
      );
    } else if (type === 'tool/call') {
      const args = String(data.arguments ?? '');
      const name = String(data.name ?? '');
      record.calls.push({
        callId: String(data.callId ?? ''),
        name,
        argsKey: `${name}|${args}`,
      });
      record.toolCallCounts[name] = (record.toolCallCounts[name] ?? 0) + 1;
      if (name === 'compress') record.compressed = true;
    } else if (type === 'tool/result') {
      const message = data.message ?? {};
      const callId = String(message.toolCallId ?? data.toolCallId ?? '');
      const text = textOf(message.content);
      record.results[callId] = {
        chars: text.length,
        tokens: Math.max(1, Math.round(text.length / CHARS_PER_TOKEN)),
      };
      record.toolResultChars += text.length;
      if (data.error || message.isError) record.errorResults += 1;
    } else if (type === 'compaction/start') {
      record.compressed = true;
    } else if (type === 'turn/start' || type === 'turn/end') {
      record.turns = Math.max(record.turns, Number(data.turn ?? 0));
    }
  }

  record.steps = record.steps.size;
  if (!record.cwd) {
    const parts = file.split(path.sep);
    const sessionsIndex = parts.lastIndexOf('sessions');
    if (sessionsIndex >= 0 && parts.length > sessionsIndex + 2) {
      record.cwd = decodeWorkspace(parts[sessionsIndex + 1]);
    }
  }
  record.toolResultTokens = Math.round(record.toolResultChars / CHARS_PER_TOKEN);
  record.schemaTokens = Math.round(record.schemaChars / CHARS_PER_TOKEN);
  record.systemTokens = Math.round(record.systemChars / CHARS_PER_TOKEN);
  record.cacheRatio = record.promptTokens > 0 ? record.cacheReadTokens / record.promptTokens : 0;
  record.duplicateCalls = duplicateCalls(record);
  return record;
}

function decodeWorkspace(name) {
  return name.replace(/~([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/^-+|-+$/g, '') || name;
}

function duplicateCalls(record) {
  const groups = new Map();
  for (const call of record.calls) {
    const list = groups.get(call.argsKey) ?? [];
    list.push(call);
    groups.set(call.argsKey, list);
  }
  const out = [];
  for (const [argsKey, calls] of groups) {
    if (calls.length <= 1) continue;
    const extra = calls
      .slice(1)
      .reduce((sum, call) => sum + (record.results[call.callId]?.tokens ?? 0), 0);
    if (extra > 0) out.push({ argsKey, count: calls.length, extraTokens: extra });
  }
  out.sort((a, b) => b.extraTokens - a.extraTokens);
  return out;
}

const CACHE_VERSION = 3;

function cacheFile(file, cacheDir) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return undefined;
  }
  const key = crypto
    .createHash('sha256')
    .update(`${file}|${stat.mtimeMs}|${stat.size}|v${CACHE_VERSION}`)
    .digest('hex');
  return path.join(cacheDir, `${key}.json`);
}

export function loadSessionCached(file, cacheDir) {
  if (!cacheDir) return loadSession(file);
  const target = cacheFile(file, cacheDir);
  if (target && fs.existsSync(target)) {
    try {
      return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      // 缓存坏了就重新解析
    }
  }
  const record = loadSession(file);
  if (target) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(target, JSON.stringify(record), 'utf8');
    } catch {
      // 写不了缓存不影响结果
    }
  }
  return record;
}
