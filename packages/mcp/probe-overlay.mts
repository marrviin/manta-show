import { renderTerminalChrome } from './src/pipeline/decoration.js';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'probe-ov-'));
const overlay = await renderTerminalChrome(
  { contentWidth: 1718, contentHeight: 816, canvas: { width: 1920, height: 1080 } },
  tmp,
);
console.log('contentX/Y:', overlay.contentX, overlay.contentY);
// dump RGBA rows through the suspect columns
const dump = (x0: number, y: number, n: number, label: string) => {
  const raw = execFileSync('ffmpeg', ['-v','error','-i',overlay.pngPath,'-vf',`crop=${n}:1:${x0}:${y}`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-'], {maxBuffer: 1<<20});
  console.log(label, Array.from({length: n}, (_, i) => `${x0+i}:r${raw[i*4]},g${raw[i*4+1]},b${raw[i*4+2]},a${raw[i*4+3]}`).join(' '));
};
dump(1815, 540, 8, 'x-scan y=540 :');
dump(958, 976, 6, 'y? x-scan y=976:');
dump(958, 975, 6, 'x-scan y=975 :');
console.log('png:', overlay.pngPath);
