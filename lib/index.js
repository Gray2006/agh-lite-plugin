// dsh-token-guard — DSH 宿主插件
//
// 只注册一个工具：token_audit。用户不用记参数，直接说「审计一下 token」。
// 审计本身不调模型，不花 token；它只读本机会话文件。

import { auditHome, renderReport } from './audit.js';

export const name = 'dsh-token-guard';
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

export function apply(ctx, config = {}) {
  const tools = (typeof ctx.get === 'function' ? ctx.get('tools') : undefined) ?? ctx.tools;
  if (!tools || typeof tools.register !== 'function') return undefined;

  const dispose = tools.register({
    name: 'token_audit',
    description:
      '扫描本机 DSH 会话，统计 token 与费用结构，找出重复调用、超大工具结果、缓存命中低、上下文膨胀，并给出可省上限。只读，不调用模型，不花 token。',
    output: TEXT_OUTPUT,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: {
          type: 'number',
          description: '只看最近 N 天；省略则用插件配置里的天数（默认 30）',
        },
      },
    },
    async execute(args) {
      const days = Number(args?.days ?? config.days ?? 30);
      try {
        const result = auditHome(undefined, { days: days > 0 ? days : undefined });
        return { text: renderReport(result) };
      } catch (error) {
        return { text: `审计失败：${error?.message ?? error}\n\n用 /token-guard 检查 DSH 数据目录是否存在。` };
      }
    },
  });
  return dispose;
}
