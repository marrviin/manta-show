/**
 * Self-demos: regenerate the product's own demo assets by driving manta-show's real MCP surface
 * (client ↔ server over InMemoryTransport) — the web demo is captured with the batch-steps
 * recording feature, the terminal demo with the interactive terminal tools. Both mp4s are then
 * converted to GIFs for the README. This is the product dogfooding itself: if the pipeline
 * regresses, the assets in website/media go stale and this script fails.
 *
 * Run: pnpm demos   (writes website/media/{web,terminal}-demo.{mp4,gif})
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { locateFfmpeg } from '../src/deps/ffmpeg.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MEDIA_DIR = path.join(ROOT, 'website', 'media');
const DOCS_PAGE = 'file://' + path.join(ROOT, 'website', 'docs.html');
const TERMINAL_DEMO_DIR = '/tmp/manta-show-demo';

type Content = { type: string; text?: string };

const { server, store } = createServer();
const client = new Client({ name: 'manta-show-demos', version: '0.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(name: string, args: Record<string, unknown> = {}): Promise<Content[]> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Content[];
  };
  const text = res.content.map((c) => c.text ?? '').join('\n');
  if (res.isError) throw new Error(`${name} 失败：${text.slice(0, 500)}`);
  return res.content;
}

function videoPathOf(contents: Content[]): string {
  const text = contents.map((c) => c.text ?? '').join('\n');
  // server text is locale-dependent (zh-CN: 视频已生成 / en: Video generated) — match both
  const file = /(?:视频已生成：|Video generated: )(.+)/.exec(text)?.[1];
  if (!file) throw new Error(`返回体中没有视频路径：${text.slice(0, 300)}`);
  return file;
}

async function toGif(mp4: string, gif: string, ffmpegBin: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    spawn(
      ffmpegBin,
      [
        '-y',
        '-i', mp4,
        '-vf', 'fps=12,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=diff_mode=rectangle',
        gif,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    ).on('close', (code) => (code === 0 ? resolve() : reject(new Error(`GIF 转换退出码 ${code}`))));
  });
}

function report(file: string): void {
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  → ${path.relative(ROOT, file)} (${kb} KB)`);
}

fs.mkdirSync(MEDIA_DIR, { recursive: true });
const ffmpegBin = (await locateFfmpeg())?.path;
if (!ffmpegBin) throw new Error('未找到 ffmpeg，无法生成 demo 素材');

// ── Demo 1: web line — batch-steps recording over the project's own docs page ──
console.log('录制网页 demo（browser_record_start + steps 批量动作）');
{
  await call('browser_open', { url: DOCS_PAGE, width: 1440, height: 810 });
  const web = videoPathOf(
    await call('browser_record_start', {
      steps: [
        { type: 'wait', ms: 800 },
        { type: 'scroll', dy: 640 },
        { type: 'wait', ms: 700 },
        { type: 'scroll', dy: 640 },
        { type: 'wait', ms: 700 },
        { type: 'hover', selector: '.docs-sidebar a[href="#terminal"]' },
        { type: 'wait', ms: 500 },
        { type: 'scroll', dy: -1280 },
        { type: 'wait', ms: 700 },
      ],
    }),
  );
  await call('browser_close');
  const out = path.join(MEDIA_DIR, 'web-demo.mp4');
  fs.copyFileSync(web, out);
  report(out);
  const gif = path.join(MEDIA_DIR, 'web-demo.gif');
  await toGif(web, gif, ffmpegBin);
  report(gif);
}

// ── Demo 2: terminal line — a real npm install in an interactive shell ──
console.log('录制终端 demo（terminal_open + 交互）');
{
  fs.rmSync(TERMINAL_DEMO_DIR, { recursive: true, force: true });
  fs.mkdirSync(TERMINAL_DEMO_DIR, { recursive: true });
  await call('terminal_open', {
    command: 'bash',
    args: ['-i'],
    cwd: TERMINAL_DEMO_DIR,
    cols: 100,
    rows: 26,
    env: { BASH_SILENCE_DEPRECATION_WARNING: '1' },
  });
  await sleep(1500); // wait for the shell prompt before typing the first command — input sent earlier gets echoed before the prompt and appears twice on screen
  await call('terminal_send', { text: 'npm init -y > /dev/null', submit: true });
  await sleep(1200);
  await call('terminal_send', { text: 'npm install chalk@4', submit: true });
  // 'vulnerabilities' appears whether the install was fresh ("added 1 package") or cached ("up to date")
  await call('terminal_wait', { contains: 'vulnerabilities', timeoutMs: 30_000 });
  await sleep(800);
  await call('terminal_send', {
    text: `node -e "const c=require('chalk');console.log('');console.log(c.bold.cyan('  ✔ captured by manta-show'));console.log(c.gray('  web / cli / electron — mp4 out of the box'))"`,
    submit: true,
  });
  await sleep(2000);
  const terminal = videoPathOf(await call('terminal_record_stop'));
  await call('terminal_close');
  const out = path.join(MEDIA_DIR, 'terminal-demo.mp4');
  fs.copyFileSync(terminal, out);
  report(out);
  const gif = path.join(MEDIA_DIR, 'terminal-demo.gif');
  await toGif(terminal, gif, ffmpegBin);
  report(gif);
}

// Teardown releases occasionally hang (pty/browser close waits); don't block script exit — artifacts are already on disk
await Promise.race([store.closeAll(), sleep(8000)]);
client.close();
process.exit(0);
console.log('\ndemo 素材已更新到 website/media/ ✅');
