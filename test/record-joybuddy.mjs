import { PtySession, TerminalView } from '/Users/panmenglin3/github/manta-show/dist/capture/terminal/view.js';
import { Recorder } from '/Users/panmenglin3/github/manta-show/dist/capture/recorder.js';

const view = await TerminalView.open(100, 30);
const recorder = await Recorder.start(view.page);
const pty = new PtySession((await import('node-pty')).spawn('joybuddy', ['-h'], {
  name: 'xterm-256color', cols: 100, rows: 30, cwd: process.cwd(),
  env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' },
}));
pty.view = view;

// 等 help 全部输出完（命令本身输出完就退出，等 pty 退出再补 1s 稳妥）
await pty.waitExit(10000);
await new Promise(r => setTimeout(r, 1000));

const res = await recorder.stop('/Users/panmenglin3/github/manta-show/manta-media/joybuddy-help.mp4');
console.log('录制完成:', JSON.stringify(res));
console.log('--- 终端内容 ---');
console.log(pty.recentText(40));
await view.close();
process.exit(0);
