// agh-lite-plugin — 价格表与费用估算（美元 / 每百万 tokens）

export const DEFAULT_PRICES = {
  'deepseek-v4.1-flash': { input: 0.28, cacheRead: 0.028, output: 0.42 },
  'deepseek-v4-flash': { input: 0.28, cacheRead: 0.028, output: 0.42 },
  'deepseek-v4': { input: 0.55, cacheRead: 0.055, output: 1.7 },
  'deepseek-v3': { input: 0.28, cacheRead: 0.028, output: 0.42 },
  'deepseek-chat': { input: 0.28, cacheRead: 0.028, output: 0.42 },
  'deepseek-reasoner': { input: 0.55, cacheRead: 0.14, output: 2.2 },
  'deepseek-flash': { input: 0.28, cacheRead: 0.028, output: 0.42 },
  'gpt-4o-mini': { input: 0.15, cacheRead: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cacheRead: 1.25, output: 10 },
  'o4-mini': { input: 1.1, cacheRead: 0.275, output: 4.4 },
  'claude-sonnet': { input: 3, cacheRead: 0.3, output: 15 },
};

export function normalizeModel(model) {
  return String(model || '')
    .toLowerCase()
    .replace(/^[^/]+\//, '')
    .trim();
}

export function lookupPrice(model, prices = DEFAULT_PRICES) {
  const key = normalizeModel(model);
  if (!key) return undefined;
  if (prices[key]) return prices[key];
  const match = Object.keys(prices)
    .sort((a, b) => b.length - a.length)
    .find((name) => key.includes(name));
  return match ? prices[match] : undefined;
}

export function sessionCost(record, prices = DEFAULT_PRICES) {
  const price = lookupPrice(record.model, prices);
  if (!price) return { usd: 0, priced: false };
  const inputTokens = Math.max(0, record.promptTokens - record.cacheReadTokens);
  const usd =
    (inputTokens * price.input +
      record.cacheReadTokens * price.cacheRead +
      record.outputTokens * price.output) /
    1_000_000;
  return { usd, priced: true };
}

export function formatUsd(value) {
  if (value === undefined || value === null) return '未配置';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
