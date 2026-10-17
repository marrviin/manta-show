# manta-show

为 AI Agent（Cursor、Claude Code 等）定制的全场景产品媒体捕获 MCP Server。通过代码级控制，自动为**网页、Electron 桌面应用、CLI 工具**生成高画质截图与视频（mp4），用于快速补齐网站和 README 文档。

- **零 OS 级录屏**：全部通过 Chromium 渲染层（Playwright / CDP）采集，无屏幕录制权限、无窗口抖动，CI 可跑
- **零侵入 CLI 捕获**：node-pty 拦截 TTY 文本流，在 xterm.js 回放页中渲染后录制，产出 mp4
- **统一媒体管线**：所有视频统一为 `mp4 (H.264, yuv420p)`；截图直接以 MCP image content 返回
- **面向 Agent 设计**：会话式细粒度工具、可恢复的错误提示、返回体自带 markdown 引用片段

## 安装

```bash
git clone <this-repo> && cd manta-show
pnpm install      # postinstall 会自动执行 playwright install chromium
pnpm build
```

要求：Node ≥ 20、pnpm。CLI 捕获依赖 node-pty（native 模块；macOS 26 上 1.1.0 正式版有 `posix_spawnp failed` 兼容问题，本仓库固定使用 `1.1.0-beta34`）。pnpm 安装时如提示构建脚本许可，确认 `allowBuilds` 中的 electron / node-pty / ffmpeg-static 为 true（见 `pnpm-workspace.yaml`）。

录制视频需要 ffmpeg，按以下顺序自动定位：`MANTA_SHOW_FFMPEG` → PATH 上的 ffmpeg → 依赖自带的 `ffmpeg-static` 全静态构建（默认可用，无需额外安装）。注意：playwright 自带的 ffmpeg 是裁剪版（无 libx264），不能用于本项目。

## 接入 MCP 客户端

Claude Code（项目级 `.mcp.json` 或 `~/.claude.json`）：

```json
{
  "mcpServers": {
    "manta-show": {
      "command": "node",
      "args": ["/absolute/path/to/manta-show/dist/index.js"],
      "env": {
        "MANTA_SHOW_OUTPUT": "/absolute/path/to/your-project/manta-media"
      }
    }
  }
}
```

Cursor（`~/.cursor/mcp.json`）：同样结构。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MANTA_SHOW_OUTPUT` | `./manta-media`（相对 server 启动目录） | 媒体输出目录，建议指向你的文档项目 |
| `MANTA_SHOW_FFMPEG` | 自动定位 | 指定 ffmpeg 可执行文件路径 |

## 工具清单

### 网页（Playwright Chromium，无头，默认 2x 高清）

| 工具 | 说明 |
|---|---|
| `browser_open` | 打开网页，返回 sessionId（url, width=1280, height=800, deviceScaleFactor=2） |
| `browser_navigate` | 会话内跳转 |
| `browser_snapshot` | 可访问性树快照，用于确定选择器 |
| `browser_click` / `browser_hover` | 按 CSS 选择器点击 / 悬停 |
| `browser_type` | 输入文本（可选回车提交） |
| `browser_press_key` / `browser_scroll` | 按键 / 滚动 |
| `browser_evaluate` | 在页面执行 JS 表达式 |
| `browser_screenshot` | 截图（`selector` 元素级裁剪，`fullPage` 整页），返回图片 + 路径 |
| `browser_record_start` / `browser_record_stop` | 录制期间继续交互，stop 产出 mp4；`decorate: 'browser'`（默认）叠加 macOS 浏览器窗框（红绿灯 + 真实 URL 地址栏 + 圆角投影），`'none'` 为原始画面 |
| `browser_close` | 关闭会话 |

典型流程：`browser_open` → `browser_snapshot` 找选择器 → `browser_click`/`browser_type` 交互 → `browser_record_start` → 演示动作 → `browser_record_stop` 拿 mp4 → 把 markdown 引用片段插入 README。

### 命令行工具（node-pty + xterm.js 回放页）

| 工具 | 说明 |
|---|---|
| `terminal_open` | 启动命令并**自动开始录制**（command, args, cwd, cols=100, rows=30）；`decorate: 'terminal'`（默认）叠加终端窗口装饰（红绿灯 + 以命令为标题的标题栏），`'none'` 为原始画面 |
| `terminal_read` | 读最近 N 行渲染后纯文本（去 ANSI），Agent 判断状态用 |
| `terminal_send` / `terminal_send_key` | 输入文本 / 具名按键（enter、ctrl+c、上下左右……） |
| `terminal_record_stop` | 导出 mp4 |
| `terminal_stop` / `terminal_close` | 结束进程 / 释放会话 |

### Electron 应用（Playwright `_electron`）

| 工具 | 说明 |
|---|---|
| `electron_launch` | 启动应用并捕获主窗口（app 为应用目录或入口 js） |
| `electron_snapshot` | 界面可访问性快照 |
| `electron_click` / `electron_type` / `electron_press_key` | 界面交互 |
| `electron_screenshot` | 窗口/元素截图 |
| `electron_record_start` / `electron_record_stop` | 录制 / 导出 mp4；`decorate: 'desktop'`（默认）叠加 macOS 桌面装饰（窗口带圆角投影放在桌面壁纸上，无标题栏），`'none'` 为原始画面。壁纸取自 macOS 26 (Tahoe) 官方壁纸（`assets/macos-wallpaper.jpg`，Apple 版权图像，仅供内部演示使用） |
| `electron_close` | 关闭应用 |

## 会话模型

所有交互工具接受可选 `sessionId`；不填时操作**该类型最近活跃的会话**，Agent 通常不需要手动传。会话空闲 10 分钟自动回收。

## 开发与测试

```bash
pnpm dev      # tsc --watch
pnpm test     # 构建 + e2e（InMemoryTransport 直连，覆盖三条线）
pnpm start    # stdio 方式启动 server
```

e2e 会真实拉起 Chromium / pty / （若安装了 electron devDependency）Electron 应用，产物校验后输出到 `manta-media/`（可在测试环境变量中重定向）。

## 安全说明

`browser_evaluate` 会在页面上下文执行任意 JS、`terminal_open` 会在本机启动任意进程——这是本工具的设计用途（本机开发/文档场景），请在信任的项目中使用。
