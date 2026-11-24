# dsh-token-guard

DSH 里的傻瓜式 Token 审计：一个工具，扫一遍本机会话，告诉你钱花在哪、哪几条最值得改。

不用终端，不用装 Python。装好插件后直接对我说：

> 审计一下我的 token

我会调用 `token_audit`，返回会话数、总 tokens、缓存命中、估算可省，以及最该改的几件事。

## 它做什么

- 只读 `$DSH_HOME/sessions`，不调用模型、不花 token
- 统计：会话数、轮/步、prompt/output、前缀缓存命中、工具结果占比
- 找浪费：重复调用、超大工具结果、缓存命中低、静态前缀过重、上下文膨胀
- 给出每条的估算可省，总量按 25% 封顶

估算口径和 [agh-lite](https://github.com/Gray2006/AGH-LITE) 一致。更细的报告、代理、真实账单对账在 agh-lite 里。

## 安装

插件是纯 JS、零依赖，DSH 自带的 Node 22+ 就能跑。

**方式一：DSH 插件管理**
如果这一版 DSH 的插件页支持「从本地目录安装」，选这个仓库目录即可。

**方式二：手动放目录（一次性）**
1. 把整个 `dsh-token-guard` 目录复制到
   `%DSH_HOME%\profiles\<profile>\node_modules\dsh-token-guard`
2. 在该 profile 的 `cordis.patch.yml` 里加：
   ```yaml
   - insert:
       - id: dsh-token-guard
         name: dsh-token-guard
         config:
           days: 30
   ```
3. 重启 DSH

不需要 `npm install`，也没有构建步骤。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `days` | 30 | 默认只看最近 N 天；工具参数可以覆盖 |

## 边界

- 只做审计，不做自动压缩、不改 DSH 请求
- 不会上传任何会话内容
- 数字是估算上限，不是账单
- 自动省 token 要配合代理（在 agh-lite 里，后续会搬过来）

## 开发

```bash
node --test test/
```

## 许可

MIT
