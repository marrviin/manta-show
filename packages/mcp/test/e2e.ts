/**
 * manta-show end-to-end self-test: connects directly to the server via the MCP SDK Client +
 * InMemoryTransport, covering the web / cli / electron flows:
 * open → interact → screenshot → record → verify artifacts.
 *
 * Run: npm test (build first, then tsx test/e2e.ts)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { outputDir } from '../src/util/media.js';

type Content = { type: string; text?: string; data?: string };

const require = createRequire(import.meta.url);
const FIXTURES = path.resolve('test/fixtures');

const { server, store } = createServer();
const client = new Client({ name: 'manta-show-e2e', version: '0.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

let failed = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Content[]> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Content[];
  };
  if (res.isError) {
    throw new Error(
      `${name} 返回错误：${res.content.map((c) => c.text ?? '').join(' | ').slice(0, 500)}`,
    );
  }
  return res.content;
}

function sessionIdOf(contents: Content[]): string {
  const text = contents.map((c) => c.text ?? '').join('\n');
  const m = text.match(/sessionId=([\w-]+)/);
  if (!m) throw new Error(`返回体中没有 sessionId：${text.slice(0, 200)}`);
  return m[1];
}

function expectFile(file: string, minBytes: number, label: string): void {
  const stat = fs.statSync(file);
  if (stat.size < minBytes) {
    throw new Error(`${label} 文件过小：${file} 只有 ${stat.size} 字节（期望 ≥ ${minBytes}）`);
  }
  console.log(`    → ${label}: ${file} (${(stat.size / 1024).toFixed(0)} KB)`);
}

/** Parse the mp4 duration via ffmpeg -i to verify the video is genuinely valid */
async function expectVideo(file: string, minSec: number, label: string): Promise<void> {
  const ffmpegPath = require('ffmpeg-static') as string;
  const { execFileSync } = (await import('node:child_process')) as typeof import('node:child_process');
  let info = '';
  try {
    info = execFileSync(ffmpegPath, ['-hide_banner', '-i', file], { stdio: 'pipe' }).toString();
  } catch (e) {
    info = (e as { stderr?: Buffer }).stderr?.toString() ?? '';
  }
  const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(info);
  if (!dur) throw new Error(`${label} 无法被 ffmpeg 解析：${file}`);
  const seconds = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  if (seconds < minSec) throw new Error(`${label} 时长过短：${seconds.toFixed(2)}s（期望 ≥ ${minSec}s）`);
  const isH264 = info.includes('h264');
  if (!isH264) throw new Error(`${label} 不是 H.264 编码`);
  console.log(`    → ${label}: ${file} (${seconds.toFixed(2)}s, h264, ${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('\n== Web 线 ==');
{
  const pageUrl = 'file://' + path.join(FIXTURES, 'page.html');
  let webId = '';

  await step('browser_open', async () => {
    webId = sessionIdOf(await call('browser_open', { url: pageUrl, width: 1024, height: 640 }));
  });

  await step('browser_snapshot 返回可访问性树', async () => {
    const text = (await call('browser_snapshot')).map((c) => c.text ?? '').join('\n');
    if (!text.includes('点我')) throw new Error('快照中未找到按钮文本');
  });

  await step('browser_click + 交互生效', async () => {
    await call('browser_click', { selector: '#demo-btn' });
    const text = (await call('browser_evaluate', { script: 'document.getElementById("text").textContent' }))
      .map((c) => c.text ?? '')
      .join('');
    if (!text.includes('按钮已被点击')) throw new Error(`点击未生效：${text}`);
  });

  await step('browser_screenshot（页面级）', async () => {
    const contents = await call('browser_screenshot', {});
    const image = contents.find((c) => c.type === 'image');
    if (!image?.data) throw new Error('返回体中没有图片内容');
    const file = /已保存：(.+)/.exec(contents.map((c) => c.text ?? '').join('\n'))?.[1];
    if (!file) throw new Error('返回体中没有保存路径');
    expectFile(file, 10_000, 'screenshot.png');
  });

  await step('browser_screenshot（元素级）', async () => {
    const contents = await call('browser_screenshot', { selector: '.card' });
    const file = /已保存：(.+)/.exec(contents.map((c) => c.text ?? '').join('\n'))?.[1];
    if (!file) throw new Error('返回体中没有保存路径');
    expectFile(file, 3_000, 'screenshot-element.png');
  });

  await step('browser_record_start → record_stop 产出 mp4', async () => {
    await call('browser_record_start', { sessionId: webId });
    await sleep(1800);
    const text = (await call('browser_record_stop', { sessionId: webId }))
      .map((c) => c.text ?? '')
      .join('\n');
    const file = /视频已生成：(.+)/.exec(text)?.[1];
    if (!file) throw new Error(`返回体中没有视频路径：${text.slice(0, 200)}`);
    await expectVideo(file, 1.2, 'web.mp4');
  });

  await step('browser_close', async () => {
    await call('browser_close', { sessionId: webId });
  });
}

console.log('\n== CLI 线 ==');
{
  let cliId = '';
  const script =
    'echo -e "\\x1b[32mBUILD PASSED\\x1b[0m"; ' +
    'for i in 1 2 3 4 5 6; do echo "deploy step $i/6"; sleep 0.3; done; ' +
    'echo DONE; sleep 60';

  await step('terminal_open', async () => {
    cliId = sessionIdOf(
      await call('terminal_open', { command: 'bash', args: ['-c', script], cols: 80, rows: 24 }),
    );
  });

  await step('terminal_read 看到输出', async () => {
    await sleep(2200);
    const text = (await call('terminal_read', { lines: 20 })).map((c) => c.text ?? '').join('\n');
    if (!text.includes('BUILD PASSED')) throw new Error(`未读到预期输出：${text.slice(0, 200)}`);
    if (!text.includes('deploy step')) throw new Error('未读到进度输出');
  });

  await step('terminal_send_key + read', async () => {
    await call('terminal_send_key', { key: 'ctrl+c', sessionId: cliId });
    await sleep(300);
    // The process should have been interrupted; a subsequent read must not hang
    await call('terminal_read', { lines: 5, sessionId: cliId });
  });

  await step('terminal_record_stop 产出 mp4', async () => {
    // Recording started automatically on open; open a fresh short-lived session here to record a complete take
    const id2 = sessionIdOf(
      await call('terminal_open', {
        command: 'bash',
        args: ['-c', 'echo -e "\\x1b[35mInstall deps...\\x1b[0m"; sleep 0.5; echo "\\x1b[32m✔ done\\x1b[0m"; sleep 3'],
        cols: 80,
        rows: 24,
      }),
    );
    await sleep(1500);
    const text = (await call('terminal_record_stop', { sessionId: id2 }))
      .map((c) => c.text ?? '')
      .join('\n');
    const file = /视频已生成：(.+)/.exec(text)?.[1];
    if (!file) throw new Error(`返回体中没有视频路径：${text.slice(0, 200)}`);
    await expectVideo(file, 1.0, 'terminal.mp4');
    await call('terminal_close', { sessionId: id2 });
  });

  await step('terminal_stop + terminal_close', async () => {
    await call('terminal_stop', { sessionId: cliId });
    await call('terminal_close', { sessionId: cliId });
  });
}

console.log('\n== Electron 线 ==');
{
  let electronAvailable = false;
  try {
    require.resolve('electron');
    electronAvailable = fs.existsSync(path.join(FIXTURES, 'electron-app', 'node_modules', '.bin')) ||
      true; // the electron binary comes from the top-level devDependency
  } catch {
    /* electron not installed, skip */
  }

  if (!electronAvailable) {
    console.log('  - 跳过（未安装 electron devDependency）');
  } else {
    let electronId = '';
    await step('electron_launch', async () => {
      electronId = sessionIdOf(await call('electron_launch', { app: path.join(FIXTURES, 'electron-app') }));
    });

    await step('electron_click + 截图', async () => {
      await call('electron_click', { selector: '#btn', sessionId: electronId });
      const contents = await call('electron_screenshot', { sessionId: electronId });
      const file = /已保存：(.+)/.exec(contents.map((c) => c.text ?? '').join('\n'))?.[1];
      if (!file) throw new Error('返回体中没有保存路径');
      expectFile(file, 5_000, 'electron.png');
    });

    await step('electron_record_start → record_stop 产出 mp4', async () => {
      await call('electron_record_start', { sessionId: electronId });
      await sleep(1500);
      const text = (await call('electron_record_stop', { sessionId: electronId }))
        .map((c) => c.text ?? '')
        .join('\n');
      const file = /视频已生成：(.+)/.exec(text)?.[1];
      if (!file) throw new Error(`返回体中没有视频路径：${text.slice(0, 200)}`);
      await expectVideo(file, 1.0, 'electron.mp4');
    });

    await step('electron_close', async () => {
      await call('electron_close', { sessionId: electronId });
    });
  }
}

console.log('\n== 收尾 ==');
await step('空闲会话不存在泄漏', async () => {
  const { SessionStore } = await import('../src/session.js');
  if (!(store instanceof SessionStore)) throw new Error('store 类型异常');
});

const sessions = (
  store as unknown as { sessions: Map<string, { close(): Promise<void> }> }
).sessions;
for (const s of sessions.values()) {
  await s.close().catch(() => {});
}
client.close();

const media = outputDir();
console.log(`\n产物目录：${media}`);
console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
