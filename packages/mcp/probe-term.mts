import { Recorder } from './src/pipeline/recorder.js';
import { TerminalView } from './src/targets/terminal.js';
import { planTerminalLayout } from './src/pipeline/decoration.js';
import { OUTPUT_WIDTH, OUTPUT_HEIGHT } from './src/pipeline/recorder.js';

const view = await TerminalView.open(120, 30);
const cell = await view.cellSize();
console.log('cell:', cell);
const layout = planTerminalLayout(OUTPUT_WIDTH, OUTPUT_HEIGHT, cell);
console.log('planned layout:', layout);
await view.resize(layout.cols, layout.rows);
// feed some colored output so the content is visibly terminal
view.write('\x1b[42m' + ' '.repeat(layout.cols) + '\x1b[0m\r\nhello terminal demo\r\n');

const rec = await Recorder.start(view.page, { kind: 'terminal', canvas: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT } });
await new Promise((r) => setTimeout(r, 1200));
const out = '/tmp/manta-term-test.mp4';
const result = await rec.stop(out);
console.log('result:', result);
await view.close();

const { spawn } = await import('node:child_process');
const child = spawn('ffmpeg', ['-v','error','-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
const chunks: Buffer[] = [];
child.stdout.on('data', (c: Buffer) => chunks.push(c));
child.on('close', () => {
  const buf = Buffer.concat(chunks);
  const W = 1920;
  const px = (x: number, y: number) => [buf[(y*W+x)*3], buf[(y*W+x)*3+1], buf[(y*W+x)*3+2]];
  console.log('bytes:', buf.length, '(expect', 1920*1080*3, ')');
  console.log('center (960,540):', px(960,540), ' expect dark ~[24,24,27] (#18181b)');
  console.log('green row (960,320):', px(960,320), ' expect green content');
  console.log('wallpaper (20,540):', px(20,540), ' expect colorful (not dark, not white)');
});
