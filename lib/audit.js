// dsh-token-guard — 离线审计规则（和 agh-lite 的口径对齐）

import { findSessionFiles, loadSession, resolveDshHome } from './sessions.js';

export const OVERSIZED_RESULT_TOKENS = 8000;
export const STATIC_PREFIX_TOKENS = 12000;
export const CACHE_PROMPT_FLOOR = 50000;

export function formatTokens(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

export function auditRecords(records) {
  const totals = {
    sessions: records.length,
    turns: 0,
    steps: 0,
    totalTokens: 0,
    promptTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    toolResultTokens: 0,
    systemTokens: 0,
    schemaTokens: 0,
    errors: 0,
  };
  for (const record of records) {
    totals.turns += record.turns;
    totals.steps += record.steps;
    totals.totalTokens += record.totalTokens;
    totals.promptTokens += record.promptTokens;
    totals.cacheReadTokens += record.cacheReadTokens;
    totals.outputTokens += record.outputTokens;
    totals.toolResultTokens += record.toolResultTokens;
    totals.systemTokens = Math.max(totals.systemTokens, record.systemTokens);
    totals.schemaTokens = Math.max(totals.schemaTokens, record.schemaTokens);
    totals.errors += record.errorResults;
  }
  totals.cacheRatio = totals.promptTokens > 0 ? totals.cacheReadTokens / totals.promptTokens : 0;
  totals.avgPrompt = totals.steps > 0 ? totals.promptTokens / totals.steps : 0;

  const findings = [];

  const duplicateTokens = records.reduce(
    (sum, record) => sum + record.duplicateCalls.reduce((s, item) => s + item.extraTokens, 0),
    0,
  );
  if (duplicateTokens > 0) {
    findings.push({
      code: 'duplicate_tool_calls',
      severity: 'high',
      title: '同一工具调用被重复执行',
      detail: `有 ${formatTokens(duplicateTokens)} tokens 来自重复的工具结果。`,
      recommendation: '先查记忆/索引再读文件；重复结果写进缓存或记忆。',
      estimatedTokens: duplicateTokens,
    });
  }

  const oversized = [];
  for (const record of records) {
    for (const [callId, result] of record.results) {
      if (result.tokens > OVERSIZED_RESULT_TOKENS) {
        oversized.push({ callId, tokens: result.tokens, session: record.id });
      }
    }
  }
  if (oversized.length > 0) {
    const excess = oversized.reduce(
      (sum, item) => sum + (item.tokens - OVERSIZED_RESULT_TOKENS),
      0,
    );
    findings.push({
      code: 'oversized_tool_outputs',
      severity: 'high',
      title: '工具一次倒进来太多内容',
      detail: `${oversized.length} 条结果超过 ${formatTokens(OVERSIZED_RESULT_TOKENS)} tokens，超出部分合计 ${formatTokens(excess)}。`,
      recommendation: '读文件先 grep 定位再读区间；shell 输出加 head/limit；完整结果落盘，只带结论进上下文。',
      estimatedTokens: Math.round(excess * 0.6),
    });
  }

  const lowCache = records.filter(
    (record) => record.promptTokens >= CACHE_PROMPT_FLOOR && record.cacheRatio < 0.4,
  );
  if (lowCache.length > 0) {
    const prompt = lowCache.reduce((sum, record) => sum + record.promptTokens, 0);
    findings.push({
      code: 'low_prefix_cache',
      severity: 'medium',
      title: 'prompt 前缀缓存命中偏低',
      detail: `${lowCache.length} 个会话 prompt 超过 ${formatTokens(CACHE_PROMPT_FLOOR)}，命中率低于 40%，合计 ${formatTokens(prompt)} prompt tokens。`,
      recommendation: '稳定内容放最前；同一任务别频繁换模型/会话；别在 system 里塞时间戳。',
      estimatedTokens: Math.round(prompt * 0.1),
    });
  }

  const staticTokens = totals.systemTokens + totals.schemaTokens;
  if (staticTokens >= STATIC_PREFIX_TOKENS && totals.steps > 0) {
    findings.push({
      code: 'static_prefix_bloat',
      severity: 'medium',
      title: '每次请求都带着很大的工具集与系统提示',
      detail: `单次请求静态前缀约 ${formatTokens(staticTokens)} tokens（system ${formatTokens(totals.systemTokens)} + 工具 ${formatTokens(totals.schemaTokens)}）。`,
      recommendation: '个人版只留当前任务需要的工具；AGENTS.md 只放「到哪都成立」的约定。',
      estimatedTokens: Math.round(staticTokens * totals.steps * 0.15),
    });
  }

  const bloated = records.filter((record) => record.steps > 0 && record.promptTokens / record.steps >= 120000);
  if (bloated.length > 0) {
    const prompt = bloated.reduce((sum, record) => sum + record.promptTokens, 0);
    findings.push({
      code: 'context_bloat',
      severity: 'high',
      title: '上下文膨胀，每步都在为历史重付费',
      detail: `${bloated.length} 个会话平均每步 prompt 超过 120K，合计 ${formatTokens(prompt)} prompt tokens。`,
      recommendation: '到阶段边界就压缩；工具输出提炼成结论；已完成阶段落盘。',
      estimatedTokens: Math.round(prompt * 0.1),
    });
  }

  findings.sort((a, b) => b.estimatedTokens - a.estimatedTokens);
  const gross = findings.reduce((sum, finding) => sum + finding.estimatedTokens, 0);
  const potentialSavings = Math.min(gross, Math.round(totals.totalTokens * 0.25));
  return { totals, findings, potentialSavings };
}

export function auditHome(home, { days } = {}) {
  const resolved = resolveDshHome(home);
  const sinceMs = days ? Date.now() - days * 86400000 : undefined;
  const files = findSessionFiles(resolved, { sinceMs });
  const records = files.map((entry) => loadSession(entry.path));
  return { home: resolved, files: files.length, ...auditRecords(records), records };
}

export function renderReport(result) {
  const { totals, findings, potentialSavings } = result;
  const lines = [
    `## DSH Token 审计`,
    '',
    `- 数据目录：${result.home}`,
    `- 会话：${totals.sessions} 个，${totals.turns} 轮，${totals.steps} 步`,
    `- 总量：**${formatTokens(totals.totalTokens)} tokens**（prompt ${formatTokens(totals.promptTokens)} / output ${formatTokens(totals.outputTokens)}）`,
    `- 前缀缓存命中：${(totals.cacheRatio * 100).toFixed(0)}%`,
    `- 估算可省：**${formatTokens(potentialSavings)} tokens**`,
    '',
  ];
  if (findings.length === 0) {
    lines.push('没有发现明显的结构性浪费。');
    return lines.join('\n');
  }
  lines.push('### 最该先动的事', '');
  findings.slice(0, 5).forEach((finding, index) => {
    lines.push(`${index + 1}. **${finding.title}**（约 ${formatTokens(finding.estimatedTokens)} tokens）`);
    lines.push(`   ${finding.detail}`);
    lines.push(`   怎么做：${finding.recommendation}`, '');
  });
  lines.push('> 估算口径与 agh-lite 一致；数字是上限，不是账单。');
  return lines.join('\n');
}
