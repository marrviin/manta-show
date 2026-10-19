/**
 * English dictionary (source of truth). Every other locale must provide a value for every key
 * here (typed via Record<keyof typeof en, string>), so a missing translation is a compile error.
 */
export const en = {
  // ---- shared fragments ----
  'common.andEnter': ' and pressed Enter',

  // ---- util/respond.ts ----
  'respond.saved': 'Saved: {file}',
  'respond.markdownRef': 'markdown reference: ![screenshot]({ref})',
  'respond.videoGenerated': 'Video generated: {file}',
  'respond.videoMeta': 'Duration: {duration}s, frames: {frames}, format: mp4 (H.264)',
  'respond.videoLocalRef':
    'For local docs (IDE preview / VS Code README), embed directly: ![demo]({ref})',
  'respond.videoGithubNote':
    'Note: the GitHub website does not render mp4 from local paths. When publishing to GitHub, drag the video file into the issue / PR editor to upload it first, then replace the reference with the generated https://github.com/user-attachments/... link.',

  // ---- tool schema fields (tools/shared.ts) ----
  'field.sessionId': '{kind} session id; defaults to the most recent',
  'field.outPath': 'Output file path; auto-saved to ~/.manta-show/media by default',
  'field.fit': 'canvas=unified 1920×1080 output (default); native=keep the recording’s original size',
  'field.selector':
    '{purpose}. Supports CSS and Playwright selector syntax, e.g. text=Login, role=button[name="Submit"], xpath=//nav, #id',
  'field.submit': 'Press Enter after typing',
  'field.text': 'Text to type',
  'field.key': 'Key name (Playwright key names, e.g. Enter / Tab / ArrowDown)',
  'field.fullPage': 'Capture the full scrollable page (applies when no selector)',
  'field.dy': 'Vertical scroll pixels, positive scrolls down',
  'field.scrollSelector': 'Scroll to make this element visible',
  'field.scrollDyBatch': 'Vertical scroll pixels (applies when no selector; default 600)',
  'field.scrollSelectorBatch': 'Scroll to make this element visible',
  'field.steps':
    'Batch action sequence (optional): executed in order after recording starts; recording auto-stops and returns the mp4 when all steps finish. ' +
    'Good for choreographed demos; when you need to watch output mid-recording before deciding the next move, use the interactive tools + record_stop instead.',
  'field.stepGapMs':
    'Pause in milliseconds between batch actions (default 400, gives the demo some rhythm)',
  'field.decorate': '{deco}=overlay the matching window decoration (default); none=raw frames',
  'field.cursor':
    'true=composite a synthetic mouse cursor into the frames (follows real movement, ripple feedback on click; headless recording shows no cursor by default, so keeping this on is recommended)',
  'field.script': 'JS expression, e.g. document.title or 1+1',
  'field.url': 'URL to open',
  'field.viewportWidth': 'Viewport width',
  'field.viewportHeight': 'Viewport height',
  'field.deviceScaleFactor': 'Device pixel ratio; 2 outputs a crisp 2x image',
  'field.contains':
    'Output text to wait for (substring), e.g. a shell prompt "$", a build-success marker, a progress percentage',
  'field.timeoutMs': 'Max wait in milliseconds, default 30s',
  'field.lines': 'How many recent lines to return',
  'field.writtenText': 'Text to write',
  'field.keyName': 'Key name, e.g. enter, ctrl+c',
  'field.command': 'Command to run, e.g. npm, python, ./my-cli',
  'field.args': 'Command argument list',
  'field.cwd':
    'Working directory; defaults to the MCP server’s startup directory. With isolation=\'container\' the directory is mounted at /workspace and becomes the container’s working directory (files the CLI generates remain visible from the host); omit to use the container’s own filesystem (destroyed with the container, zero residue)',
  'field.env': 'Extra environment variables (merged on top of the host environment)',
  'field.isolation':
    'none=run directly on the host (default); container=run in a one-shot Docker container (the industry-standard ephemeral environment; the command and all its state changes are fully isolated from the host, and the container is discarded when done). Requires a local Docker.',
  'field.image':
    'Image used when isolation=\'container\'; default node:22. Specify explicitly to demo other runtimes',
  'field.volumes':
    'Extra mounts when isolation=\'container\' (docker syntax host:container[:ro]), e.g. to inject a mock global config: /tmp/demo-gitconfig:/root/.gitconfig',
  'field.cols': 'Terminal columns',
  'field.rows': 'Terminal rows',
  'field.app': 'App directory, entry js path, or installed .app bundle path',
  'field.extraArgs': 'Extra args passed to the app',
  'field.cwdSimple': 'Working directory',

  // ---- selector purposes ----
  'purpose.click': 'Element to click',
  'purpose.input': 'Input box to type into',
  'purpose.hover': 'Element to hover',
  'purpose.screenshot': 'Element to screenshot (optional)',
  'purpose.scroll': 'Scroll to make this element visible (optional)',

  // ---- tool errors / results ----
  'err.actionFailed': 'Operation failed: {message}',
  'err.selectorTimeout': 'Selector did not match within 5s: {selector}. {hint}',
  'err.screenshotFail': 'Screenshot failed: {message}',
  'err.evalFail': 'Evaluation failed: {message}',
  'err.noRecording': 'No recording in progress for this session.',
  'err.alreadyRecording': 'This session is already recording; call {prefix}_record_stop first.',
  'err.recordStopMissing': 'No recording in progress; call {prefix}_record_start first.',
  'err.batchStopFail': 'Failed to stop the batch recording: {message}',
  'err.batchStepFail':
    'Batch recording failed at step {index}/{total}: {message}\n' +
    'Recording stopped and the completed part exported (see video info below); fix the steps and retry.',
  'result.clicked': 'Clicked {selector}.',
  'result.typed': 'Typed text into {selector}{enter}.',
  'result.pressed': 'Pressed {key}.',
  'result.hovered': 'Hovered {selector}.',
  'result.closed': 'Closed session {id}.',

  // ---- shared page tools (web / electron) ----
  'page.snapshot.title': '{label} snapshot',
  'page.snapshot.desc':
    'Returns the accessibility tree YAML snapshot of the {label} (element roles, names, refs) for finding selectors to click/type.',
  'page.click.title': 'Click {label} element',
  'page.click.desc': 'Click the element matching a CSS selector in the {label}.',
  'page.type.title': 'Type text',
  'page.type.desc':
    'Clear the input in the {label} and type text; press Enter afterwards when submit is true.',
  'page.pressKey.title': 'Press key',
  'page.pressKey.desc': 'Send a named keyboard key to the {label} (Playwright key names, e.g. Enter / Escape).',
  'page.hover.title': 'Hover',
  'page.hover.desc':
    'Hover the mouse over the element matching the selector (to show hover states, dropdown menus, etc.).',

  // ---- labels used in shared page tool copy ----
  'label.page': 'page',
  'label.window': 'window',

  // ---- web tools ----
  'web.selectorHint':
    'Try browser_snapshot first to view the page’s accessibility tree, confirm the selector, then retry.',
  'web.emptySnapshot': '(page is empty)',
  'web.screenshot.title': 'Webpage screenshot',
  'web.screenshot.desc':
    'Screenshot the current page. With selector, capture only that element (component-level product shots); fullPage captures the whole scrollable page. Returns the image itself plus the save path.',
  'web.record.start.title': 'Start recording',
  'web.record.start.desc':
    'Start recording the current web session. Keep interacting with browser_* tools during recording; every action is captured. ' +
    'Pass steps to run a choreographed sequence in order during recording and auto-stop into a video (a whole demo in one call). ' +
    'By default the video gets a macOS browser-window decoration (traffic lights + blank address bar + rounded corners), like a real browser recording.',
  'web.record.startedDeco':
    'Recording started (with browser window decoration). The viewport was auto-sized so the window composes to a full 1920×1080 frame; the original viewport is restored on stop. Call browser_record_stop when done to export the mp4.',
  'web.record.startedRaw':
    'Recording started (raw frames). Call browser_record_stop when done to export the mp4.',
  'web.record.stop.title': 'Stop recording',
  'web.record.stop.desc':
    'Stop recording and assemble the mp4 (unified 1920×1080 output by default); returns the file path, duration and a markdown reference snippet.',
  'web.close.title': 'Close session',
  'web.close.desc':
    'Close the web session and release browser resources (an unstopped recording is flushed to disk automatically).',
  'web.open.title': 'Open webpage',
  'web.open.desc':
    'Open a webpage in headless Chromium and return the web session id. Interact afterwards with browser_* tools (they default to the most recently opened session).',
  'web.open.loadNote':
    ' (Note: the page did not fire load within 30s; returning the currently rendered content. Call browser_evaluate to poll if you need to wait)',
  'web.open.loadFail': 'Page load failed: {message}',
  'web.open.result':
    'Opened {url} (title: {title}). sessionId={id}{note}\n' +
    'Next: browser_snapshot / browser_click / browser_type / browser_screenshot / browser_record_start.',
  'web.navigate.title': 'Navigate',
  'web.navigate.desc': 'Navigate the current web session to a new URL.',
  'web.navigate.result': 'Navigated to {url}.',
  'web.navigate.resultWithTitle': 'Navigated to {url} (title: {title}).',
  'web.scroll.title': 'Scroll',
  'web.scroll.desc': 'With selector, scroll the element into view; otherwise scroll the page by dy pixels.',
  'web.scroll.to': 'Scrolled to {selector}.',
  'web.scroll.px': 'Scrolled {px}px.',
  'web.evaluate.title': 'Run page JS',
  'web.evaluate.desc':
    'Evaluate a JS expression in the page context and return the result (JSON serialized). Note: this really mutates the page.',
  'web.evaluate.noReturn': '(no return value)',

  // ---- electron tools ----
  'electron.selectorHint': 'Try electron_snapshot first to view the UI accessibility tree.',
  'electron.emptySnapshot': '(window has no accessibility content)',
  'electron.screenshot.title': 'App screenshot',
  'electron.screenshot.desc':
    'Screenshot the Electron window or a specific element; returns the image itself plus the save path.',
  'electron.record.start.title': 'Start app recording',
  'electron.record.start.desc':
    'Start recording the Electron main window. Keep interacting during recording; every action is captured. ' +
    'Pass steps to run a choreographed sequence in order during recording and auto-stop into a video (a whole demo in one call). ' +
    'By default the video gets a macOS desktop decoration (app window with rounded corners and drop shadow on the wallpaper), like real desktop usage.',
  'electron.record.startedDeco':
    'Recording started (with macOS desktop decoration). Call electron_record_stop when done to export the mp4.',
  'electron.record.startedRaw':
    'Recording started (raw frames). Call electron_record_stop when done to export the mp4.',
  'electron.record.stop.title': 'Stop app recording',
  'electron.record.stop.desc':
    'Stop recording and assemble the mp4 (unified 1920×1080 output by default); returns the file path and a markdown reference snippet.',
  'electron.close.title': 'Close app',
  'electron.close.desc': 'Close the Electron app and release resources.',
  'electron.launch.title': 'Launch Electron app',
  'electron.launch.desc':
    'Launch an Electron app via Playwright’s _electron API and capture its main window; returns the electron session id. ' +
    'app accepts three forms: an app directory (with package.json, run with the local electron), an entry js file path, ' +
    'or an installed macOS .app bundle (e.g. /Applications/SomeApp.app, automating the packaged build).',
  'electron.launch.fail':
    'Failed to launch the Electron app: {message}. ' +
    'Source apps need electron dependencies installed; packaged apps that reject debug args (hardened signing / single-instance lock) cannot be automated.',
  'electron.launch.result':
    'Launched and captured the main window (title: {title}). sessionId={id}\n' +
    'Next: electron_snapshot / electron_click / electron_type / electron_screenshot / electron_record_start.',
  'electron.bundleNotFound':
    'Executable Contents/MacOS/{name} not found in {bundle}; make sure it is a valid macOS app bundle.',

  // ---- cli tools ----
  'cli.open.title': 'Run a terminal command and start recording',
  'cli.open.desc':
    'Start a command-line program in a pty, open the xterm.js replay page and start recording. Returns the cli session id. ' +
    'Use terminal_read to watch output, terminal_send to interact, and terminal_record_stop to export the mp4 when done. ' +
    'Note: the launched command itself is not shown on screen (it is being run, not typed); ' +
    'to demo "a command being typed and executed", open an interactive shell first (command="bash", args=["-i"]) and send the command via terminal_send.',
  'cli.open.noRuntime':
    'isolation=\'container\' needs an available container runtime (Docker or Podman); none detected. ' +
    'Not installed: brew install colima docker (pure CLI, no GUI app needed) or brew install --cask orbstack; ' +
    'after installing run manta-show doctor to re-check. Without isolation, drop the isolation parameter to run on the host directly.',
  'cli.open.daemonDown':
    'Container runtime installed but the engine is not running: run colima start or podman machine start ' +
    '(with OrbStack just open the app; calling docker also auto-starts it). ' +
    'After starting run manta-show doctor to re-check. Without isolation, drop the isolation parameter to run on the host directly.',
  'cli.open.startFail': 'Failed to start the command: {message}',
  'cli.open.result':
    'Started {command} in a pty{note} and started recording. sessionId={id}\n' +
    'Available: terminal_read (watch output), terminal_send / terminal_send_key (interact), terminal_record_stop (export mp4), terminal_stop (end the process).',
  'cli.open.containerNote':
    ' (isolation=container, image {image}, container is destroyed on exit)',
  'cli.open.shellHint':
    '\nHint: the command itself is not shown on screen; to demo typing the command, open an interactive shell (bash -i) instead and send it via terminal_send.',
  'cli.open.fitNote':
    '\nTerminal auto-sized to {cols}×{rows} so the decorated window composes to a full 1920×1080 frame (crisp 1:1 text).',
  'cli.read.title': 'Read terminal output',
  'cli.read.desc':
    'Returns the last N lines of rendered terminal text (ANSI colors stripped) so the Agent can judge the current state.',
  'cli.send.title': 'Write to terminal',
  'cli.send.desc': 'Write text to the running command (no newline); press Enter afterwards when submit is true.',
  'cli.send.result': 'Written{enter}.',
  'cli.sendKey.title': 'Send key to terminal',
  'cli.sendKey.desc':
    'Send a named key: enter, tab, esc, backspace, up/down/left/right, home/end, pageup/pagedown, ctrl+c, ctrl+d, ctrl+l, ctrl+u, ctrl+w, ctrl+z, etc.',
  'cli.sendKey.unknown': 'Unknown key "{key}". Available: enter/esc/tab/ctrl+c/arrows, etc.',
  'cli.sendKey.result': 'Sent {key}.',
  'cli.wait.title': 'Wait for terminal output',
  'cli.wait.desc':
    'Block until the given text appears in the terminal output (substring match, ANSI colors ignored); returns after it appears, the process exits, or the timeout hits, with recent output attached. ' +
    'Cheaper than polling terminal_read repeatedly, and never reads half-finished output.',
  'cli.wait.matched': '✓ "{needle}" appeared in the output',
  'cli.wait.exited': 'Process exited; "{needle}" did not appear in the output',
  'cli.wait.timeout': '⏱ Timed out after {ms}ms; "{needle}" did not appear in the output',
  'cli.recordStop.title': 'Export terminal recording',
  'cli.recordStop.desc':
    'Stop the terminal recording and assemble the mp4 (unified 1920×1080 output by default); returns the file path and a markdown reference snippet.',
  'cli.stop.title': 'End terminal process',
  'cli.stop.desc':
    'Send Ctrl+C to the terminal process and wait for exit (force kill on timeout); returns the exit code. The session is kept; call terminal_close to release it.',
  'cli.stop.result': 'Terminal process ended, exit code: {code}.',
  'cli.close.title': 'Close terminal session',
  'cli.close.desc': 'End the terminal process, close the replay page and release resources.',

  // ---- session store ----
  'session.notFound':
    'No {kind} session "{id}" found (active {kind} sessions: {known}). Call the corresponding open/launch tool first.',
  'session.none': 'none',
  'session.noActive':
    'No active {kind} session. Sessions idle for over 10 minutes are reclaimed automatically; if you opened one earlier, call the corresponding open/launch tool again.',

  // ---- browser target ----
  'browser.launchFail': 'Failed to launch Chromium: {message}. Run npx playwright install chromium first.',

  // ---- recorder / encode pipeline ----
  'recorder.noFrames':
    'No frames captured. Make sure there is interaction or animation inside the recorded window, then retry.',
  'recorder.decorationSizeFail': 'Failed to parse the recorded frame size; skipping window decoration',
  'decoration.renderFail': 'Failed to render the window decoration: {message}',
  'terminal.noOutput': '(no output yet)',
  'encode.notLocated': 'ffmpeg not located; call locateFfmpeg first',
  'encode.spawnFail': 'Failed to start ffmpeg ({bin}): {message}',
  'encode.exitCode': 'ffmpeg exited with code {code}: {tail}',

  // ---- ffmpeg deps ----
  'ffmpeg.missing':
    'ffmpeg not found; video recording is unavailable. Install ffmpeg (brew install ffmpeg) or point MANTA_SHOW_FFMPEG at an existing binary.',
  'ffmpeg.shaMismatch':
    'sha256 verification failed (expected {expected}…, got {actual}…); download discarded',
  'ffmpeg.downloadFail': 'ffmpeg download failed ({count} source(s) tried): {message}',

  // ---- entrypoint CLI (index.ts) ----
  'cliEntry.help':
    'manta-show - MCP server for AI agents: capture screenshots and videos of web pages, Electron apps and CLI tools.\n' +
    '\n' +
    'Usage: manta-show [options]\n' +
    '\n' +
    'Options:\n' +
    '  -v, --version    Print version and exit\n' +
    '  -h, --help       Show this help and exit\n' +
    '  init             Detect installed AI agents (Claude Code, Cursor,\n' +
    '                   Gemini CLI, Codex) and register the manta-show MCP server\n' +
    '                   in their configs\n' +
    '  doctor [--deep]  Check local environment (Node, ffmpeg, Chromium, output\n' +
    '                   dir, MCP configs) and offer to fix issues interactively;\n' +
    '                   --deep also runs a real capture test (screenshot + mp4)\n' +
    '  recordings       List recent media artifacts in the output dir\n' +
    '                   (--last for only the newest, --open to open it)\n' +
    '  clean            Show output dir usage; delete with --older-than 7d\n' +
    '                   (or 24h / 30m) or --all; add -y to skip confirmation\n' +
    '  set              Persist env overrides (repeatable --env KEY=VALUE) to\n' +
    '                   ~/.manta-show/config.json, e.g. set --env\n' +
    '                   MANTA_SHOW_LANG=zh-CN; bare `set` lists saved values.\n' +
    '                   Keys: MANTA_SHOW_* and PLAYWRIGHT_DOWNLOAD_HOST\n' +
    '\n' +
    'Without options, starts the MCP server on stdio.',
  'cliEntry.unknownArg': '[manta-show] unknown argument "{arg}", ignored. Use --help to see available options.',
  'cliEntry.started': '[manta-show] MCP server started (stdio)',
  'banner.tagline': 'capture toolkit for AI agents',

  // ---- server instructions ----
  'server.instructions':
    'manta-show: capture high-quality media for product docs. Three capability lines:\n' +
    '1. Web: browser_open → browser_snapshot to find selectors → browser_click/type/hover to interact → browser_screenshot (selector for component shots) / browser_record_start+record_stop for mp4.\n' +
    '2. CLI tools: terminal_open to launch and record → terminal_read to watch output → terminal_send/terminal_send_key to interact (terminal_wait blocks until output appears) → terminal_record_stop to export mp4.\n' +
    '3. Electron apps: electron_launch → electron_snapshot/click/screenshot → electron_record_start/stop.\n' +
    'Selectors support Playwright syntax (text=, role=, etc.). Recording tools accept steps to run choreographed actions in batch and produce a video automatically; all videos are unified mp4 (H.264); screenshots are returned inline as images.\n' +
    'Artifacts live in ~/.manta-show/media (web/terminal/electron prefixes mark the source); sessions idle for 10 minutes are reclaimed; recordings include a synthetic cursor and window decoration by default.',

  // ---- doctor ----
  'doctor.group.deps': 'Dependencies',
  'doctor.group.output': 'Output & integration',
  'doctor.group.pipeline': 'Capture pipeline',
  'doctor.name.node': 'Node.js',
  'doctor.name.ffmpeg': 'ffmpeg',
  'doctor.name.chromium': 'Chromium',
  'doctor.name.container': 'Container runtime',
  'doctor.name.outputDir': 'Output dir',
  'doctor.name.mcpConfig': 'MCP config',
  'doctor.name.screenshotPipeline': 'Screenshot pipeline',
  'doctor.name.videoPipeline': 'Video pipeline',
  'doctor.node.summary': 'v{version} (requires >= 20)',
  'doctor.node.hint': 'Upgrade Node.js (e.g. nvm install 20 && nvm use 20) and reinstall manta-show',
  'doctor.outputDir.writable': '{dir} is writable',
  'doctor.outputDir.notWritable': '{dir} not writable ({message})',
  'doctor.outputDir.hint': 'Check directory permissions',
  'doctor.mcp.none': 'No installed AI agent detected (run manta-show init after installing one to connect)',
  'doctor.mcp.configured': 'Configured: {names}',
  'doctor.mcp.noneConfigured': 'No agent configured yet',
  'doctor.mcp.missing': '; Not configured: {names}',
  'doctor.mcp.fixDesc': 'manta-show init (writes the missing MCP configs)',
  'doctor.intro': 'Environment check & auto-repair',
  'doctor.intro.deep': 'Environment check & auto-repair (with live capture pipeline test)',
  'doctor.checking': 'Checking the environment…',
  'doctor.checkingItem': 'Checking {name} …',
  'doctor.deepTesting': 'Running live capture pipeline test…',
  'doctor.screenshot.empty': 'Screenshot file is empty',
  'doctor.screenshot.ok': 'Chromium rendering + screenshot OK',
  'doctor.screenshot.skipNoChromium': 'Skipped — Chromium not installed (fix the issues above and retry)',
  'doctor.video.skip': 'Skipped — ffmpeg not found',
  'doctor.video.empty': 'Encoded output is empty',
  'doctor.video.ok': 'ffmpeg encoding OK ({source})',
  'doctor.video.source.localBinary': 'local binary',
  'doctor.video.hint':
    'Terminal recording needs ffmpeg to assemble mp4; check the install or the MANTA_SHOW_FFMPEG setting',
  'doctor.done': 'Check complete',
  'doctor.doneIssues': 'Check complete, {count} issue(s) found',
  'doctor.allGood': 'All good',
  'doctor.rerun': 'If issues remain, run manta-show doctor again to re-check',

  // ---- cli/deps.ts ----
  'deps.downloadHints.chromium': '≈170 MB via the npmmirror mirror, one-time download',
  'deps.downloadHints.ffmpeg': '≈30–80 MB (per platform), npmmirror mirror first',
  'deps.downloadHints.default': 'needs a download',
  'deps.progress.download': 'Downloading {received}/{total} {unit}',
  'deps.installer.spawnFail': 'Failed to start the playwright installer: {message}',
  'deps.installer.exitCode':
    'playwright install chromium exited with code {code} (behind a restricted network, point PLAYWRIGHT_DOWNLOAD_HOST at a reachable mirror)',
  'deps.ffmpegSource.wellKnown': 'Homebrew (system install)',
  'deps.ffmpegSource.managed': '~/.manta-show/bin (downloaded by init/doctor)',
  'deps.ffmpegSource.bundled': 'Bundled (@manta-show/ffmpeg-{platform}-{arch})',
  'deps.ffmpeg.notFound': 'Not found — required to assemble mp4 for video recording',
  'deps.ffmpeg.hint': 'Alternatively brew install ffmpeg or point MANTA_SHOW_FFMPEG at an existing binary',
  'deps.ffmpeg.fixDesc': 'Download ffmpeg to ~/.manta-show/bin (npmmirror mirror first)',
  'deps.progress.downloading': 'Downloading {received}/{total}',
  'deps.progress.downloaded': 'Downloaded {received}',
  'deps.chromium.installedFallback': 'installed',
  'deps.chromium.notInstalled':
    'Not installed — needed by the browser / terminal replay page / Electron capture',
  'deps.chromium.fixDesc': 'Download Chromium (playwright install chromium)',
  'deps.container.summary': '{runtime} ({bin})',
  'deps.container.pathLabel': 'PATH',
  'deps.container.notInstalled':
    'Not installed — optional, only needed for container isolation (isolation: container)',
  'deps.container.hint':
    'Not installed: brew install colima docker (pure CLI) or brew install --cask orbstack; installed but engine not running: colima start / podman machine start / open OrbStack',
  'deps.fix.nonInteractive':
    'Non-interactive environment; auto-repair skipped. Run manta-show doctor in a terminal manually',
  'deps.fix.confirm': 'Auto-fix "{name}"? (will run: {desc})',
  'deps.fix.cancelled': 'Cancelled',
  'deps.fix.skipped': 'Skipped "{name}"',
  'deps.fix.running': 'Running {desc} …',
  'deps.fix.done': '✓ Fix complete',
  'deps.fix.failed': '✗ Fix failed: {message}',
  'deps.setup.complete': 'Dependencies complete; every capture capability works out of the box',
  'deps.setup.confirm': 'Missing dependencies: {plan}. Download and install them now?',
  'deps.setup.skipped': 'Install skipped; run manta-show doctor anytime to finish the download',
  'deps.setup.warnNonInteractive':
    'Non-interactive environment; auto-install skipped. Run manta-show doctor in a terminal to finish the download',
  'deps.setup.installing': 'Installing {name}…',
  'deps.setup.itemProgress': '{name}: {msg}',
  'deps.setup.installed': '✓ {name} installed',
  'deps.setup.installFailed': '✗ {name} install failed: {message}',
  'deps.setup.ready': 'Dependencies ready; every capture capability works out of the box',
  'deps.setup.stillMissing': 'Some dependencies are still missing; run manta-show doctor to review and fix',

  // ---- clean ----
  'clean.needDuration': '--older-than requires a duration argument, e.g. --older-than 7d / 24h / 30m',
  'clean.empty': 'No media artifacts in output dir {dir}',
  'clean.summary':
    'Output dir {dir}: {count} artifact(s), {size} total (oldest {date})' +
    '\n\nDelete with:' +
    '\n  manta-show clean --older-than 7d    delete artifacts older than 7 days (24h / 30m also supported)' +
    '\n  manta-show clean --all              delete everything' +
    '\n  add -y to skip confirmation',
  'clean.nothing': 'No matching artifacts; nothing to clean',
  'clean.aborted':
    'Aborted in a non-interactive environment; add -y to confirm: will delete {count} artifact(s) ({size})',
  'clean.confirm': 'Delete {count} artifact(s) ({size})? This cannot be undone',
  'clean.cancelled': 'Cancelled',
  'clean.deleted': 'Deleted {count} artifact(s), freed {size}',
  'clean.deletedWithErrors': 'Delete finished: {deleted} succeeded, {failed} failed (files may be in use)',

  // ---- recordings ----
  'recordings.justNow': 'just now',
  'recordings.minAgo': '{n} min ago',
  'recordings.hoursAgo': '{n} h ago',
  'recordings.yesterday': 'yesterday {time}',
  'recordings.openFail': 'Cannot open {target} ({cmd} not found)',
  'recordings.empty': 'No media artifacts yet in output dir {dir} (screenshots / videos are saved here)',
  'recordings.last': 'Most recent artifact',
  'recordings.list': 'Recent artifacts ({count} total, {size})',
  'recordings.limit': 'Showing only the newest {n}; adjust with -n <count>',

  // ---- init ----
  'init.parseFail': 'Failed to parse config file: {path} ({message})',
  'init.intro': 'Configure MCP for installed AI agents',
  'init.notDetected': '{name}: not detected, skipped',
  'init.added': '{name}: wrote the {server} MCP config',
  'init.exists': '{name}: config already exists, skipped',
  'init.agentError': '{name}: {message}',
  'init.outro':
    'Done: {installed} written, {skipped} skipped. Restart the agent(s) to use the manta-show MCP tools.',

  // ---- set (persisted env overrides) ----
  'set.saved': 'Env overrides saved to {path}:\n{entries}',
  'set.help':
    'manta-show set — persist manta-show’s environment-variable overrides\n' +
    '\n' +
    'Usage: manta-show set --env KEY=VALUE [--env KEY=VALUE ...]\n' +
    '\n' +
    'Examples:\n' +
    '  manta-show set --env MANTA_SHOW_LANG=zh-CN\n' +
    '  manta-show set --env MANTA_SHOW_FFMPEG=/opt/homebrew/bin/ffmpeg --env MANTA_SHOW_DEBUG=1\n' +
    '\n' +
    'Notes:\n' +
    '  Values are saved to ~/.manta-show/config.json and applied on every startup\n' +
    '  (MCP server and CLI subcommands alike).\n' +
    '  Allowed keys: MANTA_SHOW_* variables and PLAYWRIGHT_DOWNLOAD_HOST.\n' +
    '  MANTA_SHOW_LANG accepts en / zh-CN.\n' +
    '  A variable exported in the real environment wins over the saved value.',
  'set.unknownArg': 'Unknown argument "{arg}". Usage: manta-show set --env KEY=VALUE',
  'set.invalidFormat': '--env expects KEY=VALUE, got "{arg}"',
  'set.invalidKey':
    'Unsupported key "{key}": only MANTA_SHOW_* variables and PLAYWRIGHT_DOWNLOAD_HOST can be set',
  'set.invalidValue': 'Invalid MANTA_SHOW_LANG value "{value}"; supported: en, zh-CN',

  // ---- i18n itself ----
  'i18n.unsupportedLang':
    '[manta-show] unsupported MANTA_SHOW_LANG value "{value}", falling back to "en" (supported: en, zh-CN)',
} as const;

export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, string>;
