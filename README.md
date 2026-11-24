# agh-lite-plugin

[agh-lite](https://github.com/Gray2006/AGH-LITE) 的 DSH 插件版。名字里的 `agh-lite` 就是母项目；
插件用 JS 重写，不需要装 Python。

DSH 里的傻瓜式 Token 审计：一个工具，扫一遍本机会话，告诉你钱花在哪、哪几条最值得改。

不用终端，不用装 Python。装好插件后直接对我说：

> 审计一下我的 token

我会调用 `token_audit`，返回会话数、总 tokens、估算费用、缓存命中、估算可省，以及最该改的几件事。

## 它做什么

- 只读 `$DSH_HOME/sessions`，不调用模型、不花 token
- 统计：会话数、轮/步、prompt/output、前缀缓存命中、工具结果占比、估算费用
- 找浪费：重复调用、超大工具结果、缓存命中低、静态前缀过重、上下文膨胀
- 给出每条的估算可省，总量按 25% 封顶
- 解析结果缓存在 `$DSH_HOME/agh-lite-plugin-cache`，第二次扫描 1 秒内
- 内置本地代理：裁剪较早的超长工具结果、缓存非流式重复请求
- 侧边栏面板：扫描（带秒数、可取消等待）、看结果、开关代理，不用记命令

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
