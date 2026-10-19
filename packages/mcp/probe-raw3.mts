import { TerminalView } from './src/targets/terminal.js';
import { planTerminalLayout, renderTerminalChrome } from './src/pipeline/decoration.js';
import { OUTPUT_WIDTH, OUTPUT_HEIGHT } from './src/pipeline/recorder.js';
import { runFfmpeg } from './src/pipeline/encode.js';
import { locateFfmpeg } from './src/deps/ffmpeg.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

await locateFfmpeg();
function frameRaw(file: string): Promise<Buffer> {
  return new Promise((res) => {
    const c = spawn('ffmpeg', ['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
    const chunks: Buffer[] = [];
    c.stdout.on('data', (d: Buffer) => chunks.push(d));
    c.on('close', () => res(Buffer.concat(chunks)));
  });
}
const tmp = await mkdtemp(path.join(os.tmpdir(), 'probe-raw3-'));
const view = await TerminalView.open(120, 30);
const cell = await view.cellSize();
const layout = planTerminalLayout(OUTPUT_WIDTH, OUTPUT_HEIGHT, cell);
await view.resize(layout.cols, layout.rows);
view.write('hello\r\n');
await new Promise((r) => setTimeout(r, 400));
const cdp = await view.page.context().newCDPSession(view.page);
const vp = view.page.viewportSize()!;
const files: string[] = [];
for (let i = 0; i < 3; i++) {
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg', quality: 85,
    clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1 },
    captureBeyondViewport: true,
  });
  const f = path.join(tmp, `${i}.jpg`);
  await writeFile(f, Buffer.from(r.data, 'base64'));
  files.push(f);
  await new Promise((r) => setTimeout(r, 120));
}
await view.close();
const list = path.join(tmp, 'list.txt');
await writeFile(list, files.map((f) => `file '${f}'`).join('\n') + `\nfile '${files[2]}'`);
const raw = path.join(tmp, 'raw.mp4');
await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list,
  '-vf', 'fps=15,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', raw]);

const RW = 1718;
const rbuf = await frameRaw(raw);
const rpx = (x: number, y: number) => [rbuf[(y*RW+x)*3], rbuf[(y*RW+x)*3+1], rbuf[(y*RW+x)*3+2]];
console.log('raw last cols y=400:', [1715,1716,1717].map(x=>x+':'+rpx(x,400).join(',')).join('  '));
console.log('raw last rows x=860:', [813,814,815].map(y=>y+':'+rpx(860,y).join(',')).join('  '));

// pad intermediate
const overlay = await renderTerminalChrome(
  { contentWidth: 1718, contentHeight: 816, canvas: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT } },
  tmp,
);
const padded = path.join(tmp, 'padded.mp4');
await runFfmpeg(['-i', raw, '-vf',
  `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:${overlay.contentX}:${overlay.contentY}:color=white,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', padded]);
const W = 1920;
const pbuf = await frameRaw(padded);
const ppx = (x: number, y: number) => [pbuf[(y*W+x)*3], pbuf[(y*W+x)*3+1], pbuf[(y*W+x)*3+2]];
console.log('padded @1818,540:', ppx(1818,540).join(','), ' @960,976:', ppx(960,976).join(','), ' @900,540:', ppx(900,540).join(','));
