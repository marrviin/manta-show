import { TerminalView } from './src/targets/terminal.js';
import { planTerminalLayout } from './src/pipeline/decoration.js';
import { OUTPUT_WIDTH, OUTPUT_HEIGHT, jpegSizeIfExported } from './src/pipeline/recorder.js';

const view = await TerminalView.open(120, 30);
const cell = await view.cellSize();
const layout = planTerminalLayout(OUTPUT_WIDTH, OUTPUT_HEIGHT, cell);
console.log('planned:', layout, 'cell:', cell);
await view.resize(layout.cols, layout.rows);
console.log('viewport:', view.page.viewportSize());
console.log('innerWidth/Height+dpr:', await view.page.evaluate(() => [window.innerWidth, window.innerHeight, window.devicePixelRatio]));

const cdp = await view.page.context().newCDPSession(view.page);
const vp = view.page.viewportSize()!;
const res = await cdp.send('Page.captureScreenshot', {
  format: 'jpeg', quality: 85,
  clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1 },
  captureBeyondViewport: true,
});
const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/probe-frame.jpg', Buffer.from(res.data, 'base64'));
console.log('screenshot bytes:', (res.data.length * 3) / 4 | 0);
await view.close();
