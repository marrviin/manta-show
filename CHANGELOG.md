# Changelog

All notable changes to `@manta-show/mcp` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions are the npm package versions.

## [0.0.9] — 2026-10-21

### Added

- MCP config validation in `doctor`: recorded command/args are read back and compared with
  what `mcpCommand()` would write today; mismatches ("stale configuration") and unparseable
  config files are listed with recorded-vs-standard command in the hint. Repair goes through
  the existing confirm-gated fix loop and replaces only the `manta-show` entry (Codex: strips
  just the `mcp_servers.manta-show` section) — it never runs non-interactively.
- Repair is gated on a real dist-based standard: running from source (no `dist`) disables the
  comparison instead of rewriting working configs.
- New supported agent: JoyCode (`~/.joycode/joycode-mcp.json`, `mcpServers` JSON).

## [0.0.8] — 2026-10-19

### Added

- Batch-steps recording: `browser_record_start` / `electron_record_start` accept a `steps`
  sequence (click / hover / type / press / scroll / evaluate / wait) plus `stepGapMs`, executed
  while recording; the video is produced automatically. A failed step stops the recording and
  exports the completed portion.
- Container-isolation precheck: `terminal_open` with `isolation: 'container'` now distinguishes
  "runtime not installed" from "engine not running" with actionable guidance for each.
- sha256 pinning for redistributed ffmpeg binaries (`scripts/ffmpeg-sha256.json`), verified both
  at doctor-download time and in the release pipeline.
- Self-demo asset generator (`pnpm demos`) producing the README / website media via the real MCP
  surface; README now ships self-produced demo GIFs and is English-first with a Chinese version
  (`README.zh-CN.md`).
- Website i18n (en/zh with persisted language toggle); capability-lane demos re-recorded so each
  lane shows its own capture line; workflow section redesigned to a scroll-pinned transcript.

### Fixed

- Cursor-injection evaluate is timeout-guarded so a stalled page can no longer wedge the capture
  loop.
- Frames enter the concat manifest only after their file is written to disk.
- `browser_close` description now matches behavior (unfinished recordings are flushed to disk,
  not discarded).

## [0.0.7] — 2026-10-18

- node-pty beta34.4 with CI-built correct-arch prebuilts (fixes darwin-arm64).

## [0.0.6] — 2026-10-17

- node-pty prebuilt per-platform binary packages (`@manta-show/node-pty-*-beta34.3`); release
  workflow builds and publishes them.

## [0.0.5] — 2026-10-17

- doctor: label ffmpeg source accurately (managed bin dir vs bundled package).

## [0.0.4] — 2026-10-17

- Vendor the node-pty fork (`@manta-show/node-pty` 1.1.0-beta34.1) for the macOS 26
  `posix_spawnp` compatibility issue.

## [0.0.1–0.0.3] — 2026-10-17

- Initial releases: web / terminal / Electron capture lines, unified recorder, decorations,
  synthetic cursor, `init` / `doctor` / `recordings` / `clean` CLI, ffmpeg bundling, npm
  Trusted Publisher release workflow, project website.

[Unreleased]: https://github.com/marrviin/manta-show/compare/v0.0.9...HEAD
[0.0.9]: https://github.com/marrviin/manta-show/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/marrviin/manta-show/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/marrviin/manta-show/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/marrviin/manta-show/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/marrviin/manta-show/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/marrviin/manta-show/compare/v0.0.3...v0.0.4
