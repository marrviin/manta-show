# @manta-show/mcp

为 AI Agent（Cursor、Claude Code 等）定制的全场景产品媒体捕获 MCP Server。通过代码级控制，自动为**网页、Electron 桌面应用、CLI 工具**生成高画质截图与视频（mp4），用于快速补齐网站和 README 文档。

- **零 OS 级录屏**：全部通过 Chromium 渲染层（Playwright / CDP）采集，无屏幕录制权限、无窗口抖动，CI 可跑
- **零侵入 CLI 捕获**：node-pty 拦截 TTY 文本流，在 xterm.js 回放页中渲染后录制，产出 mp4
- **统一媒体管线**：所有视频统一为 `mp4 (H.264, yuv420p)`；截图直接以 MCP image content 返回
- **面向 Agent 设计**：会话式细粒度工具、可恢复的错误提示、返回体自带 markdown 引用片段

## 安装

```bash
npm install -g @manta-show/mcp
manta-show init        # 生成推荐配置 / 引导接入
manta-show doctor      # 自检（缺 Chromium 时可一键安装：npx playwright install chromium）
```

要求：Node ≥ 20。视频捕获依赖 ffmpeg（自动按 `MANTA_SHOW_FFMPEG` → PATH → `ffmpeg-static` 顺序定位，默认无需额外安装）。

## 接入 MCP 客户端

Claude Code（项目级 `.mcp.json`）：

```json
{
  "mcpServers": {
    "manta-show": {
      "command": "npx",
      "args": ["-y", "@manta-show/mcp"],
      "env": { "MANTA_SHOW_OUTPUT": "/absolute/path/to/your-project/manta-media" }
    }
  }
}
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `MANTA_SHOW_OUTPUT` | `./manta-media`（相对 server 启动目录） | 媒体输出目录，建议指向你的文档项目 |
| `MANTA_SHOW_FFMPEG` | — | 指定 ffmpeg 可执行文件路径 |

## 工具一览

| 工具 | 用途 |
|---|---|
| `browser_*` | 网页：打开 / 导航 / 截图 / 录视频 / 执行 JS / 交互 |
| `electron_*` | Electron 应用：启动 / 截图 / 录视频 / 交互 |
| `terminal_*` | CLI 工具在伪终端（xterm.js 回放页）中交互并录制 |

媒体文件的列出与清理通过 CLI 子命令完成：`manta-show recordings` / `manta-show clean`。

所有交互工具接受可选 `sessionId`；不填时操作该类型最近活跃的会话。

## 开源仓库

完整文档与源码见 [marrviin/manta-show](https://github.com/marrviin/manta-show)。

## License

MIT
