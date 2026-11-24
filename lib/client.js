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
    const { useState, useCallback, useEffect } = React;
    const el = React.createElement;

    const name = 'agh-lite-plugin';
    const inject = ['betterSidebar'];
    const CSS_ID = 'agh-lite-plugin-style';

    const CSS = `
      .dstg-root { display: flex; flex-direction: column; gap: 12px; padding: 14px; font-size: 13px; }
      .dstg-title { font-size: 15px; font-weight: 650; margin: 0; }
      .dstg-muted { opacity: .65; line-height: 1.55; margin: 0; }
      .dstg-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .dstg-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
        background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; cursor: pointer; font: inherit; }
      .dstg-btn.primary { border-color: #4c9aff; background: #4c9aff; color: #fff; }
      .dstg-btn:disabled { opacity: .5; cursor: default; }
      .dstg-input { flex: 1 1 180px; min-width: 140px; padding: 6px 8px; border-radius: 8px; font: inherit;
        border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; }
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

    function Panel() {
      const [audit, setAudit] = useState({ loading: false, text: '', error: null });
      const [proxy, setProxy] = useState(null);
      const [upstream, setUpstream] = useState('https://api.deepseek.com');
      const [busy, setBusy] = useState('');

      const scan = useCallback(async () => {
        setAudit({ loading: true, text: '', error: null });
        try {
          const response = await fetch('/agh-lite-plugin/audit?days=30');
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || '审计失败');
          setAudit({ loading: false, text: data.text || '', error: null });
        } catch (error) {
          setAudit({ loading: false, text: '', error: String(error?.message ?? error) });
        }
      }, []);

      const loadProxy = useCallback(async () => {
        try {
          setProxy(await fetch('/agh-lite-plugin/proxy').then((response) => response.json()));
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
          setProxy(await response.json());
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
        el('p', { className: 'dstg-muted' }, 'AGH 家族的 DSH 插件版。扫描本机会话，找出浪费；审计不调用模型，不花 token。'),
        el(
          'div',
          { className: 'dstg-row' },
          el(
            'button',
            { className: 'dstg-btn primary', onClick: scan, disabled: audit.loading },
            audit.loading ? '扫描中…' : '扫描我的会话',
          ),
        ),
        audit.error ? el('p', { className: 'dstg-error' }, audit.error) : null,
        audit.text ? el('pre', { className: 'dstg-pre' }, audit.text) : null,
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
          description: () => 'AGH 家族：审计 token 花在哪，开关本地代理',
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
