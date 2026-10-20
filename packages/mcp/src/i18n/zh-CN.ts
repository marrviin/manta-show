import type { Dictionary } from './en.js';

/** Simplified Chinese dictionary; every key of `en` must be present (compile-enforced). */
export const zhCN: Dictionary = {
  // ---- shared fragments ----
  'common.andEnter': '并回车',

  // ---- util/respond.ts ----
  'respond.saved': '已保存：{file}',
  'respond.markdownRef': 'markdown 引用：![screenshot]({ref})',
  'respond.videoGenerated': '视频已生成：{file}',
  'respond.videoMeta': '时长：{duration}s，帧数：{frames}，格式：mp4 (H.264)',
  'respond.videoLocalRef': '本地文档（IDE 预览 / VS Code README）可直接引用：![demo]({ref})',
  'respond.videoGithubNote':
    '注意：GitHub 网页不渲染本地路径的 mp4。发布到 GitHub 时，请先把视频文件拖拽进 issue / PR 编辑框上传，再用生成的 https://github.com/user-attachments/... 链接替换引用。',

  // ---- tool schema fields (tools/shared.ts) ----
  'field.sessionId': '{kind} 会话 id，缺省用最近的',
  'field.outPath': '输出文件路径，缺省自动保存到 ~/.manta-show/media',
  'field.fit': 'canvas=统一输出 1920×1080（默认）；native=保持录制原始尺寸',
  'field.selector':
    '{purpose}。支持 CSS 与 Playwright 选择器语法，如 text=登录、role=button[name="提交"]、xpath=//nav、#id',
  'field.submit': '输入后是否按回车',
  'field.text': '要输入的文本',
  'field.key': '按键名（Playwright 键名，如 Enter / Tab / ArrowDown）',
  'field.fullPage': '是否截取整页（无 selector 时生效）',
  'field.dy': '垂直滚动像素，正数向下',
  'field.scrollSelector': '滚动到该元素可见',
  'field.scrollDyBatch': '垂直滚动像素（无 selector 时生效，默认 600）',
  'field.scrollSelectorBatch': '滚动到该元素可见',
  'field.steps':
    '批量动作序列（可选）：开始录制后按顺序自动执行，全部完成后自动停止并直接返回 mp4。' +
    '适合编排好的演示；需要在录制中途观察输出再决定下一步时，仍用交互工具 + record_stop。',
  'field.stepGapMs': '批量模式下相邻动作之间的停顿毫秒数（默认 400，给画面留出节奏感）',
  'field.decorate': '{deco}=叠加对应窗框装饰（默认）；none=原始画面',
  'field.cursor':
    'true=在画面中叠加合成鼠标指针（跟随真实移动，点击时有波纹反馈，headless 录制默认看不到光标，推荐开启）',
  'field.script': 'JS 表达式，如 document.title 或 1+1',
  'field.url': '要打开的 URL',
  'field.viewportWidth': '视口宽度',
  'field.viewportHeight': '视口高度',
  'field.deviceScaleFactor': '设备像素比，2 输出高清 2x 图',
  'field.contains': '要等待出现的输出文本（子串），如命令提示符 "$"、构建成功标记、进度百分比',
  'field.timeoutMs': '最长等待毫秒数，默认 30s',
  'field.lines': '返回最近多少行',
  'field.writtenText': '要写入的文本',
  'field.keyName': '按键名，如 enter、ctrl+c',
  'field.command': '要运行的命令，如 npm、python、./my-cli',
  'field.args': '命令参数列表',
  'field.cwd':
    "工作目录，缺省为 MCP server 启动目录；isolation='container' 时该目录会被挂载到容器 /workspace 并作为容器工作目录（CLI 生成的文件可从宿主查看），不传则使用容器自身文件系统（随容器销毁，零残留）",
  'field.env': '附加环境变量（在宿主环境之上合并覆盖）',
  'field.isolation':
    "none=直接在宿主运行（默认）；container=在一次性 Docker 容器中运行（行业标准的临时环境，命令及其所有状态变化与宿主完全隔离，容器用完即弃）。需要本机 Docker。",
  'field.image': "isolation='container' 时的镜像，默认 node:22；演示其他运行时请显式指定",
  'field.volumes':
    "isolation='container' 时的额外挂载（docker 语法 host:container[:ro]），用于向容器注入模拟的全局配置等文件，如 /tmp/demo-gitconfig:/root/.gitconfig",
  'field.cols': '终端列数',
  'field.rows': '终端行数',
  'field.app': '应用目录、入口 js 路径或已安装的 .app 包路径',
  'field.extraArgs': '传给应用的额外参数',
  'field.cwdSimple': '工作目录',

  // ---- selector purposes ----
  'purpose.click': '要点击的元素',
  'purpose.input': '要输入的输入框',
  'purpose.hover': '要悬停的元素',
  'purpose.screenshot': '要截图的元素（可选）',
  'purpose.scroll': '滚动到该元素可见（可选）',

  // ---- tool errors / results ----
  'err.actionFailed': '操作失败：{message}',
  'err.selectorTimeout': '选择器 5 秒内未命中：{selector}。{hint}',
  'err.screenshotFail': '截图失败：{message}',
  'err.evalFail': '执行失败：{message}',
  'err.noRecording': '该会话没有进行中的录制。',
  'err.alreadyRecording': '该会话已在录制中，请先调用 {prefix}_record_stop。',
  'err.recordStopMissing': '该会话没有进行中的录制，请先调用 {prefix}_record_start。',
  'err.batchStopFail': '批量录制停止失败：{message}',
  'err.batchStepFail':
    '批量录制在第 {index}/{total} 步失败：{message}\n' +
    '已停止录制并导出已完成部分（见下方视频信息），修正 steps 后可重试。',
  'result.clicked': '已点击 {selector}。',
  'result.typed': '已在 {selector} 输入文本{enter}。',
  'result.pressed': '已按键 {key}。',
  'result.hovered': '已悬停 {selector}。',
  'result.closed': '已关闭会话 {id}。',

  // ---- shared page tools (web / electron) ----
  'page.snapshot.title': '{label}快照',
  'page.snapshot.desc': '返回{label}的可访问性树 YAML 快照（元素角色、名称、ref），用于确定要点击/输入的选择器。',
  'page.click.title': '点击{label}元素',
  'page.click.desc': '点击{label}中匹配 CSS 选择器的元素。',
  'page.type.title': '输入文本',
  'page.type.desc': '向{label}中的输入框清空并输入文本；submit 为 true 时附加回车。',
  'page.pressKey.title': '按键',
  'page.pressKey.desc': '向{label}发送键盘按键（Playwright 键名，如 Enter / Escape）。',
  'page.hover.title': '悬停',
  'page.hover.desc': '把鼠标悬停在匹配选择器的元素上（用于展示 hover 态、下拉菜单等）。',

  // ---- labels used in shared page tool copy ----
  'label.page': '页面',
  'label.window': '窗口',

  // ---- web tools ----
  'web.selectorHint': '建议先调用 browser_snapshot 查看页面可访问性树，确认选择器后再试。',
  'web.emptySnapshot': '(页面为空)',
  'web.screenshot.title': '网页截图',
  'web.screenshot.desc': '截图当前页面。给 selector 时只截取该元素（适合组件级产品图）；fullPage 截整页。返回图片本体和保存路径。',
  'web.record.start.title': '开始录制',
  'web.record.start.desc':
    '开始录制当前 web 会话的画面。录制期间继续用 browser_* 工具交互，动作都会被录进去。' +
    '传 steps 可在录制中按顺序自动执行一段编排好的动作并自动停止出片（一次调用完成整段演示）。' +
    '默认给视频叠加 macOS 浏览器窗框装饰（红绿灯 + 空白地址栏 + 圆角），像在真实浏览器中录制的效果。',
  'web.record.startedDeco':
    '录制已开始（含浏览器窗框装饰）。视口已自动调整，使「工具栏 + 页面」恰好铺满 1920×1080 画幅；停止录制后恢复原视口。完成交互后调用 browser_record_stop 导出 mp4。',
  'web.record.startedRaw': '录制已开始（原始画面）。完成交互后调用 browser_record_stop 导出 mp4。',
  'web.record.stop.title': '结束录制',
  'web.record.stop.desc': '停止录制并合成 mp4（默认统一输出 1920×1080），返回文件路径、时长与 markdown 引用片段。',
  'web.close.title': '关闭会话',
  'web.close.desc': '关闭 web 会话并释放浏览器资源（未 stop 的录制会自动落盘保存）。',
  'web.open.title': '打开网页',
  'web.open.desc': '在无头 Chromium 中打开一个网页，返回 web 会话 id。后续用 browser_* 工具与之交互（缺省操作最近打开的会话）。',
  'web.open.loadNote': '（提示：页面 30 秒内未触发 load 事件，已返回当前已渲染内容；如需等待可再调用 browser_evaluate 轮询）',
  'web.open.loadFail': '页面加载失败：{message}',
  'web.open.result':
    '已打开 {url}（标题：{title}）。sessionId={id}{note}\n' +
    '接下来可用：browser_snapshot / browser_click / browser_type / browser_screenshot / browser_record_start。',
  'web.navigate.title': '页面跳转',
  'web.navigate.desc': '让当前 web 会话导航到新 URL。',
  'web.navigate.result': '已跳转到 {url}。',
  'web.navigate.resultWithTitle': '已跳转到 {url}（标题：{title}）。',
  'web.scroll.title': '滚动',
  'web.scroll.desc': '给出 selector 时滚动到该元素可见；否则按 dy 像素滚动页面。',
  'web.scroll.to': '已滚动到 {selector}。',
  'web.scroll.px': '已滚动 {px}px。',
  'web.evaluate.title': '执行页面 JS',
  'web.evaluate.desc': '在页面上下文执行一段 JS 表达式并返回结果（JSON 序列化）。注意：会真实改动页面。',
  'web.evaluate.noReturn': '(无返回值)',

  // ---- electron tools ----
  'electron.selectorHint': '建议先调用 electron_snapshot 查看界面可访问性树。',
  'electron.emptySnapshot': '(窗口无可访问性内容)',
  'electron.screenshot.title': '应用截图',
  'electron.screenshot.desc': '截取 Electron 窗口或指定元素，返回图片本体和保存路径。',
  'electron.record.start.title': '开始录制应用画面',
  'electron.record.start.desc':
    '开始录制 Electron 主窗口画面。录制期间继续交互，动作会被录进去。' +
    '传 steps 可在录制中按顺序自动执行一段编排好的动作并自动停止出片（一次调用完成整段演示）。' +
    '默认给视频叠加 macOS 桌面装饰（应用窗口带圆角投影，放在桌面壁纸上），像在电脑上使用的实拍效果。',
  'electron.record.startedDeco': '录制已开始（含 macOS 桌面装饰）。完成交互后调用 electron_record_stop 导出 mp4。',
  'electron.record.startedRaw': '录制已开始（原始画面）。完成交互后调用 electron_record_stop 导出 mp4。',
  'electron.record.stop.title': '结束录制应用画面',
  'electron.record.stop.desc': '停止录制并合成 mp4（默认统一输出 1920×1080），返回文件路径与 markdown 引用片段。',
  'electron.close.title': '关闭应用',
  'electron.close.desc': '关闭 Electron 应用并释放资源。',
  'electron.launch.title': '启动 Electron 应用',
  'electron.launch.desc':
    '用 Playwright 的 _electron API 启动一个 Electron 应用并捕获其主窗口，返回 electron 会话 id。' +
    'app 支持三种形式：应用目录（含 package.json，用本地 electron 运行）、入口 js 文件路径、' +
    '或已安装的 macOS .app 包（如 /Applications/SomeApp.app，直接自动化打包产物）。',
  'electron.launch.fail':
    '启动 Electron 应用失败：{message}。' +
    '源码应用需已安装 electron 依赖；打包 app 若拒绝调试参数（签名加固/单实例锁）则无法自动化。',
  'electron.launch.result':
    '已启动并捕获主窗口（标题：{title}）。sessionId={id}\n' +
    '可用：electron_snapshot / electron_click / electron_type / electron_screenshot / electron_record_start。',
  'electron.bundleNotFound': '在 {bundle} 中找不到可执行文件 Contents/MacOS/{name}，请确认是有效的 macOS 应用包。',

  // ---- cli tools ----
  'cli.open.title': '运行终端命令并开始录制',
  'cli.open.desc':
    '在 pty 中启动一个命令行程序，同时打开 xterm.js 回放页并开始录制画面。返回 cli 会话 id。' +
    '用 terminal_read 读取输出、terminal_send 模拟交互，完成后用 terminal_record_stop 导出 mp4。' +
    '注意：这里启动的命令本身不会出现在画面中（它是被运行的，不是被输入的）；' +
    '若要演示“命令被敲入并执行”的过程，请先 open 一个交互 shell（如 command="bash"、args=["-i"]），再用 terminal_send 发送命令。',
  'cli.open.noRuntime':
    "isolation='container' 需要可用的容器运行时（Docker 或 Podman），未检测到。" +
    '未安装：brew install colima docker（纯 CLI，无需 GUI App）或 brew install --cask orbstack；' +
    '装好后运行 manta-show doctor 复核；不需要隔离时去掉 isolation 参数即可直接在宿主运行。',
  'cli.open.daemonDown':
    '容器运行时已安装但引擎未启动：运行 colima start 或 podman machine start' +
    '（OrbStack 打开 App 即可，调用 docker 时也会自动启动）。' +
    '启动后运行 manta-show doctor 复核；不需要隔离时去掉 isolation 参数即可直接在宿主运行。',
  'cli.open.startFail': '启动命令失败：{message}',
  'cli.open.result':
    '已在 pty 中启动 {command}{note} 并开始录制。sessionId={id}\n' +
    '可用：terminal_read（看输出）、terminal_send / terminal_send_key（交互）、terminal_record_stop（导出 mp4）、terminal_stop（结束进程）。',
  'cli.open.containerNote': '（isolation=container，镜像 {image}，容器退出即销毁）',
  'cli.open.shellHint':
    '\n提示：命令本身不会出现在画面中；若要演示命令的输入过程，改为 open 交互 shell（bash -i）后用 terminal_send 发送。',
  'cli.open.fitNote':
    '\n终端已自动调整为 {cols}×{rows}，使带装饰的窗口恰好铺满 1920×1080 画幅（文字 1:1 清晰）。',
  'cli.read.title': '读取终端输出',
  'cli.read.desc': '返回终端最近 N 行渲染后的纯文本（已去除 ANSI 颜色码），供 Agent 判断当前状态。',
  'cli.send.title': '向终端输入文本',
  'cli.send.desc': '向正在运行的命令写入文本（不换行）；submit 为 true 时附加回车。',
  'cli.send.result': '已写入{enter}。',
  'cli.sendKey.title': '向终端发送按键',
  'cli.sendKey.desc':
    '发送具名按键：enter、tab、esc、backspace、up/down/left/right、home/end、pageup/pagedown、ctrl+c、ctrl+d、ctrl+l、ctrl+u、ctrl+w、ctrl+z 等。',
  'cli.sendKey.unknown': '未知按键 "{key}"。可用：enter/esc/tab/ctrl+c/上下左右等。',
  'cli.sendKey.result': '已发送 {key}。',
  'cli.wait.title': '等待终端输出',
  'cli.wait.desc':
    '阻塞等待终端输出中出现指定文本（子串匹配，已忽略 ANSI 颜色码），出现、进程退出或超时后返回，附最近输出。' +
    '比反复调用 terminal_read 轮询更省轮次，也不会读到半截输出。',
  'cli.wait.matched': '✓ 输出中已出现「{needle}」',
  'cli.wait.exited': '进程已退出，输出中未出现「{needle}」',
  'cli.wait.timeout': '⏱ 等待超时（{ms}ms），输出中未出现「{needle}」',
  'cli.recordStop.title': '导出终端录制',
  'cli.recordStop.desc': '停止终端画面录制并合成 mp4（默认统一输出 1920×1080），返回文件路径与 markdown 引用片段。',
  'cli.stop.title': '结束终端进程',
  'cli.stop.desc': '向终端进程发送 Ctrl+C，等待退出（超时强杀），返回退出码。会话保留，可 terminal_close 释放。',
  'cli.stop.result': '终端进程已结束，退出码：{code}。',
  'cli.close.title': '关闭终端会话',
  'cli.close.desc': '结束终端进程、关闭回放页并释放资源。',

  // ---- session store ----
  'session.notFound': '未找到 {kind} 会话 "{id}"（该类型活跃会话：{known}）。请先调用对应的 open/launch 工具。',
  'session.none': '无',
  'session.noActive':
    '当前没有活跃的 {kind} 会话。会话闲置超过 10 分钟会被自动回收；如之前打开过，请重新调用对应的 open/launch 工具。',

  // ---- browser target ----
  'browser.launchFail': '启动 Chromium 失败：{message}。请先运行 npx playwright install chromium',

  // ---- recorder / encode pipeline ----
  'recorder.noFrames': '没有捕获到任何画面帧。请确认录制窗口内有交互或动画后重试。',
  'recorder.decorationSizeFail': '无法解析录制帧尺寸，跳过窗框装饰',
  'decoration.renderFail': '渲染窗框装饰失败：{message}',
  'terminal.noOutput': '(暂无输出)',
  'encode.notLocated': 'ffmpeg 未定位，请先调用 locateFfmpeg',
  'encode.spawnFail': 'ffmpeg 启动失败（{bin}）：{message}',
  'encode.exitCode': 'ffmpeg 退出码 {code}：{tail}',

  // ---- ffmpeg deps ----
  'ffmpeg.missing': '未找到 ffmpeg，无法录制视频。请安装 ffmpeg（brew install ffmpeg）或通过 MANTA_SHOW_FFMPEG 指定路径。',
  'ffmpeg.shaMismatch': 'sha256 校验失败（期望 {expected}…，实际 {actual}…），已丢弃该下载',
  'ffmpeg.downloadFail': 'ffmpeg 下载失败（已尝试 {count} 个源）：{message}',

  // ---- entrypoint CLI (index.ts) ----
  'cliEntry.help':
    'manta-show - 为 AI Agent 服务的 MCP server：捕获网页、Electron 应用与命令行工具的截图和视频。\n' +
    '\n' +
    '用法：manta-show [选项]\n' +
    '\n' +
    '选项：\n' +
    '  -v, --version    打印版本并退出\n' +
    '  -h, --help       显示本帮助并退出\n' +
    '  init             检测已安装的 AI Agent（Claude Code、Cursor、\n' +
    '                   Gemini CLI、Codex、JoyCode）并把 manta-show MCP\n' +
    '                   server 写入它们的配置\n' +
    '  doctor [--deep]  检查本地环境（Node、ffmpeg、Chromium、输出目录、MCP\n' +
    '                   配置）并交互式修复问题；--deep 额外做一次真实采集\n' +
    '                   实测（截图 + mp4）\n' +
    '  recordings       列出输出目录中最近的媒体产物\n' +
    '                   （--last 只看最新一个，--open 打开它）\n' +
    '  clean            查看输出目录占用；用 --older-than 7d（或 24h / 30m）\n' +
    '                   或 --all 删除；加 -y 跳过确认\n' +
    '  set              持久化环境变量覆盖（可重复的 --env KEY=VALUE）到\n' +
    '                   ~/.manta-show/config.json，例如 set --env\n' +
    '                   MANTA_SHOW_LANG=zh-CN；不带参数的 set 列出已保存值。\n' +
    '                   仅允许 MANTA_SHOW_* 与 PLAYWRIGHT_DOWNLOAD_HOST\n' +
    '\n' +
    '不带选项时，在 stdio 上启动 MCP server。',
  'cliEntry.unknownArg': '[manta-show] 未知参数 "{arg}"，已忽略。用 --help 查看可用参数。',
  'cliEntry.started': '[manta-show] MCP server 已启动（stdio）',
  'banner.tagline': '为 AI Agent 提供的采集工具集',

  // ---- server instructions ----
  'server.instructions':
    'manta-show：为产品文档捕获高画质媒体。三条能力线：\n' +
    '1. 网页：browser_open → browser_snapshot 确定选择器 → browser_click/type/hover 交互 → browser_screenshot（selector 可做组件级截图）/ browser_record_start+record_stop 录 mp4。\n' +
    '2. 命令行工具：terminal_open 启动并录制 → terminal_read 看输出 → terminal_send/terminal_send_key 交互（terminal_wait 可阻塞等待输出出现） → terminal_record_stop 导出 mp4。\n' +
    '3. Electron 应用：electron_launch → electron_snapshot/click/screenshot → electron_record_start/stop。\n' +
    '选择器支持 Playwright 语法（text=、role= 等）。录制工具传 steps 可批量执行编排动作并自动出片；所有视频统一输出 mp4 (H.264)；截图直接以图片返回。\n' +
    '产物统一保存在 ~/.manta-show/media（web/terminal/electron 前缀区分来源）；会话闲置 10 分钟自动回收，录制默认带合成鼠标指针与窗框装饰。',

  // ---- doctor ----
  'doctor.group.deps': '环境依赖',
  'doctor.group.output': '输出与接入',
  'doctor.group.pipeline': '采集管线',
  'doctor.name.node': 'Node.js',
  'doctor.name.ffmpeg': 'ffmpeg',
  'doctor.name.chromium': 'Chromium',
  'doctor.name.container': '容器运行时',
  'doctor.name.outputDir': '输出目录',
  'doctor.name.mcpConfig': 'MCP 配置',
  'doctor.name.screenshotPipeline': '截图管线',
  'doctor.name.videoPipeline': '视频管线',
  'doctor.node.summary': 'v{version}（要求 >= 20）',
  'doctor.node.hint': '请升级 Node.js（如 nvm install 20 && nvm use 20）后重装 manta-show',
  'doctor.outputDir.writable': '{dir} 可写',
  'doctor.outputDir.notWritable': '{dir} 不可写（{message}）',
  'doctor.outputDir.hint': '检查目录权限',
  'doctor.mcp.none': '未检测到已安装的 AI Agent（安装后运行 manta-show init 即可接入）',
  'doctor.mcp.configured': '已配置：{names}',
  'doctor.mcp.noneConfigured': '尚无已配置的 Agent',
  'doctor.mcp.missing': '；未配置：{names}',
  'doctor.mcp.mismatch': '；配置与标准不一致：{names}',
  'doctor.mcp.broken': '；配置文件无法解析：{names}',
  'doctor.mcp.staleHint': '{agent}：已记录命令 = {actual}，标准 = {expected}',
  'doctor.mcp.brokenHint': '{agent}：{path} 解析失败 —— 请手动修复该 JSON',
  'doctor.mcp.repairDesc': '重写为标准 MCP 配置',
  'doctor.mcp.fixDescBoth': '重写过期配置并补全缺失配置',
  'doctor.mcp.fixDesc': 'manta-show init（写入缺失的 MCP 配置）',
  'doctor.intro': '环境体检与自动修复',
  'doctor.intro.deep': '环境体检与自动修复（含采集管线实测）',
  'doctor.checking': '正在检查运行环境…',
  'doctor.checkingItem': '正在检查 {name} …',
  'doctor.deepTesting': '正在实测采集管线…',
  'doctor.screenshot.empty': '截图文件为空',
  'doctor.screenshot.ok': 'Chromium 渲染 + 截图正常',
  'doctor.screenshot.skipNoChromium': '已跳过 —— Chromium 未安装（先修复上方问题再重试）',
  'doctor.video.skip': '已跳过 —— 未找到 ffmpeg',
  'doctor.video.empty': '编码产物为空',
  'doctor.video.ok': 'ffmpeg 编码正常（{source}）',
  'doctor.video.source.localBinary': '本地二进制',
  'doctor.video.hint': '终端录制合成 mp4 依赖 ffmpeg，请检查安装或 MANTA_SHOW_FFMPEG 设置',
  'doctor.done': '检查完成',
  'doctor.doneIssues': '检查完成，发现 {count} 个问题',
  'doctor.allGood': '一切正常',
  'doctor.rerun': '如仍有问题，请重新运行 manta-show doctor 复核',

  // ---- cli/deps.ts ----
  'deps.downloadHints.chromium': '约 170 MB，走 npmmirror 镜像加速，一次性下载',
  'deps.downloadHints.ffmpeg': '约 30-80 MB（按平台），npmmirror 镜像优先',
  'deps.downloadHints.default': '需下载安装',
  'deps.progress.download': '下载中 {received}/{total} {unit}',
  'deps.installer.spawnFail': '无法启动 playwright 安装器：{message}',
  'deps.installer.exitCode':
    'playwright install chromium 退出码 {code}（网络受限时可设置 PLAYWRIGHT_DOWNLOAD_HOST 指向可用镜像）',
  'deps.ffmpegSource.wellKnown': 'Homebrew（系统安装）',
  'deps.ffmpegSource.managed': '~/.manta-show/bin（init/doctor 下载）',
  'deps.ffmpegSource.bundled': '内置（@manta-show/ffmpeg-{platform}-{arch}）',
  'deps.ffmpeg.notFound': '未找到 —— 视频录制合成 mp4 需要',
  'deps.ffmpeg.hint': '也可以 brew install ffmpeg 或设置 MANTA_SHOW_FFMPEG 指向已有二进制',
  'deps.ffmpeg.fixDesc': '下载 ffmpeg 到 ~/.manta-show/bin（npmmirror 镜像优先）',
  'deps.progress.downloading': '下载中 {received}/{total}',
  'deps.progress.downloaded': '已下载 {received}',
  'deps.chromium.installedFallback': '已安装',
  'deps.chromium.notInstalled': '未安装 —— 浏览器 / 终端回放页 / Electron 采集都需要',
  'deps.chromium.fixDesc': '下载 Chromium（playwright install chromium）',
  'deps.container.summary': '{runtime}（{bin}）',
  'deps.container.pathLabel': 'PATH',
  'deps.container.notInstalled': '未安装 —— 可选，仅容器隔离（isolation: container）需要',
  'deps.container.hint':
    '未安装时：brew install colima docker（纯 CLI）或 brew install --cask orbstack；已安装但引擎未启动：colima start / podman machine start / 打开 OrbStack',
  'deps.fix.nonInteractive': '非交互环境，跳过自动修复；请在终端手动运行 manta-show doctor',
  'deps.fix.confirm': '自动修复「{name}」？（将执行 {desc}）',
  'deps.fix.cancelled': '已取消',
  'deps.fix.skipped': '已跳过「{name}」',
  'deps.fix.running': '执行 {desc} …',
  'deps.fix.done': '✓ 修复完成',
  'deps.fix.failed': '✗ 修复失败：{message}',
  'deps.setup.complete': '依赖完整，所有捕获能力开箱可用',
  'deps.setup.confirm': '缺少依赖：{plan}。现在自动下载安装？',
  'deps.setup.skipped': '已跳过安装；之后可随时运行 manta-show doctor 完成下载',
  'deps.setup.warnNonInteractive': '非交互环境，跳过自动安装；请在终端运行 manta-show doctor 完成下载',
  'deps.setup.installing': '安装 {name}…',
  'deps.setup.itemProgress': '{name}：{msg}',
  'deps.setup.installed': '✓ {name} 安装完成',
  'deps.setup.installFailed': '✗ {name} 安装失败：{message}',
  'deps.setup.ready': '依赖已就绪，所有捕获能力开箱可用',
  'deps.setup.stillMissing': '部分依赖仍缺失，可运行 manta-show doctor 复核修复',

  // ---- clean ----
  'clean.needDuration': '--older-than 需要一个时长参数，例如 --older-than 7d / 24h / 30m',
  'clean.empty': '输出目录 {dir} 中没有媒体产物',
  'clean.summary':
    '输出目录 {dir}：{count} 个产物，共 {size}（最早 {date}）' +
    '\n\n删除方式：' +
    '\n  manta-show clean --older-than 7d    删除 7 天前的产物（也支持 24h / 30m）' +
    '\n  manta-show clean --all              清空全部产物' +
    '\n  追加 -y 跳过确认',
  'clean.nothing': '没有符合条件的产物，无需清理',
  'clean.aborted': '非交互环境已中止；如确认请加 -y：将删除 {count} 个产物（{size}）',
  'clean.confirm': '删除 {count} 个产物（{size}）？此操作不可恢复',
  'clean.cancelled': '已取消',
  'clean.deleted': '已删除 {count} 个产物，释放 {size}',
  'clean.deletedWithErrors': '删除完成：{deleted} 个成功，{failed} 个失败（文件可能正被占用）',

  // ---- recordings ----
  'recordings.justNow': '刚刚',
  'recordings.minAgo': '{n} 分钟前',
  'recordings.hoursAgo': '{n} 小时前',
  'recordings.yesterday': '昨天 {time}',
  'recordings.openFail': '无法打开 {target}（未找到 {cmd} 命令）',
  'recordings.empty': '输出目录 {dir} 中还没有媒体产物（截图 / 视频会保存在这里）',
  'recordings.last': '最近一次产物',
  'recordings.list': '最近产物（{count} 个，共 {size}）',
  'recordings.limit': '仅显示最新 {n} 个，可用 -n <数量> 调整',

  // ---- init ----
  'init.parseFail': '配置文件解析失败：{path}（{message}）',
  'init.intro': '为已安装的 AI Agent 配置 MCP',
  'init.notDetected': '{name}：未检测到，跳过',
  'init.added': '{name}：已写入 {server} MCP 配置',
  'init.exists': '{name}：已存在配置，跳过',
  'init.agentError': '{name}：{message}',
  'init.outro': '完成：新写入 {installed} 个，已有配置跳过 {skipped} 个。重启对应 Agent 后即可使用 manta-show 的 MCP 工具。',

  // ---- set（持久化环境变量覆盖）----
  'set.saved': '环境变量已保存到 {path}：\n{entries}',
  'set.help':
    'manta-show set — 持久化 manta-show 的环境变量覆盖\n' +
    '\n' +
    '用法：manta-show set --env KEY=VALUE [--env KEY=VALUE ...]\n' +
    '\n' +
    '示例：\n' +
    '  manta-show set --env MANTA_SHOW_LANG=zh-CN\n' +
    '  manta-show set --env MANTA_SHOW_FFMPEG=/opt/homebrew/bin/ffmpeg --env MANTA_SHOW_DEBUG=1\n' +
    '\n' +
    '说明：\n' +
    '  值保存在 ~/.manta-show/config.json，每次启动时自动应用\n' +
    '  （MCP server 与 CLI 子命令均生效）。\n' +
    '  仅允许设置 MANTA_SHOW_* 变量与 PLAYWRIGHT_DOWNLOAD_HOST。\n' +
    '  MANTA_SHOW_LANG 支持 en / zh-CN。\n' +
    '  真实环境变量优先于已保存值。',
  'set.unknownArg': '未知参数 "{arg}"。用法：manta-show set --env KEY=VALUE',
  'set.invalidFormat': '--env 需要 KEY=VALUE 格式，收到 "{arg}"',
  'set.invalidKey': '不支持的变量 "{key}"：仅允许设置 MANTA_SHOW_* 与 PLAYWRIGHT_DOWNLOAD_HOST',
  'set.invalidValue': '无效的 MANTA_SHOW_LANG 值 "{value}"；支持：en、zh-CN',

  // ---- i18n itself ----
  'i18n.unsupportedLang': '[manta-show] 不支持的 MANTA_SHOW_LANG 值 "{value}"，已回退到 "en"（支持：en、zh-CN）',
};
