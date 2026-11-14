# dsh-fakeip-bridge

[![CI](https://github.com/obrua/dsh-fakeip-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/obrua/dsh-fakeip-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | 简体中文

一个非官方的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件：在 **Clash / TUN fake-IP** 环境下恢复本地 `web_fetch`，同时**保留** DSH 对 loopback / 内网的 SSRF 拦截。

> 本项目与 DeepSeek 官方无关；"DeepSeek Harness" 等相关名称归其各自所有者。

## 问题背景

DSH 本地抓取 provider（`@deepseek-ai/dsh-web-fetch-http`）会先解析 URL 主机名，并拒绝一切不是公网单播的解析结果：

```
Error: URL hostname "github.com" resolves to a non-public IP address   (WEB_BLOCKED_URL)
```

开启 Clash Verge Rev 的 **TUN + fake-ip** 后，系统 DNS 把每个域名都解析成保留地址（IPv4 是 `198.18.0.x`，IPv6 是 `2001:2::x`）。`curl`、`git` 和浏览器能正常工作（TUN 会把这些地址交给代理），但 `web_fetch` 看到 "non-public IP" 就把几乎所有域名拦掉。

## 插件做了什么

插件只包装本地 `http` provider 的 `resolveAddresses`，做一层很窄的桥接：

1. **先跑 provider 原本的解析器**，成功或失败都按原样处理；
2. 只有当原错误是 `WEB_BLOCKED_URL` / "non-public IP" 时，才用系统解析器重新解析（`dns.lookup(host, { all: true, order: 'verbatim' })`，并尊重 abort signal）；
3. 只有**所有**返回地址都落在配置的 fake-IP 段内才放行；
4. 其他情况一律 fail closed：loopback、内网、link-local、混合结果、空结果、lookup 失败，以及 IP 字面量（字面量永不二次解析——它已经声明了目标）。

放行后的地址集会交回 provider，由它继续做地址钉扎。插件不会修改 Clash 配置、TUN、系统 DNS 或 `/etc/hosts`。

## 环境要求

- DSH Desktop **2.0.21-next**，DSH 包版本 **0.2.1-rc.4**（已验证的契约，见[兼容性](#兼容性)）
- Node.js **>= 22.19**
- 使用 fake-IP DNS 的 TUN 代理（默认值对应 Clash Verge Rev：`198.18.0.0/15`、`2001:2::/48`、`fdfe:dcba:9876::/64`）

## 安装

### 从本仓库安装

在 DSH 中打开 **Plugins → Add plugin**，填写 Git 形式：

```
github:obrua/dsh-fakeip-bridge
```

或填本地仓库的绝对路径。

配置页以浏览器端模块形式提供。DSH 会在进程生命周期内缓存 client 包的元数据，因此安装后如果打开 bundle 时没有立即看到配置表单，重启一次 DSH NEXT 即可（本仓库的包已经自带浏览器端代码，正常情况下无需重启就会出现）。配置本身的修改始终即时生效。

### 从本地目录安装

```
Plugins → Add plugin → /absolute/path/to/dsh-fakeip-bridge
```

插件会以 `link:` 依赖安装，之后**不要移动或删除该目录**。

## 配置

**Plugins → Installed plugins → 点开 `dsh-fakeip-bridge` bundle。** 配置表单直接显示在 bundle 页面上（描述与 rows 之间）：

- **fake-IP IPv4 网段**：每行一个 CIDR（默认 `198.18.0.0/15`）
- **fake-IP IPv6 网段**：每行一个 CIDR（默认 `2001:2::/48`、`fdfe:dcba:9876::/64`）
- **打印放行日志**：把放行的 fake-IP 目标打印到 Host 日志
- **保存**：通过 DSH Settings 服务写入 profile 级 override；字段是 volatile 的，下一次抓取即生效，无需重载插件
- **恢复默认**：移除 override，回落到 bundle 默认值

配置页会拒绝空值/非法网段。也可以直接在 profile 的 `cordis.patch.yml` 里维护同样的 row config：

```yaml
- id: fakeip-bridge
  name: dsh-fakeip-bridge
  config:
    ipv4Ranges: ['198.18.0.0/15']
    ipv6Ranges: ['2001:2::/48', 'fdfe:dcba:9876::/64']
    log: false
```

## 验证

安装后可这样验证桥接是否生效：

| 调用 | 预期 |
|---|---|
| `web_fetch https://github.com` | HTTP 200，有正文 |
| `web_fetch https://example.com` | HTTP 200 |
| `web_fetch http://127.0.0.1:<任意端口>` | 仍被拒绝：`URL hostname "127.0.0.1" resolves to a non-public IP address` |

最后一条正是重点：loopback / 内网防护仍然有效。

## 安全模型

- **白名单而非绕过**：只有全部解析地址都落在配置的 fake-IP 段内才放行，其余情况原样抛回原错误。
- **IP 字面量没有第二次机会**：`127.0.0.1`、`10.0.0.1`、`[::1]` 等仍按原逻辑拦截；只有代理解析出的 fake-IP 主机名结果可能通过。
- **没有额外网络面**：插件没有服务、端口或自己的外发请求，只在 Host 进程内包装现有 provider。
- **不改系统配置**：不修改 Clash、TUN、DNS 或 `/etc/hosts`。
- **无关场景保持 inert**：如果用户切到其他 fetch provider（例如 DeepSeek API provider），或 provider 走了代理路径（`proxyRouteFor`），插件不生效也不报错。

## 兼容性

插件依赖 `@deepseek-ai/dsh-web-fetch-http` 的 `HttpFetchProvider` 内部字段（`resolveAddresses`）和 DSH 的 `ctx.web` 注册表。已验证组合：

- DSH Desktop `2.0.21-next`
- `@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-web-fetch-http` `0.2.1-rc.4`
- Node.js `24.21.0`（Host 运行时）

DSH 把这些视为内部实现，升级后可能失效。升级 DSH 后请重新跑单测和上面的冒烟验证。若运行时结构不符，插件会降级为 inert，而不是抛错。

## 开发

```bash
# 单测（无需安装依赖）
node --test test/fakeip.test.mjs

# 语法检查 + 单测
npm run check
```

仓库结构：

| 文件 | 作用 |
|---|---|
| `index.js` | Host 入口：导出 volatile `Config` schema 并挂载 patch |
| `fakeip.js` | 纯逻辑：网段解析/匹配、guarded resolver、provider 包装 |
| `client.js` | 浏览器端：Plugins 页 bundle 配置表单（`plugins.bundle.config`） |
| `cordis.patch.yml` | Bundle patch，插入 `fakeip-bridge` 行并带默认配置 |
| `locale/en.json`、`locale/zh.json`、`icon.svg` | 插件显示资源 |
| `test/fakeip.test.mjs` | 桥接行为的单元测试 |

提交 PR 前请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 已知限制

- 只包装本地 `http` fetch provider。
- 如果 DSH 在该插件的浏览器端代码出现之前就已缓存了这个包（例如开发过程中），配置表单要重启一次 DSH 后才会出现；正常安装会直接出现。
- 插件必须从稳定目录安装；移动 `link:` 安装目录会导致失效。
- 未对 IPv4-mapped IPv6 / NAT64 做特殊放行：只接受与配置网段精确匹配的地址，保持 provider 自身的 fail-closed 行为。
- 已验证环境是 macOS / Desktop；其他平台理论上可用但未验证。

## 许可证

[MIT](LICENSE)
