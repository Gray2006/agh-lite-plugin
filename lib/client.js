// agh-lite-plugin — 侧边栏面板（浏览器端 bundle）
//
// 由 DSH 客户端模块系统加载；不要在这里 import node: 内置模块。
// 数据都通过宿主注册的 /agh-lite-plugin/* 路由拿。

window.__ModuleLoader__.load({
  id: 'agh-lite-plugin',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const { useState, useCallback, useEffect, useRef } = React;
    const el = React.createElement;

    const name = 'agh-lite-plugin';
    const inject = ['betterSidebar'];
    const CSS_ID = 'agh-lite-plugin-style';

    const CSS = `
      .dstg-root { display: flex; flex-direction: column; gap: 12px; padding: 14px; font-size: 13px;
        height: 100%; max-height: 100%; min-height: 0; overflow-y: auto; box-sizing: border-box; }
      .dstg-title { font-size: 15px; font-weight: 650; margin: 0; }
      .dstg-muted { opacity: .65; line-height: 1.55; margin: 0; }
      .dstg-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .dstg-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
        background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; cursor: pointer; font: inherit; }
      .dstg-btn.primary { border-color: #4c9aff; background: #4c9aff; color: #fff; }
      .dstg-btn:disabled { opacity: .5; cursor: default; }
      .dstg-input { flex: 1 1 180px; min-width: 140px; padding: 6px 8px; border-radius: 8px; font: inherit;
        border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; }

      .dstg-bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden;
        background: #21262d; margin: 4px 0; }
      .dstg-bar span { display: block; height: 100%; }
      .dstg-legend { display: flex; gap: 10px; font-size: 11px; opacity: .75; flex-wrap: wrap; }
      .dstg-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px;
        margin-right: 4px; }
      .dstg-details { margin-top: 6px; }
      .dstg-root > * { flex-shrink: 0; }
      .dstg-modal { position: fixed; inset: 0; background: rgba(0,0,0,.55);
        display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
      .dstg-modal-body { background: #161b22; border: 1px solid #30363d; border-radius: 12px;
        width: min(560px, 100%); max-height: 80vh; display: flex; flex-direction: column; gap: 10px;
        padding: 14px; color: #e6edf3; }
      .dstg-modal-body h3 { margin: 0; font-size: 14px; }
      .dstg-modal-body .dstg-pre { max-height: 58vh; background: #21262d; }
      .dstg-details summary { cursor: pointer; font-size: 12px; opacity: .7; padding: 4px 0; }
      .dstg-pre { white-space: pre-wrap; line-height: 1.55; margin: 0; padding: 10px; border-radius: 10px;
        background: color-mix(in srgb, currentColor 5%, transparent); max-height: 46vh; overflow: auto; font-size: 12px; }
      .dstg-error { color: #ff7875; }
      .dstg-card { border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 12px; padding: 12px;
        display: flex; flex-direction: column; gap: 10px; }
    `;

    function injectCss() {
      if (document.getElementById(CSS_ID)) return;
      const style = document.createElement('style');
      style.id = CSS_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    async function readJson(response) {
      const raw = await response.text();
      if (!raw) {
        throw new Error(`服务没有返回内容（HTTP ${response.status}）。宿主插件可能没加载，重启 DSH 再试`);
      }
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`返回不是 JSON（HTTP ${response.status}）：${raw.slice(0, 120)}`);
      }
    }

    function Panel() {
      const [audit, setAudit] = useState({ loading: false, text: '', error: null, totals: null });
      const [proxy, setProxy] = useState(null);
      const [upstream, setUpstream] = useState('https://api.deepseek.com');
      const [busy, setBusy] = useState('');
      const [elapsed, setElapsed] = useState(0);
      const abortRef = useRef(null);
      const [optimize, setOptimize] = useState({ busy: false, path: '', error: null });
      const [clean, setClean] = useState([]);
      const [cleanLines, setCleanLines] = useState([]);
      const [toolset, setToolset] = useState({ busy: false, data: null, error: null, picked: [], result: '' });
      const [modal, setModal] = useState(null);
      const [hostOk, setHostOk] = useState(true);

      useEffect(() => {
        fetch('/agh-lite-plugin/ping')
          .then((response) => readJson(response))
          .then((data) => setHostOk(Boolean(data.ok)))
          .catch(() => setHostOk(false));
      }, []);

      const runOptimize = useCallback(async () => {
        setOptimize({ busy: true, path: '', error: null });
        console.log('[agh-lite-plugin] runall start');
        try {
          const response = await fetch('/agh-lite-plugin/runall?upstream=' + encodeURIComponent(upstream));
          const data = await readJson(response);
          if (!data.ok) throw new Error(data.error || '处理失败');
          setOptimize({ busy: false, path: data.path, error: null });
          const actions = Array.isArray(data.actions) ? data.actions : [];
          setModal({
            title: '一键处理完成',
            text: actions.length > 0
              ? actions.map((item) => `· ${item}`).join('\n')
              : `优化包：${data.path}`,
          });
          if (data.text) {
            setAudit({ loading: false, text: data.text, error: null, totals: data.totals ?? null });
          }
          fetch('/agh-lite-plugin/proxy')
            .then((item) => readJson(item))
            .then(setProxy)
            .catch(() => {});
        } catch (error) {
          console.error('[agh-lite-plugin] runall failed', error);
          setOptimize({ busy: false, path: '', error: String(error?.message ?? error) });
        }
      }, [upstream]);

      const toggleClean = useCallback((target) => {
        setClean((current) => (current.includes(target)
          ? current.filter((item) => item !== target)
          : [...current, target]));
      }, []);

      const applyCleanup = useCallback(async () => {
        try {
          const data = await fetch('/agh-lite-plugin/cleanup?targets=' + encodeURIComponent(clean.join(','))).then((response) => readJson(response));
          setCleanLines(data.lines ?? []);
        } catch (error) {
          setCleanLines([String(error?.message ?? error)]);
        }
      }, [clean]);

      const scanToolset = useCallback(async () => {
        setToolset((current) => ({ ...current, busy: true, error: null }));
        try {
          const data = await fetch('/agh-lite-plugin/toolset').then((response) => readJson(response));
          setToolset({ busy: false, data, error: null, picked: [], result: '' });
        } catch (error) {
          setToolset({ busy: false, data: null, error: String(error?.message ?? error), picked: [], result: '' });
        }
      }, []);

      const applyToolset = useCallback(async () => {
        setToolset((current) => ({ ...current, busy: true, error: null }));
        try {
          const data = await fetch('/agh-lite-plugin/toolset/apply?ids=' + encodeURIComponent(toolset.picked.join(','))).then((response) => readJson(response));
          if (!data.ok) throw new Error(data.error || '应用失败');
          setToolset((current) => ({ ...current, busy: false, result: `已写入补丁，备份在 ${data.backup}。重启 DSH 生效。` }));
        } catch (error) {
          setToolset((current) => ({ ...current, busy: false, error: String(error?.message ?? error) }));
        }
      }, [toolset.picked]);

      const rollbackToolset = useCallback(async () => {
        try {
          const data = await fetch('/agh-lite-plugin/toolset/rollback').then((response) => readJson(response));
          setToolset((current) => ({ ...current, result: data.ok ? `已回滚：${data.restored}` : (data.error || '回滚失败') }));
        } catch (error) {
          setToolset((current) => ({ ...current, error: String(error?.message ?? error) }));
        }
      }, []);


      const scan = useCallback(async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        setAudit({ loading: true, text: '', error: null });
        setElapsed(0);
        const started = Date.now();
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        try {
          const response = await fetch('/agh-lite-plugin/audit?days=30', { signal: controller.signal });
          const data = await readJson(response);
          if (!data.ok) throw new Error(data.error || '审计失败');
          setAudit({ loading: false, text: data.text || '', error: null, totals: data.totals ?? null });
        } catch (error) {
          if (error?.name === 'AbortError') {
            setAudit({ loading: false, text: '', error: '已取消等待（后台可能仍在扫描）' });
          } else {
            setAudit({ loading: false, text: '', error: String(error?.message ?? error) });
          }
        } finally {
          clearInterval(timer);
          abortRef.current = null;
        }
      }, []);

      const cancelScan = useCallback(() => {
        abortRef.current?.abort();
      }, []);

      const loadProxy = useCallback(async () => {
        try {
          setProxy(await fetch('/agh-lite-plugin/proxy').then((response) => readJson(response)));
        } catch {
          setProxy({ ok: false, running: false });
        }
      }, []);

      const controlProxy = useCallback(async (action) => {
        setBusy(action);
        try {
          const response = await fetch('/agh-lite-plugin/proxy', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, upstream }),
          });
          setProxy(await readJson(response));
        } catch (error) {
          setProxy({ ok: false, running: false, error: String(error?.message ?? error) });
        } finally {
          setBusy('');
        }
      }, [upstream]);

      useEffect(() => {
        loadProxy();
      }, [loadProxy]);

      const stats = proxy?.stats ?? {};
      return el(
        'div',
        { className: 'dstg-root' },
        el('h2', { className: 'dstg-title' }, 'AGH Token 审计'),
        el('p', { className: 'dstg-muted' }, '扫描本机会话，找出浪费；审计不调用模型，不花 token。'),
        hostOk
          ? null
          : el('p', { className: 'dstg-error' }, '宿主插件没加载：检查 cordis.patch.yml 里的 agh-lite-plugin，然后重启 DSH。'),
        el(
          'div',
          { className: 'dstg-row' },
          el(
            'button',
            { className: 'dstg-btn primary', onClick: scan, disabled: audit.loading },
            audit.loading ? `审计中… ${elapsed}s` : '审计我的 Token',
          ),
          audit.loading
            ? el('button', { className: 'dstg-btn', onClick: cancelScan }, '取消等待')
            : null,
          el(
            'button',
            { className: 'dstg-btn', onClick: runOptimize, disabled: optimize.busy },
            optimize.busy ? '处理中…' : '一键处理',
          ),
        ),
        el('p', { className: 'dstg-muted' }, '审计就是扫描本机会话：只读、不调用模型、不花 token。'),
        audit.text || audit.loading
          ? null
          : el('p', { className: 'dstg-muted' }, '步骤：1. 审计我的 Token → 2. 看占比条和「下一步」→ 3. 一键处理（开代理 + 生成清单）'),
        optimize.path
          ? el('p', { className: 'dstg-muted' }, `已处理：优化包 ${optimize.path}${proxy?.running ? '，代理已启动' : ''}`)
          : null,
        optimize.error ? el('p', { className: 'dstg-error' }, optimize.error) : null,
        audit.error ? el('p', { className: 'dstg-error' }, audit.error) : null,
        audit.totals && audit.totals.promptTokens
          ? el('div', null,
              el('div', { className: 'dstg-bar' },
                [['历史', audit.totals.historyTokens, '#4c9aff'],
                 ['system', audit.totals.systemTotalTokens, '#d29922'],
                 ['工具 schema', audit.totals.schemaTotalTokens, '#f85149']].map(([name, value, color]) =>
                  el('span', { key: name, title: name,
                    style: { width: `${Math.max(0, (value / audit.totals.promptTokens) * 100).toFixed(1)}%`,
                      background: color } }))),
              el('div', { className: 'dstg-legend' },
                [['历史', audit.totals.historyTokens, '#4c9aff'],
                 ['system', audit.totals.systemTotalTokens, '#d29922'],
                 ['工具 schema', audit.totals.schemaTotalTokens, '#f85149']].map(([name, value, color]) =>
                  el('span', { key: name },
                    el('i', { style: { background: color } }),
                    `${name} ${Math.round((value / audit.totals.promptTokens) * 100)}%`))))
          : null,
        audit.text ? el('pre', { className: 'dstg-pre' }, audit.text) : null,
        el(
          'div',
          { className: 'dstg-card' },
          el('p', { className: 'dstg-muted' }, '工具瘦身（实验）：按插件禁用，应用前自动备份，需要重启。'),
          el('button', { className: 'dstg-btn', onClick: scanToolset, disabled: toolset.busy },
            toolset.busy ? '扫描中…' : '扫描可禁用插件'),
          ...((toolset.data?.candidates ?? []).map((item) =>
            el('label', { key: item.id, className: 'dstg-check' },
              el('input', { type: 'checkbox',
                checked: toolset.picked.includes(item.id),
                onChange: () => setToolset((current) => ({
                  ...current,
                  picked: current.picked.includes(item.id)
                    ? current.picked.filter((id) => id !== item.id)
                    : [...current.picked, item.id],
                })) }),
              ` ${item.id}（${item.tools.length} 个工具，${item.tokens} tokens）`))),
          el('button', { className: 'dstg-btn', onClick: applyToolset,
            disabled: toolset.busy || toolset.picked.length === 0 }, '应用选中（备份 + 重启）'),
          el('button', { className: 'dstg-btn', onClick: rollbackToolset }, '回滚上一个补丁'),
          toolset.result ? el('p', { className: 'dstg-muted' }, toolset.result) : null,
          toolset.error ? el('p', { className: 'dstg-error' }, toolset.error) : null,
        ),
        el(
          'details',
          { className: 'dstg-details' },
          el('summary', null, '高级：清理（只清磁盘，不省 token）'),
          el(
            'div',
            { className: 'dstg-card' },
            el('p', { className: 'dstg-muted' }, '清理：只删可重建的数据，不动会话和配置。'),
            el('label', { className: 'dstg-check' },
              el('input', { type: 'checkbox', checked: clean.includes('parse-cache'),
                onChange: () => toggleClean('parse-cache') }),
              ' 解析缓存（下次扫描重新解析）'),
            el('label', { className: 'dstg-check' },
              el('input', { type: 'checkbox', checked: clean.includes('ledger'),
                onChange: () => toggleClean('ledger') }),
              ' 代理账本（轮转为 .1）'),
            el('button', { className: 'dstg-btn', onClick: applyCleanup, disabled: clean.length === 0 },
              '执行选中项'),
            ...cleanLines.map((line, index) => el('p', { key: index, className: 'dstg-muted' }, line)),
          ),
        ),
        el(
          'div',
          { className: 'dstg-card' },
          el('p', { className: 'dstg-muted' }, '本地代理：自动裁剪旧工具结果、缓存重复请求。'),
          el(
            'div',
            { className: 'dstg-row' },
            el('input', {
              className: 'dstg-input',
              value: upstream,
              onChange: (event) => setUpstream(event.target.value),
              placeholder: 'https://api.deepseek.com',
            }),
          ),
          el(
            'div',
            { className: 'dstg-row' },
            proxy?.running
              ? el(
                  'button',
                  { className: 'dstg-btn', onClick: () => controlProxy('stop'), disabled: busy !== '' },
                  busy === 'stop' ? '停止中…' : '停止代理',
                )
              : el(
                  'button',
                  { className: 'dstg-btn primary', onClick: () => controlProxy('start'), disabled: busy !== '' },
                  busy === 'start' ? '启动中…' : '启动代理',
                ),
            el('button', { className: 'dstg-btn', onClick: loadProxy }, '刷新状态'),
          ),
          proxy?.running
            ? el(
                'p',
                { className: 'dstg-muted' },
                `运行中：http://127.0.0.1:${proxy.port}/v1 · 请求 ${stats.requests ?? 0} · 缓存命中 ${stats.cacheHits ?? 0} · 裁剪 ${stats.trimmedRequests ?? 0} 次`,
              )
            : el('p', { className: 'dstg-muted' }, '未启动'),
          proxy?.error ? el('p', { className: 'dstg-error' }, proxy.error) : null,
        ),
        modal
          ? el(
              'div',
              { className: 'dstg-modal', onClick: () => setModal(null) },
              el(
                'div',
                { className: 'dstg-modal-body', onClick: (event) => event.stopPropagation() },
                el('h3', null, modal.title),
                el('pre', { className: 'dstg-pre' }, modal.text),
                el('button', { className: 'dstg-btn primary', onClick: () => setModal(null) }, '知道了'),
              ),
            )
          : null,
        el(
          'details',
          { className: 'dstg-details' },
          el('summary', null, '功能说明'),
          el(
            'div',
            { className: 'dstg-card' },
            el('p', { className: 'dstg-muted' }, '审计我的 Token：只读扫本机会话，出报告、占比条和下一步。'),
            el('p', { className: 'dstg-muted' }, '一键处理：重新审计 + 启动代理 + 生成优化包（报告、未用工具清单、AGENTS 建议）。'),
            el('p', { className: 'dstg-muted' }, '工具瘦身：扫描可禁用插件；应用前自动备份，重启生效，可一键回滚。'),
            el('p', { className: 'dstg-muted' }, '本地代理：裁剪旧工具结果、缓存重复请求；把 DSH provider 的 baseUrl 指到 http://127.0.0.1:8787/v1 才生效。'),
            el('p', { className: 'dstg-muted' }, '清理（高级）：删解析缓存、轮转代理账本，只清磁盘，不省 token。'),
            el('p', { className: 'dstg-muted' }, '数据位置：$DSH_HOME/agh-lite-plugin-cache、agh-lite-proxy.jsonl、agh-lite-optimize/。'),
            el('p', { className: 'dstg-muted' }, '边界：不自动改 AGENTS.md，不压缩历史会话；这两件只给建议。'),
          ),
        ),
      );
    }

    function apply(ctx) {
      injectCss();
      let sidebar;
      try {
        sidebar = typeof ctx.get === 'function' ? ctx.get('betterSidebar') : undefined;
      } catch {
        return;
      }
      if (!sidebar || typeof sidebar.registerTab !== 'function') return;
      try {
        ctx.effect(() => sidebar.registerTab({
          id: 'agh-lite-plugin',
          title: () => 'AGH Token 审计',
          description: () => '审计 token 花在哪，开关本地代理',
          order: 61,
          single: true,
          component: () => el(Panel),
        }), 'agh-lite-plugin: sidebar tab');
      } catch {
        // 注册失败不影响工具
      }
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
