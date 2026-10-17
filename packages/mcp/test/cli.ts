/**
 * CLI 子命令自测：以子进程方式运行 dist/index.js，覆盖 clean / recordings / doctor --deep
 * 与 util/media.ts 的纯函数。产物目录通过 MANTA_SHOW_OUTPUT 重定向到临时目录。
 *
 * Run: npm run test:cli（build first, then tsx test/cli.ts）
 * doctor --deep 会真实拉起 Chromium 与 ffmpeg，依赖与 e2e 相同。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

/** Run a CLI command with the output dir redirected; returns combined stdout/stderr text */
function run(args: string[]): string {
  const res = spawnSync(process.execPath, [path.resolve('dist/index.js'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, MANTA_SHOW_OUTPUT: TMP },
    timeout: 120_000,
  });
  if (res.error) throw new Error(`子进程运行失败：${res.error}`);
  return `${res.stdout ?? ''}${res.stderr ?? ''}`;
}

/** Create a media file in the temp output dir with an mtime `ageMs` ago */
function makeMedia(name: string, ageMs: number): string {
  const file = path.join(TMP, name);
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
  const older = makeMedia('a-shot.png', 8 * DAY); // 8 天前，供 clean --older-than 7d 使用
  fs.writeFileSync(path.join(TMP, 'ignore.txt'), 'x'); // 非媒体文件，不应被识别/删除
  const files = scanMediaFiles(TMP);
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
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-empty-'));
  const out = spawnSync(process.execPath, [path.resolve('dist/index.js'), 'recordings'], {
    encoding: 'utf8',
    env: { ...process.env, MANTA_SHOW_OUTPUT: empty },
  });
  assert((out.stdout ?? '').includes('没有媒体产物'), `空目录应有提示：${out.stdout}`);
  fs.rmSync(empty, { recursive: true, force: true });
});

await step('clean：无参数只输出统计，不删除', () => {
  const out = run(['clean']);
  assert(out.includes('2 个产物'), `应有统计：${out.slice(-300)}`);
  assert(
    fs.existsSync(path.join(TMP, 'a-shot.png')) && fs.existsSync(path.join(TMP, 'b-video.mp4')),
    '无参数不应删除文件',
  );
});

await step('clean --older-than 7d -y：只删超期文件', () => {
  const out = run(['clean', '--older-than', '7d', '-y']);
  assert(out.includes('已删除 1 个产物'), `应删除 1 个：${out.slice(-300)}`);
  assert(!fs.existsSync(path.join(TMP, 'a-shot.png')), '旧文件应已删除');
  assert(fs.existsSync(path.join(TMP, 'b-video.mp4')), '新文件应保留');
});

await step('clean：非交互且无 -y 时中止', () => {
  makeMedia('c-shot.png', 0);
  const out = run(['clean', '--all']);
  assert(out.includes('已中止'), `应中止：${out.slice(-300)}`);
  assert(fs.existsSync(path.join(TMP, 'c-shot.png')), '未确认不应删除');
});

await step('clean --all -y：清空剩余产物', () => {
  const out = run(['clean', '--all', '-y']);
  // 剩余媒体为 b-video.mp4 + c-shot.png（ignore.txt 非媒体，不在清理范围）
  assert(out.includes('已删除 2 个产物'), `应删除 2 个：${out.slice(-300)}`);
  assert(fs.existsSync(path.join(TMP, 'ignore.txt')), '非媒体文件不应删除');
  assert(scanMediaFiles(TMP).length === 0, '媒体产物应为空');
});

await step('clean --older-than：非法时长报错退出', () => {
  const out = run(['clean', '--older-than', 'abc']);
  assert(out.includes('--older-than 需要一个时长参数'), `应有报错提示：${out.slice(-300)}`);
});

await step('doctor：基础体检通过', () => {
  const out = run(['doctor']);
  assert(out.includes('Node.js'), `应有体检表：${out.slice(-400)}`);
  assert(!out.includes('采集管线'), '不带 --deep 不应出现采集管线分组');
});

await step('doctor --deep：截图 + 视频管线实测', () => {
  const out = run(['doctor', '--deep']);
  assert(out.includes('截图管线'), `缺少截图管线检查：${out.slice(-400)}`);
  assert(out.includes('视频管线'), `缺少视频管线检查：${out.slice(-400)}`);
  const shotOk = /✓ 截图管线/.test(out);
  const videoOk = /✓ 视频管线/.test(out);
  assert(shotOk && videoOk, `管线实测未通过：${out.slice(-400)}`);
});

// 深检产物不应残留
await step('doctor --deep：测试产物已清理', () => {
  const leftovers = fs.readdirSync(TMP).filter((f) => f.startsWith('deep-check-'));
  assert(leftovers.length === 0, `深检临时文件残留：${leftovers.join('、')}`);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed === 0 ? '\nCLI 自测全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
