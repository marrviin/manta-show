import { Recorder, OUTPUT_WIDTH, OUTPUT_HEIGHT } from './src/pipeline/recorder.js';
import { TerminalView } from './src/targets/terminal.js';
import { planTerminalLayout } from './src/pipeline/decoration.js';
import { spawn as ptySpawn } from 'node-pty';
import { spawn } from 'node:child_process';

const view = await TerminalView.open(120, 30);
const cell = await view.cellSize();
const layout = planTerminalLayout(OUTPUT_WIDTH, OUTPUT_HEIGHT, cell);
await view.resize(layout.cols, layout.rows);
const rec = await Recorder.start(view.page, { kind: 'terminal', canvas: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT } });
const pty = ptySpawn('node', ['/tmp/cli-demo.mjs'], {
  name: 'xterm-256color', cols: layout.cols, rows: layout.rows, cwd: '/tmp',
  env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' } as Record<string, string>,
});
pty.onData((d: string) => view.write(d));
await new Promise<number>((res) => pty.onExit(({ exitCode }) => res(exitCode)));
await new Promise((r) => setTimeout(r, 800));
console.log('result:', await rec.stop('/tmp/manta-cli-demo.mp4'));
await view.close();

const child = spawn('ffmpeg', ['-v','error','-i','/tmp/manta-cli-demo.mp4','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
const chunks: Buffer[] = [];
child.stdout.on('data', (c: Buffer) => chunks.push(c));
child.on('close', () => {
  const buf = Buffer.concat(chunks);
  const W = 1920;
  const px = (x: number, y: number) => [buf[(y*W+x)*3], buf[(y*W+x)*3+1], buf[(y*W+x)*3+2]];
  console.log('seam col 1818 @540:', px(1818,540).join(','), ' seam row 976 @960:', px(960,976).join(','));
  console.log('content @900,540:', px(900,540).join(','), ' pad-right @1830,540:', px(1830,540).join(','));
  // full seam sweep
  let seams = 0;
  for (let x = 1814; x <= 1820; x++) for (let y = 165; y <= 972; y++) if (px(x,y)[0] > 128) seams++;
  for (let y = 972; y <= 980; y++) for (let x = 105; x <= 1814; x++) if (px(x,y)[0] > 128) seams++;
  console.log('bright pixels near seams:', seams);
});
