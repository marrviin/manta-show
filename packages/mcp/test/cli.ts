/**
 * CLI subcommand self-test: runs dist/index.js as a subprocess, covering clean / recordings /
 * doctor --deep and the pure functions in util/media.ts. The output dir is fixed at
 * ~/.manta-show/media, so the test redirects HOME to point the whole data tree (including
 * .manta-show/media) at a temp directory.
 *
 * Run: npm run test:cli（build first, then tsx test/cli.ts）
 * doctor --deep really launches Chromium and ffmpeg; its dependencies match e2e.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { formatBytes, scanMediaFiles } from '../src/util/media.js';

let failed = 0;
async function step(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-cli-test-'));
// outputDir() is based on os.homedir() ($HOME on POSIX) — redirecting HOME isolates the whole data tree
const MEDIA_DIR = path.join(TMP, '.manta-show', 'media');
// The HOME redirect also cuts playwright's browser registry off (default ~/Library/Caches/ms-playwright),
// so pass the real registry root to the subprocess to keep doctor's Chromium check working
const BROWSERS_ROOT = (() => {
  let dir = path.dirname(chromium.executablePath());
  while (dir !== path.parse(dir).root && !/^chromium-\d+/.test(path.basename(dir))) {
    dir = path.dirname(dir);
  }
  return path.dirname(dir);
})();

/** Run a CLI command with HOME redirected; returns combined stdout/stderr text */
function run(args: string[]): string {
  const res = spawnSync(process.execPath, [path.resolve('dist/index.js'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: TMP, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_ROOT },
    timeout: 120_000,
  });
  if (res.error) throw new Error(`子进程运行失败：${res.error}`);
  return `${res.stdout ?? ''}${res.stderr ?? ''}`;
}

/** Create a media file in the (redirected) output dir with an mtime `ageMs` ago */
function makeMedia(name: string, ageMs: number): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const file = path.join(MEDIA_DIR, name);
  fs.writeFileSync(file, Buffer.alloc(1024));
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
  return file;
}

const DAY = 86_400_000;

await step('formatBytes：人类可读大小', () => {
  assert(formatBytes(500) === '500 B', `500 → ${formatBytes(500)}`);
  assert(formatBytes(2048) === '2.0 KB', `2048 → ${formatBytes(2048)}`);
  assert(formatBytes(5 * 1024 * 1024) === '5.0 MB', `5MB → ${formatBytes(5 * 1024 * 1024)}`);
});

await step('scanMediaFiles：只收媒体文件、按时间倒序', () => {
  const newest = makeMedia('b-video.mp4', 0);
  const older = makeMedia('a-shot.png', 8 * DAY); // 8 days ago, used by clean --older-than 7d
  fs.writeFileSync(path.join(MEDIA_DIR, 'ignore.txt'), 'x'); // not a media file — must not be picked up or deleted
  const files = scanMediaFiles(MEDIA_DIR);
  assert(files.length === 2, `应识别 2 个媒体文件，实际 ${files.length}`);
  assert(files[0].path === newest && files[1].path === older, '排序应为最新在前');
});

await step('recordings：列出产物并显示总大小', () => {
  const out = run(['recordings']);
  assert(out.includes('b-video.mp4') && out.includes('a-shot.png'), `未列出产物：${out.slice(-300)}`);
  assert(out.includes('2.0 KB'), '未显示总大小');
});

await step('recordings --last：只显示最新一个', () => {
  const out = run(['recordings', '--last']);
  assert(out.includes('b-video.mp4'), `未显示最新产物：${out.slice(-300)}`);
  assert(!out.includes('a-shot.png'), '--last 不应显示旧产物');
});

await step('recordings：空目录给出提示', async () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-empty-'));
  const out = spawnSync(process.execPath, [path.resolve('dist/index.js'), 'recordings'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: emptyHome },
  });
  assert((out.stdout ?? '').includes('media artifacts'), `空目录应有提示：${out.stdout}`);
  fs.rmSync(emptyHome, { recursive: true, force: true });
});

await step('clean：无参数只输出统计，不删除', () => {
  const out = run(['clean']);
  assert(out.includes('2 artifact(s)'), `应有统计：${out.slice(-300)}`);
  assert(
    fs.existsSync(path.join(MEDIA_DIR, 'a-shot.png')) && fs.existsSync(path.join(MEDIA_DIR, 'b-video.mp4')),
    '无参数不应删除文件',
  );
});

await step('clean --older-than 7d -y：只删超期文件', () => {
  const out = run(['clean', '--older-than', '7d', '-y']);
  assert(out.includes('Deleted 1 artifact(s)'), `应删除 1 个：${out.slice(-300)}`);
  assert(!fs.existsSync(path.join(MEDIA_DIR, 'a-shot.png')), '旧文件应已删除');
  assert(fs.existsSync(path.join(MEDIA_DIR, 'b-video.mp4')), '新文件应保留');
});

await step('clean：非交互且无 -y 时中止', () => {
  makeMedia('c-shot.png', 0);
  const out = run(['clean', '--all']);
  assert(out.includes('Aborted'), `应中止：${out.slice(-300)}`);
  assert(fs.existsSync(path.join(MEDIA_DIR, 'c-shot.png')), '未确认不应删除');
});

await step('clean --all -y：清空剩余产物', () => {
  const out = run(['clean', '--all', '-y']);
  // Remaining media: b-video.mp4 + c-shot.png (ignore.txt isn't media, outside clean's scope)
  assert(out.includes('Deleted 2 artifact(s)'), `应删除 2 个：${out.slice(-300)}`);
  assert(fs.existsSync(path.join(MEDIA_DIR, 'ignore.txt')), '非媒体文件不应删除');
  assert(scanMediaFiles(TMP).length === 0, '媒体产物应为空');
});

await step('clean --older-than：非法时长报错退出', () => {
  const out = run(['clean', '--older-than', 'abc']);
  assert(out.includes('--older-than requires a duration argument'), `应有报错提示：${out.slice(-300)}`);
});

await step('doctor：基础体检通过', () => {
  const out = run(['doctor']);
  assert(out.includes('Node.js'), `应有体检表：${out.slice(-400)}`);
  assert(!out.includes('Capture pipeline'), '不带 --deep 不应出现采集管线分组');
});

await step('doctor --deep：截图 + 视频管线实测', () => {
  const out = run(['doctor', '--deep']);
  assert(out.includes('Screenshot pipeline'), `缺少截图管线检查：${out.slice(-400)}`);
  assert(out.includes('Video pipeline'), `缺少视频管线检查：${out.slice(-400)}`);
  const shotOk = /✓ Screenshot pipeline/.test(out);
  const videoOk = /✓ Video pipeline/.test(out);
  assert(shotOk && videoOk, `管线实测未通过：${out.slice(-400)}`);
});

// deep-check artifacts must not linger
await step('doctor --deep：测试产物已清理', () => {
  const leftovers = fs.readdirSync(MEDIA_DIR).filter((f) => f.startsWith('deep-check-'));
  assert(leftovers.length === 0, `深检临时文件残留：${leftovers.join('、')}`);
});

await step('set：保存 MANTA_SHOW_LANG 并立即以新语言提示', () => {
  const out = run(['set', '--env', 'MANTA_SHOW_LANG=zh-CN']);
  assert(out.includes('环境变量已保存'), `应有保存提示：${out.slice(-300)}`);
  const saved = JSON.parse(fs.readFileSync(path.join(TMP, '.manta-show', 'config.json'), 'utf8')) as Record<string, string>;
  assert(saved.MANTA_SHOW_LANG === 'zh-CN', 'config.json 应写入 MANTA_SHOW_LANG');
});

await step('set：后续子进程自动应用保存的语言', () => {
  const out = run(['recordings']);
  assert(out.includes('媒体产物'), `应输出中文提示：${out.slice(-300)}`);
});

await step('set：不带参数显示 set 帮助', () => {
  const out = run(['set']);
  assert(
    out.includes('manta-show set --env KEY=VALUE') && out.includes('MANTA_SHOW_LANG=zh-CN'),
    `应显示 set 帮助：${out.slice(-300)}`,
  );
});

await step('set：非法 LANG 值报错退出', () => {
  const out = run(['set', '--env', 'MANTA_SHOW_LANG=fr']);
  assert(out.includes('无效的 MANTA_SHOW_LANG 值'), `应有报错：${out.slice(-300)}`);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed === 0 ? '\nCLI 自测全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
