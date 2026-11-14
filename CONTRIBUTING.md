# Contributing

Thanks for considering a contribution.

## Before you start

- Open an issue for anything beyond a small fix, so the approach can be discussed first.
- Do not weaken the SSRF guard: the bridge must keep rejecting loopback, private, link-local and IP-literal destinations. Changes that allow a hostname answer outside the configured fake-IP ranges will not be accepted.

## Development setup

No dependencies or build step are required; the plugin is plain ESM JavaScript.

```bash
node --test test/fakeip.test.mjs   # unit tests
npm run check                      # syntax check + tests
```

To try the plugin inside DSH, install the checkout directory from **Plugins → Add plugin** with its absolute path. The first install needs a DSH restart for the configuration page to appear.

## Code layout

- `fakeip.js` — pure logic. Keep it free of package imports so it remains testable with plain Node.
- `index.js` — Host entry and the `Config` schema. It only declares the schema and mounts `fakeip.js`.
- `client.js` — hand-authored browser module (module-loader format) for the configuration page.
- `cordis.patch.yml` — bundle patch that inserts the `fakeip-bridge` row and its default config.
- `test/fakeip.test.mjs` — node:test unit tests.

## Compatibility contract

The plugin intentionally depends on DSH internals:

- `ctx.web` (`@deepseek-ai/dsh-web`) exposes `fetchProviders` and `registerFetchProvider`;
- `HttpFetchProvider` (`@deepseek-ai/dsh-web-fetch-http`) exposes `resolveAddresses(hostname, signal)`;
- the local provider rejects non-public answers with `WEB_BLOCKED_URL`.

These were verified against DSH `0.2.1-rc.4`. When updating for a new DSH version, update the tested version in the README and CHANGELOG and re-run the smoke checks (`web_fetch https://github.com` succeeds, `web_fetch http://127.0.0.1:<port>` still fails).

## Pull requests

- Keep behavior changes and refactors in separate commits when practical.
- Add or adjust unit tests for behavior changes.
- Describe the DSH version you tested on, plus the smoke results.
- By contributing you agree that your contribution is licensed under the project's [MIT license](LICENSE).
