# agh-lite-plugin

[agh-lite](https://github.com/Gray2006/AGH-LITE) 的 DSH 插件版。名字里的 `agh-lite` 就是母项目；
插件用 JS 重写，不需要装 Python。

DSH 里的傻瓜式 Token 审计：一个工具，扫一遍本机会话，告诉你钱花在哪、哪几条最值得改。

> **和 AGH（AdGuard Home）无关。** 这里的 AGH 是 [AGH-LITE](https://github.com/Gray2006/AGH-LITE) 的缩写。

不用终端，不用装 Python。装好插件后直接对我说：

> 审计一下我的 token

我会调用 `token_audit`，返回会话数、总 tokens、估算费用、缓存命中、估算可省，以及最该改的几件事。

## 它做什么

- 只读 `$DSH_HOME/sessions`，不调用模型、不花 token
- 统计：会话数、轮/步、prompt/output、前缀缓存命中、工具结果占比、估算费用
- 找浪费：重复调用、超大工具结果、缓存命中低、静态前缀过重、上下文膨胀
- 给出每条的估算可省，总量按 25% 封顶
- 报告末尾带「下一步」：从没调用过的工具、偏重的 system、没压过的长会话、开代理
- 面板有「一键优化」：生成优化包（报告 + 完整未用工具清单 + AGENTS.md 精简建议）到 `$DSH_HOME/agh-lite-optimize/`
- 面板有「清理」：按分类勾选，删除可重建的解析缓存、轮转代理账本，不动会话和配置
- 解析结果缓存在 `$DSH_HOME/agh-lite-plugin-cache`，第二次扫描 1 秒内
- 内置本地代理：裁剪较早的超长工具结果、缓存非流式重复请求
- 侧边栏面板：审计（带秒数、可取消等待）、一键优化、开关代理，不用记命令

估算口径和 [agh-lite](https://github.com/Gray2006/AGH-LITE) 一致。更细的报告、真实账单对账在 agh-lite 里。

## 用法

装好后直接说：

> 审计一下我的 token

或：

> 启动 token 代理，上游 https://api.deepseek.com

侧边栏会出现「AGH Token 审计」页：点「审计我的 Token」，下面直接出结果；代理区填上游地址就能启停。

## 安装

插件是纯 JS、零依赖，DSH 自带的 Node 22+ 就能跑。

**方式一：DSH 插件管理**
如果这一版 DSH 的插件页支持「从本地目录安装」，选这个仓库目录即可。

**方式二：手动放目录（一次性）**
1. 把整个 `agh-lite-plugin` 目录复制到
   `%DSH_HOME%\profiles\<profile>\node_modules\agh-lite-plugin`
2. 在该 profile 的 `cordis.patch.yml` 里加：
   ```yaml
   - insert:
       - id: agh-lite-plugin
         name: agh-lite-plugin
         config:
           days: 30
   ```
3. 重启 DSH

不需要 `npm install`，也没有构建步骤。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `days` | 30 | 默认只看最近 N 天；工具参数可以覆盖 |
| `upstream` | 空 | 代理默认上游；也可在工具参数或面板里填 |
| `proxyPort` | 8787 | 代理监听端口 |
| `maxToolChars` | 4000 | 单条旧 tool 结果保留的字符数 |
| `keepRecent` | 8 | 最近 N 条消息不动 |

## 和同类插件的区别

| 插件 | 侧重 | 交互 |
|---|---|---|
| **agh-lite-plugin** | 会话浪费的快速诊断：哪几条最值得改、估算可省多少 | 对话式 `token_audit` + 面板，零配置 |
| dsh-context-doctor | 静态注入物审计：AGENTS.md、技能目录、工具 schema 的占比与冲突 | Web 圆环面板 + `context_audit` |
| dsh-token-ledger | 可追溯的 Token 账本：持久化日志折算为重启安全的总量 | 命令行/库 |

本插件也给出静态前缀拆分（system / 工具 schema / 历史），但重点是决策建议，不是精细记账。
需要账单对账用母项目 agh-lite。

## 边界

- 审计只读，不改 DSH 请求
- 代理只监听 127.0.0.1，需要你主动把 provider 指过来；不是 MITM
- 不会上传任何会话内容
- 数字是估算上限，不是账单
- 流式请求不缓存，只做裁剪

## 开发

```bash
node --test test/audit.test.mjs test/proxy.test.mjs
```

## 许可

MIT
