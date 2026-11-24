// agh-lite-plugin — DSH 宿主插件
//
// 工具：token_audit（审计）、token_proxy（本地代理开关）
// 面板：/agh-lite-plugin/* HTTP 路由 + 侧边栏 tab

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { auditHome, renderReport } from './audit.js';
import { createProxy } from './proxy.js';

export const name = 'agh-lite-plugin';
export const inject = ['tools'];

const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
};

let proxyHandle = null;

function proxyStatus() {
  if (!proxyHandle) return { running: false, port: null, stats: null };
  return { running: true, port: proxyHandle.port, stats: proxyHandle.proxy.stats };
}

async function startProxy(config, upstream, port) {
  if (proxyHandle) return proxyStatus();
  const target = String(upstream || config.upstream || '').trim();
  if (!target) throw new Error('先配置 upstream');
  const proxy = createProxy({
    upstream: target,
    port: Number(port || config.proxyPort || 8787),
    maxToolChars: Number(config.maxToolChars || 4000),
    keepRecent: Number(config.keepRecent || 8),
    ledger: config.ledger !== false,
  });
  const actualPort = await proxy.start();
  proxyHandle = { proxy, port: actualPort };
  return proxyStatus();
}

async function stopProxy() {
  if (!proxyHandle) return proxyStatus();
  await proxyHandle.proxy.stop();
  proxyHandle = null;
  return proxyStatus();
}

function auditSummary(days) {
  const result = auditHome(undefined, { days: days > 0 ? days : undefined });
  return { ok: true, text: renderReport(result), totals: result.totals };
}

function writeOptimizePack(result, days) {
  const date = new Date().toISOString().slice(0, 10);
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dir = path.join(home, 'agh-lite-optimize');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `optimize-${date.replace(/-/g, '')}.md`);
  const lines = [
    `# Token 优化包（${date}）`,
    '',
    renderReport(result),
    '',
    '## 从没调用过的工具（完整）',
    '',
    result.totals.unusedTools.length > 0
      ? result.totals.unusedTools.map((name) => `- ${name}`).join('\n')
      : '无',
    '',
    '## AGENTS.md 精简建议',
    '',
    '- 只保留「到哪都成立」的约定：身份、语气、边界',
    '- 项目专属规则拆到各工作区 memory/，按需读',
    '- 删掉重复、过期、只在某次任务里成立的条目',
    '',
    '## 代理',
    '',
    '1. 面板代理区填上游地址，点「启动代理」',
    '2. 把 DSH provider 的 baseUrl 指到 http://127.0.0.1:8787/v1',
    '3. 一周后再审计一次，对比可省数字',
    '',
  ];
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

export function apply(ctx, config = {}) {
  const tools = (typeof ctx.get === 'function' ? ctx.get('tools') : undefined) ?? ctx.tools;
  if (tools && typeof tools.register === 'function') {
    tools.register({
      name: 'token_audit',
      description:
        '扫描本机 DSH 会话，统计 token 与费用结构，找出重复调用、超大工具结果、缓存命中低、上下文膨胀，并给出可省上限。只读，不调用模型，不花 token。',
      output: TEXT_OUTPUT,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          days: { type: 'number', description: '只看最近 N 天；省略则用插件配置（默认 30）' },
        },
      },
      async execute(args) {
        const days = Number(args?.days ?? config.days ?? 30);
        try {
          return { text: auditSummary(days).text };
        } catch (error) {
          return { text: `审计失败：${error?.message ?? error}` };
        }
      },
    });

    tools.register({
      name: 'token_proxy',
      description:
        '本地 OpenAI 兼容代理：自动裁剪较早的超长工具结果、缓存重复请求。action=start 需要 upstream；action=stop 关闭；action=stats 看状态。',
      output: TEXT_OUTPUT,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'stats'] },
          upstream: { type: 'string', description: '上游地址，如 https://api.deepseek.com' },
          port: { type: 'number', description: '本地端口，默认 8787' },
        },
      },
      async execute(args) {
        const action = String(args?.action ?? 'stats');
        try {
          if (action === 'start') {
            const status = await startProxy(config, args?.upstream, args?.port);
            const stats = status.stats ?? {};
            return {
              text: `代理已启动：http://127.0.0.1:${status.port}/v1\n把 DSH 的 provider baseUrl 指到这个地址。\n请求 ${stats.requests ?? 0}，缓存命中 ${stats.cacheHits ?? 0}。`,
            };
          }
          if (action === 'stop') {
            await stopProxy();
            return { text: '代理已停止。' };
          }
          const status = proxyStatus();
          if (!status.running) return { text: '代理未启动。用 action=start 并传 upstream。' };
          const stats = status.stats ?? {};
          return {
            text: `代理运行中：http://127.0.0.1:${status.port}/v1\n请求 ${stats.requests ?? 0}，缓存命中 ${stats.cacheHits ?? 0}，裁剪 ${stats.trimmedRequests ?? 0} 次（${stats.charsRemoved ?? 0} 字符）。`,
          };
        } catch (error) {
          return { text: `代理操作失败：${error?.message ?? error}` };
        }
      },
    });
  }

  // 面板用的 HTTP 路由；没有 webServer 就只留工具
  try {
    ctx.inject(['webServer'], (scoped) => {
      const webServer =
        scoped.webServer ?? (typeof scoped.get === 'function' ? scoped.get('webServer') : undefined);
      if (!webServer || typeof webServer.register !== 'function') return;
      const sendJson = (response, status, payload) => {
        const data = Buffer.from(JSON.stringify(payload), 'utf8');
        response.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(data.length),
        });
        response.end(data);
      };
      const readBody = async (request) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      };

      const effect = typeof scoped.effect === 'function' ? scoped.effect : ctx.effect;
      effect(() =>
        webServer.register({
          kind: 'exact',
          path: '/agh-lite-plugin/audit',
          handler: async (request, response) => {
            const url = new URL(request.url, 'http://local');
            const days = Number(url.searchParams.get('days') ?? config.days ?? 30);
            try {
              sendJson(response, 200, auditSummary(days));
            } catch (error) {
              sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),
      );
      effect(() =>
        webServer.register({
          kind: 'exact',
          path: '/agh-lite-plugin/optimize',
          handler: async (request, response) => {
            try {
              const body = request.method === 'POST' ? await readBody(request) : {};
              const days = Number(body.days ?? config.days ?? 30);
              const result = auditHome(undefined, { days: days > 0 ? days : undefined });
              const file = writeOptimizePack(result, days);
              sendJson(response, 200, { ok: true, path: file, text: renderReport(result) });
            } catch (error) {
              sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),
      );
      effect(() =>
        webServer.register({
          kind: 'exact',
          path: '/agh-lite-plugin/proxy',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                sendJson(response, 200, { ok: true, ...proxyStatus() });
                return;
              }
              const body = await readBody(request);
              if (body.action === 'start') {
                const status = await startProxy(config, body.upstream, body.port);
                sendJson(response, 200, { ok: true, ...status });
              } else if (body.action === 'stop') {
                sendJson(response, 200, { ok: true, ...(await stopProxy()) });
              } else {
                sendJson(response, 200, { ok: true, ...proxyStatus() });
              }
            } catch (error) {
              sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),
      );
    });
  } catch {
    // 没有 webServer 不影响工具
  }
  return undefined;
}
