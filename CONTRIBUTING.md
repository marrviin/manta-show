# Contributing

Thanks for your interest in improving manta-show! 中文贡献者可直接用中文开 issue / PR。

## Development setup

```bash
git clone <this-repo> && cd manta-show
pnpm install
npx playwright install chromium
pnpm build
```

| Command | What it does |
|---|---|
| `pnpm dev` | tsc --watch |
| `pnpm test` | fast unit tests (node:test, no browser) |
| `pnpm test:e2e` | build + e2e over the real MCP surface (web / cli / electron lines) |
| `pnpm demos` | regenerate the demo assets in `website/media/` |

## Repo layout

```
packages/mcp/          the MCP server (@manta-show/mcp)
  src/targets/         capture targets: browser, terminal (pty + xterm replay), web, electron, cli
  src/pipeline/        unified recorder, decorations, ffmpeg encoding
  src/deps/            external dependency location (ffmpeg) and container runtime
  src/tools/           MCP tool registration (web / cli / electron / shared)
  scripts/             make-demos.mts (self-demo asset generator)
packages/node-pty/     node-pty fork sources + platform packing
scripts/               ffmpeg platform-package packing (pack-ffmpeg.js)
website/               static project website
```

## Guidelines

- **Tool behavior changes**: the three capture lines share `src/tools/shared.ts` and the unified
  recorder — prefer extending the shared layer over adding per-line code paths. Tool descriptions
  are read by agents; keep them precise and actionable.
- **Tests**: capture-pipeline changes need an e2e case (see `packages/mcp/test/e2e.ts`); pure
  logic (locators, resolution orders, argv builders) gets a unit test with injected probes.
- **No lifecycle scripts / new native deps without discussion**: they follow the platform-package
  pipeline (see the "Native dependencies & publishing" section of the README).
- **Docs travel with behavior**: README.md (English) and README.zh-CN.md (and website/docs.html for tool
  reference) are updated in the same PR.

## Releases

Releases are tag-triggered (`vX.Y.Z` → CI builds platform packages, then publishes
`@manta-show/mcp`). Maintainers cut releases; contributors don't need to worry about it.
