# @manta-show/mcp

English | [简体中文](https://github.com/marrviin/manta-show/blob/main/README.zh-CN.md)

An MCP server that lets AI agents (Cursor, Claude Code, etc.) capture showcase-ready product media: high-quality **screenshots and demo videos (mp4) of web pages, Electron apps, and CLI tools**, ready to drop into READMEs and docs.

- **No OS-level screen recording** — capture happens at the Chromium render layer (Playwright / CDP): no screen-recording permission, no window flicker, CI-friendly
- **Zero-intrusion CLI capture** — node-pty intercepts the TTY stream; output renders in an xterm.js replay page that gets recorded
- **Unified media pipeline** — all videos come out as `mp4 (H.264, yuv420p)`; screenshots return directly as MCP image content
- **Designed for agents** — session-based fine-grained tools, recoverable error messages, markdown reference snippets built into every response

## Install

```bash
npm install -g @manta-show/mcp
manta-show init        # detect installed AI agents and write MCP configs; then prepare the environment (installs missing Chromium / ffmpeg with progress)
manta-show doctor      # re-check and repair anytime (--deep runs a real capture test)
```

Requires Node ≥ 20. Media artifacts land in `~/.manta-show/media`. Video capture needs ffmpeg, located automatically via `MANTA_SHOW_FFMPEG` → PATH → the bundled prebuilt packages `@manta-show/ffmpeg-<platform>-<arch>` (script-less platform packages, unaffected by npm 12's dependency-script blocking; downloaded automatically during init when missing — no manual install needed).

## Add to an MCP client

Claude Code (project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "manta-show": {
      "command": "npx",
      "args": ["-y", "@manta-show/mcp"]
    }
  }
}
```

Cursor (`~/.cursor/mcp.json`) uses the same shape.

| Env var | Default | Description |
|---|---|---|
| `MANTA_SHOW_FFMPEG` | — | Path to the ffmpeg executable (rarely needed) |
| `MANTA_SHOW_LANG` | `en` | UI language for tool descriptions, results and CLI output (`en`, `zh-CN`; unknown values fall back to `en`) |

Persist any of these without exporting them via `manta-show set --env MANTA_SHOW_LANG=zh-CN` (repeatable `--env`, stored in `~/.manta-show/config.json`, applied on startup; a real exported variable wins).

## Tool families

| Tools | Purpose |
|---|---|
| `browser_*` | Web: open / navigate / screenshot / record video / evaluate JS / interact (batch `steps` recording supported) |
| `electron_*` | Electron apps: launch / screenshot / record video / interact (batch `steps` supported) |
| `terminal_*` | Run CLI tools in a pseudo-terminal (xterm.js replay page), interact and record; optional throwaway-container isolation |

List and clean captured media with the CLI subcommands: `manta-show recordings` / `manta-show clean`.

All interaction tools accept an optional `sessionId`; omit it to act on the most recently active session of that kind.

## Repository

Full docs, comparison with Playwright MCP / vhs, and source:
[marrviin/manta-show](https://github.com/marrviin/manta-show).

## License

MIT. The `@manta-show/ffmpeg-*` platform packages redistribute GPL-licensed FFmpeg builds and are licensed GPL-3.0 accordingly.
