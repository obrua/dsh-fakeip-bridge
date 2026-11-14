# dsh-fakeip-bridge

[![CI](https://github.com/obrua/dsh-fakeip-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/obrua/dsh-fakeip-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

English | [简体中文](README.zh-CN.md)

An unofficial plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) that restored the local `web_fetch` capability under a **Clash / TUN fake-IP** DNS setup on DSH versions whose fetch provider rejects non-public addresses — without weakening DSH's own SSRF guard. Newer DSH releases handle this natively, so check [Status and compatibility](#status-and-compatibility) first.

> Not affiliated with DeepSeek. "DeepSeek Harness" and related marks belong to their respective owners.

## The problem

DSH's local web fetch provider (`@deepseek-ai/dsh-web-fetch-http`) resolves a URL hostname and refuses every address that is not public unicast:

```
Error: URL hostname "github.com" resolves to a non-public IP address   (WEB_BLOCKED_URL)
```

With Clash Verge Rev **TUN + fake-ip**, the system resolver returns reserved fake addresses for every domain (`198.18.0.x` for IPv4, `2001:2::x` for IPv6). `curl`, `git`, and browsers work because the TUN routes those addresses to the proxy, but `web_fetch` sees "non-public IP" and blocks everything.

## What this plugin does

It wraps the local `http` fetch provider's `resolveAddresses` method with a narrow bridge:

1. the provider's **original resolver runs first**, and its result or error is used as-is;
2. only when the original rejection is `WEB_BLOCKED_URL` / "non-public IP", the hostname is re-resolved through the system resolver (`dns.lookup(host, { all: true, order: 'verbatim' })`), honoring the request abort signal;
3. the answer is accepted **only if every returned address** falls inside the configured fake-IP ranges;
4. everything else keeps failing closed: loopback, private, link-local, mixed answers, empty answers, lookup failures, and plain IP literals (a literal is never re-resolved — it states the destination).

The accepted address set is then handed back to the original provider, which still pins the connection to those addresses. Clash configuration, TUN, system DNS and `/etc/hosts` are never touched.

## Status and compatibility

| DSH version | Local `web_fetch` behaviour | This plugin |
|---|---|---|
| Desktop `2.0.21-next`, `@deepseek-ai/dsh-web-fetch-http` `0.2.1-rc.4` | Rejects non-public resolved addresses with `WEB_BLOCKED_URL`. | **Needed.** Hostnames whose answers are inside the configured fake-IP ranges are re-resolved and allowed. |
| Desktop `2.0.23-next`, `@deepseek-ai/dsh-web-fetch-http` `0.2.2-rc.3` and later | The local provider now allows intranet and local addresses by design and no longer exposes `resolveAddresses`. | **Not needed, stays inert.** `web_fetch` reaches fake-IP destinations natively, and DSH itself no longer rejects loopback/private destinations. |

## Requirements

- A DSH version whose local fetch provider still rejects non-public DNS answers with `WEB_BLOCKED_URL` (verified on Desktop **2.0.21-next** with DSH packages **0.2.1-rc.4**)
- Node.js **>= 22.19**
- A TUN proxy configured with fake-IP DNS (defaults match Clash Verge Rev: `198.18.0.0/15`, `2001:2::/48`, `fdfe:dcba:9876::/64`)

## Install

### From this repository

In DSH, open **Plugins → Add plugin** and pass a Git spec:

```
github:obrua/dsh-fakeip-bridge
```

or an absolute path to a local checkout of this repository.

The configuration page is a browser module. DSH caches client package metadata for the lifetime of the process, so if the configuration form does not appear when the bundle is opened right after installing, restart DSH NEXT once. (When the package already ships its browser half, as it does here, the page normally appears without a restart.) Configuration edits themselves apply immediately.

### From a local directory

```
Plugins → Add plugin → /absolute/path/to/dsh-fakeip-bridge
```

The plugin is installed as a `link:` dependency. Do not move or delete the directory afterwards.

## Configure

**Plugins → Installed plugins → open the `dsh-fakeip-bridge` bundle.** The configuration form is rendered directly on the bundle page, between its description and its rows:

- **fake-IP IPv4 ranges** — one CIDR per line (default `198.18.0.0/15`)
- **fake-IP IPv6 ranges** — one CIDR per line (default `2001:2::/48`, `fdfe:dcba:9876::/64`)
- **Log allowed destinations** — print accepted fake-IP destinations to the Host log
- **Save** writes a profile-level override through DSH's Settings service; the fields are volatile, so the change takes effect on the next fetch without reloading the plugin
- **Reset to default** removes the override and restores the bundle defaults

Invalid or empty ranges are rejected by the configuration page. As a fallback, the same row config can live in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-fakeip-bridge
  name: dsh-fakeip-bridge
  config:
    ipv4Ranges: ['198.18.0.0/15']
    ipv6Ranges: ['2001:2::/48', 'fdfe:dcba:9876::/64']
    log: false
```

## Verify

Once installed, these calls exercise the bridge:

| Call | Expected |
|---|---|
| `web_fetch https://github.com` | HTTP 200 with page content |
| `web_fetch https://example.com` | HTTP 200 |
| `web_fetch http://127.0.0.1:<any port>` | still rejected: `URL hostname "127.0.0.1" resolves to a non-public IP address` |

The last row is the point on versions where the bridge is active: loopback and private-network protection stays active. On DSH versions where the plugin is inert (see [Status and compatibility](#status-and-compatibility)), `web_fetch` works natively through fake-IP DNS, and loopback/private destinations are no longer rejected by DSH itself — a DSH change, not this plugin.

## Security model

- **Allowlist, not bypass.** A resolved answer is accepted only if *every* address is inside the configured fake-IP ranges. Anything else rethrows the original `WebError`.
- **IP literals are never second-guessed.** `127.0.0.1`, `10.0.0.1`, `[::1]`, etc. fail exactly as before; only hostname answers that the proxy's fake-IP DNS produced can pass.
- **No network surface.** The plugin has no server, no listener, and no outbound requests of its own; it only instruments the existing fetch provider inside the Host process.
- **No system changes.** It does not modify Clash, TUN, DNS, or `/etc/hosts`.
- **Inert when irrelevant.** If another fetch provider is selected (e.g. the DeepSeek API provider), or the provider takes its proxy route (`proxyRouteFor`), the bridge is a no-op.
- **Version-dependent.** On DSH versions whose local provider no longer enforces the public-address check (`0.2.2-rc.3` and later), this plugin stays inert and cannot restore that guard; that policy change comes from DSH.

## Compatibility

The bridge depends on an internal field of `@deepseek-ai/dsh-web-fetch-http`'s `HttpFetchProvider` (`resolveAddresses`) and on DSH's `ctx.web` registry. It was verified against:

- DSH Desktop `2.0.21-next`
- `@deepseek-ai/dsh-web`, `@deepseek-ai/dsh-web-fetch-http` `0.2.1-rc.4`
- Node.js `24.21.0` (Host runtime)

DSH treats these as private implementation details. In `@deepseek-ai/dsh-web-fetch-http` `0.2.2-rc.3` (Desktop `2.0.23-next`) the local provider was reworked to allow intranet and local addresses, and `resolveAddresses` is gone: the plugin stays inert and is unnecessary there. On versions that still expose the resolver the plugin degrades to inert rather than throwing when the internal shape is missing. Re-run the unit tests and smoke checks after a DSH upgrade.

## Development

```bash
# unit tests (no dependencies required)
node --test test/fakeip.test.mjs

# syntax + tests
npm run check
```

Repository layout:

| File | Purpose |
|---|---|
| `index.js` | Host entry: exports the volatile `Config` schema and mounts the patch |
| `fakeip.js` | Pure logic: range parsing/matching, guarded resolver, provider instrumentation |
| `client.js` | Browser half: the Plugins-page bundle configuration form (`plugins.bundle.config`) |
| `cordis.patch.yml` | Bundle patch inserting the `dsh-fakeip-bridge` row with default config |
| `locale/en.json`, `locale/zh.json`, `icon.svg` | Plugin display resources |
| `test/fakeip.test.mjs` | Unit tests for the bridge behavior |

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Limitations

- Only the local `http` fetch provider is instrumented.
- Requires a DSH version with the public-address resolver; DSH `0.2.2-rc.3` and later no longer enforce it for the local provider.
- If DSH cached this package before its browser half existed (for example while developing the plugin), the configuration form appears only after one DSH restart. For a normal install it shows up immediately.
- The plugin must be installed from a stable directory; moving a `link:` install breaks it.
- IPv4-mapped IPv6 and NAT64 translations are not special-cased: the bridge only accepts the exact addresses returned for the configured range list, matching the provider's own fail-closed validation.
- macOS/Desktop is the tested environment; other platforms should work but are unverified.

## License

[MIT](LICENSE)
