import { spawn } from 'node:child_process';
import { t } from '../i18n/index.js';
import { ffmpegPath } from '../deps/ffmpeg.js';

/**
 * Media-editing helpers on top of ffmpeg: everything here either parses the summary ffmpeg
 * prints about an input, or builds the argv for one editing operation. The builders are pure
 * functions so the filter-graph math (xfade offsets, silent-track padding, fade timing) stays
 * unit-testable without spawning ffmpeg.
 */

/** Normalized info from the summary block ffmpeg prints for one input file */
export interface MediaInfo {
  durationSec: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

/**
 * Parse the input-summary block ffmpeg prints on stderr (also for a bare `ffmpeg -i` run,
 * which exits non-zero without an output). Tolerant by design: missing fields stay null/false.
 */
export function parseMediaInfo(stderr: string): MediaInfo | null {
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!dur) return null;
  const videoLine = stderr.split('\n').find((l) => l.includes('Video:'));
  const dims = videoLine ? /(\d{2,5})x(\d{2,5})/.exec(videoLine) : null;
  return {
    durationSec: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    width: dims ? Number(dims[1]) : null,
    height: dims ? Number(dims[2]) : null,
    hasAudio: stderr.includes('Audio:'),
    hasVideo: Boolean(videoLine),
  };
}

/**
 * Probe one media file by running `ffmpeg -i` and parsing the summary (ffmpeg-static ships no
 * ffprobe, so this is the portable way to read duration / streams).
 */
export function probeMedia(file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!bin) {
      reject(new Error(t('encode.notLocated')));
      return;
    }
    const child = spawn(bin, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (e) => reject(new Error(t('err.media.probeFail', { file, message: e.message }))));
    child.on('close', () => {
      const info = parseMediaInfo(stderr);
      if (info) resolve(info);
      else {
        reject(new Error(t('err.media.probeFail', { file, message: stderr.trim().split('\n').slice(-3).join('\n') })));
      }
    });
  });
}

/** Seconds formatted for ffmpeg time options; 3 decimals is frame-accurate at 30fps */
export function fmtSec(s: number): string {
  return s.toFixed(3);
}

export interface SplitSegment {
  start: number;
  end: number;
}

/**
 * Turn split time points into contiguous [start, end] segments covering the whole file.
 * Points are sorted and de-duplicated; each must lie strictly inside (0, total).
 */
export function splitBoundaries(points: number[], totalSec: number): SplitSegment[] {
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.some((p) => !(p > 0 && p < totalSec))) {
    throw new Error(
      t('err.media.badPoints', { points: points.join(', '), duration: totalSec.toFixed(2) }),
    );
  }
  const edges = [0, ...sorted, totalSec];
  const segments: SplitSegment[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    segments.push({ start: edges[i], end: edges[i + 1] });
  }
  return segments;
}

/** One `audio_split` segment: input seek (fast) + trim by duration, re-encoded to AAC */
export function buildAudioSplitArgs(input: string, seg: SplitSegment, out: string): string[] {
  return ['-ss', fmtSec(seg.start), '-i', input, '-t', fmtSec(seg.end - seg.start), '-vn', '-c:a', 'aac', '-b:a', '192k', out];
}

/** `audio_concat`: normalize every input to 44.1kHz stereo in the graph, then concat into one m4a */
export function buildAudioConcatArgs(inputs: string[], out: string): string[] {
  const args: string[] = [];
  for (const f of inputs) args.push('-i', f);
  // -ar/-ac as input options are only honored by raw demuxers; aformat handles resample/mixdown for any container
  const chains = inputs.map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`);
  args.push(
    '-filter_complex',
    `${chains.join(';')};${inputs.map((_, i) => `[a${i}]`).join('')}concat=n=${inputs.length}:v=0:a=1[a]`,
    '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', out,
  );
  return args;
}

/** `video_mute`: drop the audio track, stream-copy the picture (lossless, near-instant) */
export function buildMuteArgs(input: string, out: string): string[] {
  return ['-i', input, '-an', '-c:v', 'copy', '-movflags', '+faststart', out];
}

export interface ConcatClip {
  file: string;
  durationSec: number;
  hasAudio: boolean;
}

export interface ConcatOptions {
  clips: ConcatClip[];
  /** Canvas every clip is scaled/letterboxed onto (callers use the first clip's resolution) */
  width: number;
  height: number;
  /** cut=hard cut; fade=crossfade (dissolve) between adjacent clips */
  transition: 'cut' | 'fade';
  /** Crossfade duration (transition='fade' only); every clip must be longer than this */
  transitionDurationSec: number;
  /** Fade-in from black/silence at the program start (0 = off) */
  fadeInSec: number;
  /** Fade-out to black/silence at the program end (0 = off) */
  fadeOutSec: number;
}

/** Duration of the assembled program: clips overlap by one crossfade each when fading */
export function concatOutputDuration(o: ConcatOptions): number {
  const sum = o.clips.reduce((acc, c) => acc + c.durationSec, 0);
  if (o.transition === 'fade' && o.clips.length > 1) {
    return sum - (o.clips.length - 1) * o.transitionDurationSec;
  }
  return sum;
}

/**
 * `video_concat`: normalize every clip to one canvas at 30fps, then join them — with the concat
 * filter (hard cut) or an xfade/acrossfade chain (crossfade). Clips without audio are fed by a
 * generated silent source so one uniform filter graph handles mixed muted/unmuted inputs.
 * Fade-in/fade-out apply to the assembled program (video and audio alike).
 */
export function buildVideoConcatArgs(o: ConcatOptions, out: string): string[] {
  const n = o.clips.length;
  const args: string[] = [];
  for (const clip of o.clips) args.push('-i', clip.file);
  const silentSlots: number[] = [];
  o.clips.forEach((c, i) => {
    if (!c.hasAudio) silentSlots.push(i);
  });
  for (const i of silentSlots) {
    args.push('-f', 'lavfi', '-t', fmtSec(o.clips[i].durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }
  // Audio source for clip i: its own stream, or the generated silent input appended after the real ones
  const audioSrc = (i: number): string => (o.clips[i].hasAudio ? `${i}:a` : `${n + silentSlots.indexOf(i)}:a`);

  const chains: string[] = [];
  for (let i = 0; i < n; i++) {
    chains.push(
      `[${i}:v]scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,` +
        `pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
  }
  const anyAudio = o.clips.some((c) => c.hasAudio);
  if (anyAudio) {
    for (let i = 0; i < n; i++) {
      chains.push(`[${audioSrc(i)}]aformat=sample_rates=44100:channel_layouts=stereo[an${i}]`);
    }
  }

  const fade = o.transition === 'fade' && n > 1;
  let vLast: string;
  let aLast: string | null = null;
  if (fade) {
    // xfade offset = where the transition starts on the timeline assembled so far
    let cursor = o.clips[0].durationSec - o.transitionDurationSec;
    vLast = 'v0';
    for (let i = 1; i < n; i++) {
      const next = `vx${i}`;
      chains.push(`[${vLast}][v${i}]xfade=transition=fade:duration=${fmtSec(o.transitionDurationSec)}:offset=${fmtSec(cursor)}[${next}]`);
      vLast = next;
      if (i < n - 1) cursor += o.clips[i].durationSec - o.transitionDurationSec;
    }
    if (anyAudio) {
      aLast = 'an0';
      for (let i = 1; i < n; i++) {
        const next = `ax${i}`;
        chains.push(`[${aLast}][an${i}]acrossfade=d=${fmtSec(o.transitionDurationSec)}[${next}]`);
        aLast = next;
      }
    }
  } else if (n > 1) {
    // concat pads are interleaved per segment: [v0][a0][v1][a1]…
    let labels = '';
    for (let i = 0; i < n; i++) {
      labels += `[v${i}]`;
      if (anyAudio) labels += `[an${i}]`;
    }
    chains.push(`${labels}concat=n=${n}:v=1:a=${anyAudio ? 1 : 0}[vc]${anyAudio ? '[ac]' : ''}`);
    vLast = 'vc';
    if (anyAudio) aLast = 'ac';
  } else {
    vLast = 'v0';
    aLast = anyAudio ? 'an0' : null;
  }

  const total = concatOutputDuration(o);
  const vFades: string[] = [];
  const aFades: string[] = [];
  if (o.fadeInSec > 0) {
    vFades.push(`fade=t=in:st=0:d=${fmtSec(o.fadeInSec)}`);
    aFades.push(`afade=t=in:st=0:d=${fmtSec(o.fadeInSec)}`);
  }
  if (o.fadeOutSec > 0) {
    vFades.push(`fade=t=out:st=${fmtSec(total - o.fadeOutSec)}:d=${fmtSec(o.fadeOutSec)}`);
    aFades.push(`afade=t=out:st=${fmtSec(total - o.fadeOutSec)}:d=${fmtSec(o.fadeOutSec)}`);
  }
  let vFinal = vLast;
  let aFinal = aLast;
  if (vFades.length > 0) {
    vFinal = 'vf';
    chains.push(`[${vLast}]${vFades.join(',')}[vf]`);
    if (aLast) {
      aFinal = 'af';
      chains.push(`[${aLast}]${aFades.join(',')}[af]`);
    }
  }

  args.push('-filter_complex', chains.join(';'), '-map', `[${vFinal}]`);
  if (aFinal) args.push('-map', `[${aFinal}]`, '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  return args;
}

/** `video_loop`: repeat the whole input (picture + audio) from the start until the target duration */
export function buildLoopArgs(input: string, hasAudio: boolean, durationSec: number, out: string): string[] {
  const args = ['-stream_loop', '-1', '-i', input, '-t', fmtSec(durationSec), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');
  args.push(out);
  return args;
}

/**
 * `media_mux`: replace the video's audio with the given track. apad + -shortest means the
 * picture always keeps its full length — shorter audio is padded with silence, longer audio
 * is cut at the video's end.
 */
export function buildMuxArgs(video: string, audio: string, out: string): string[] {
  return [
    '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    out,
  ];
}
