# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-11-14

### Changed

- Renamed the plugin row id and the local project directory to `dsh-fakeip-bridge`, matching the package and repository names.

### Notes

- **Important:** DSH Desktop `2.0.23-next` (`@deepseek-ai/dsh-web-fetch-http` `0.2.2-rc.3`) reworked the local fetch provider to allow intranet and local addresses and removed `resolveAddresses`. The bridge is inert there and no longer needed; the README now documents the version matrix.

## [0.2.0] - 2026-11-12

### Added

- In-app configuration form rendered directly on the bundle's Plugins-page card (`plugins.bundle.config`), matching dsh-context's UX: editable fake-IP IPv4/IPv6 ranges and an allowed-destination log switch, with Save and Reset-to-default.
- Host-side `Config` schema with volatile fields; edits are validated by the Settings service and applied live through the active profile's Cordis patch, without reloading the plugin.
- Separate pure-logic module (`fakeip.js`) so the bridge rules stay unit-testable without a DSH runtime.
- Live config reads: volatile config references are re-read on every resolution.

### Changed

- Configuration is rendered inline on the bundle page instead of behind a per-row Configure control, so it is visible as soon as the plugin is opened.
- Package and repository renamed to `dsh-fakeip-bridge` for the public release.
- Open-source project files: English and Chinese READMEs, MIT license, CI, contributing guide, changelog.

## [0.1.0] - 2026-11-05

### Added

- Initial host-only plugin: wrap the local `http` fetch provider's `resolveAddresses`, re-resolve only after a `WEB_BLOCKED_URL`/non-public rejection, and allow the answer only when every address is inside the configured fake-IP ranges.
- Fail-closed handling for loopback, private, link-local, mixed, empty, invalid and IP-literal destinations.
- Unit tests and manual DSH smoke verification (`web_fetch` restored; loopback still blocked).
