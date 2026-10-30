import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { t } from '../i18n/index.js';
import { runFfmpeg } from '../pipeline/encode.js';
import {
  buildAudioConcatArgs,
  buildAudioSplitArgs,
  buildLoopArgs,
  buildMuxArgs,
  buildMuteArgs,
  buildVideoConcatArgs,
  concatOutputDuration,
  probeMedia,
  splitBoundaries,
  type ConcatClip,
  type ConcatOptions,
} from '../pipeline/media.js';
import { mediaPath, relativeRef } from '../util/media.js';
import { handle, outPathField, textResult, type ToolResult } from './shared.js';

/**
 * Stateless media-editing tools (no capture session involved): they operate on file paths —
 * the recordings produced by the capture lines, or any audio/video the caller points at —
 * and delegate the actual work to ffmpeg via the argument builders in pipeline/media.ts.
 */

/** Resolve one user-supplied path to an absolute existing file, with an actionable error */
function resolveInput(file: string): string {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(t('err.media.fileMissing', { file }));
  return abs;
}

function resolveInputs(files: string[]): string[] {
  if (!files || files.length === 0) throw new Error(t('err.media.noInputs'));
  return files.map(resolveInput);
}

/** Result body for a generated media file: path + duration + markdown reference */
function mediaFileResult(file: string, durationSec: number): ToolResult {
  return textResult(
    `${t('media.generated', { file, duration: durationSec.toFixed(1) })}\n` +
      t('respond.videoLocalRef', { ref: relativeRef(file) }),
  );
}

export function registerMediaTools(server: McpServer): void {
  server.registerTool(
    'audio_split',
    {
      title: t('media.audioSplit.title'),
      description: t('media.audioSplit.desc'),
      inputSchema: {
        input: z.string().describe(t('field.mediaInput')),
        points: z.array(z.number()).min(1).describe(t('field.splitPoints')),
      },
    },
    handle(async ({ input, points }) => {
      const src = resolveInput(input);
      const info = await probeMedia(src);
      if (!info.hasAudio) throw new Error(t('err.media.noAudioTrack', { file: input }));
      const segments = splitBoundaries(points, info.durationSec);
      const lines: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const out = mediaPath(`audio-split-${i + 1}`, 'm4a');
        await runFfmpeg(buildAudioSplitArgs(src, segments[i], out));
        lines.push(
          t('media.segment.line', {
            n: i + 1,
            file: out,
            start: segments[i].start.toFixed(2),
            end: segments[i].end.toFixed(2),
          }),
        );
      }
      return textResult(`${t('media.split.result', { file: input, count: segments.length })}\n${lines.join('\n')}`);
    }),
  );

  server.registerTool(
    'audio_concat',
    {
      title: t('media.audioConcat.title'),
      description: t('media.audioConcat.desc'),
      inputSchema: {
        inputs: z.array(z.string()).min(1).describe(t('field.mediaInputs')),
        path: outPathField(),
      },
    },
    handle(async ({ inputs, path: outPath }) => {
      const files = resolveInputs(inputs);
      for (let i = 0; i < files.length; i++) {
        const info = await probeMedia(files[i]);
        if (!info.hasAudio) throw new Error(t('err.media.noAudioTrack', { file: inputs[i] }));
      }
      const out = outPath ?? mediaPath('audio-concat', 'm4a');
      await runFfmpeg(buildAudioConcatArgs(files, out));
      const outInfo = await probeMedia(out);
      return mediaFileResult(out, outInfo.durationSec);
    }),
  );

  server.registerTool(
    'video_mute',
    {
      title: t('media.videoMute.title'),
      description: t('media.videoMute.desc'),
      inputSchema: {
        input: z.string().describe(t('field.mediaInput')),
        path: outPathField(),
      },
    },
    handle(async ({ input, path: outPath }) => {
      const src = resolveInput(input);
      const info = await probeMedia(src);
      if (!info.hasVideo) throw new Error(t('err.media.noVideoTrack', { file: input }));
      const out = outPath ?? mediaPath('video-muted', 'mp4');
      await runFfmpeg(buildMuteArgs(src, out));
      const outInfo = await probeMedia(out);
      return mediaFileResult(out, outInfo.durationSec);
    }),
  );

  server.registerTool(
    'video_concat',
    {
      title: t('media.videoConcat.title'),
      description: t('media.videoConcat.desc'),
      inputSchema: {
        inputs: z.array(z.string()).min(1).describe(t('field.mediaInputs')),
        transition: z
          .enum(['cut', 'fade'])
          .optional()
          .default('cut')
          .describe(t('field.transition')),
        transitionDurationSec: z
          .number()
          .min(0.1)
          .max(5)
          .optional()
          .default(0.5)
          .describe(t('field.transitionDuration')),
        fadeInSec: z.number().min(0).max(10).optional().default(0).describe(t('field.fadeInSec')),
        fadeOutSec: z.number().min(0).max(10).optional().default(0).describe(t('field.fadeOutSec')),
        path: outPathField(),
      },
    },
    handle(async ({ inputs, transition, transitionDurationSec, fadeInSec, fadeOutSec, path: outPath }) => {
      const files = resolveInputs(inputs);
      const infos = await Promise.all(files.map((f) => probeMedia(f)));
      for (let i = 0; i < files.length; i++) {
        if (!infos[i].hasVideo) throw new Error(t('err.media.noVideoTrack', { file: inputs[i] }));
      }
      const clips: ConcatClip[] = files.map((f, i) => ({
        file: f,
        durationSec: infos[i].durationSec,
        hasAudio: infos[i].hasAudio,
      }));
      if (transition === 'fade' && clips.some((c) => c.durationSec <= transitionDurationSec)) {
        throw new Error(t('err.media.transitionTooLong', { duration: transitionDurationSec }));
      }
      const opts: ConcatOptions = {
        clips,
        // Normalize to the first clip's resolution; recordings are all 1920×1080 already
        width: infos.find((i) => i.width)?.width ?? 1920,
        height: infos.find((i) => i.height)?.height ?? 1080,
        transition,
        transitionDurationSec,
        fadeInSec,
        fadeOutSec,
      };
      if (fadeOutSec > 0 && fadeOutSec >= concatOutputDuration(opts)) {
        throw new Error(t('err.media.fadeTooLong', { fade: fadeOutSec, total: concatOutputDuration(opts).toFixed(1) }));
      }
      const out = outPath ?? mediaPath('video-concat', 'mp4');
      await runFfmpeg(buildVideoConcatArgs(opts, out));
      const outInfo = await probeMedia(out);
      return mediaFileResult(out, outInfo.durationSec);
    }),
  );

  server.registerTool(
    'video_loop',
    {
      title: t('media.videoLoop.title'),
      description: t('media.videoLoop.desc'),
      inputSchema: {
        input: z.string().describe(t('field.mediaInput')),
        durationSec: z.number().min(0.5).max(3600).describe(t('field.targetDuration')),
        path: outPathField(),
      },
    },
    handle(async ({ input, durationSec, path: outPath }) => {
      const src = resolveInput(input);
      const info = await probeMedia(src);
      if (!info.hasVideo) throw new Error(t('err.media.noVideoTrack', { file: input }));
      const out = outPath ?? mediaPath('video-loop', 'mp4');
      await runFfmpeg(buildLoopArgs(src, info.hasAudio, durationSec, out));
      const outInfo = await probeMedia(out);
      return mediaFileResult(out, outInfo.durationSec);
    }),
  );

  server.registerTool(
    'media_mux',
    {
      title: t('media.mux.title'),
      description: t('media.mux.desc'),
      inputSchema: {
        input: z.string().describe(t('field.mediaInput')),
        audio: z.string().describe(t('field.audioInput')),
        path: outPathField(),
      },
    },
    handle(async ({ input, audio, path: outPath }) => {
      const video = resolveInput(input);
      const audioFile = resolveInput(audio);
      const videoInfo = await probeMedia(video);
      if (!videoInfo.hasVideo) throw new Error(t('err.media.noVideoTrack', { file: input }));
      const audioInfo = await probeMedia(audioFile);
      if (!audioInfo.hasAudio) throw new Error(t('err.media.noAudioTrack', { file: audio }));
      const out = outPath ?? mediaPath('video-mux', 'mp4');
      await runFfmpeg(buildMuxArgs(video, audioFile, out));
      const outInfo = await probeMedia(out);
      return mediaFileResult(out, outInfo.durationSec);
    }),
  );
}
