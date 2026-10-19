import { TerminalView } from './src/targets/terminal.js';
import { planTerminalLayout } from './src/pipeline/decoration.js';
import { OUTPUT_WIDTH, OUTPUT_HEIGHT } from './src/pipeline/recorder.js';
import { writeFile } from 'node:fs/promises';

const view = await TerminalView.open(120, 30);
const cell = await view.cellSize();
const layout = planTerminalLayout(OUTPUT_WIDTH, OUTPUT_HEIGHT, cell);
await view.resize(layout.cols, layout.rows);
view.write('hello\r\n');
await new Promise((r) => setTimeout(r, 400));
const cdp = await view.page.context().newCDPSession(view.page);
const vp = view.page.viewportSize()!;
const res = await cdp.send('Page.captureScreenshot', {
  format: 'png', clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1 }, captureBeyondViewport: true,
});
await writeFile('/tmp/probe-shot.png', Buffer.from(res.data, 'base64'));
console.log('saved, viewport:', vp);
await view.close();
