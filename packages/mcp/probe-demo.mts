import { Recorder, OUTPUT_WIDTH, OUTPUT_HEIGHT } from './src/pipeline/recorder.js';
import { TerminalView } from './src/targets/terminal.js';
import { planTerminalLayout } from './src/pipeline/decoration.js';
import { spawn as ptySpawn } from 'node-pty';

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
