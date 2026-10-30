import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { formatBytes, mediaPath, outputDir, relativeRef, scanMediaFiles } from '../src/util/media.js';
import { errorResult, handle, textResult, videoFileResult } from '../src/util/respond.js';
import { t, setLocale, getLocale, type Locale } from '../src/i18n/index.js';
import {
  applyEnvConfig,
  envConfigPath,
  isEnvConfigKey,
  loadEnvConfig,
  saveEnvConfig,
} from '../src/util/envconfig.js';
import {
  locateFfmpeg,
  resetFfmpegCacheForTest,
  resolveFfmpeg,
  type FfmpegProbe,
} from '../src/deps/ffmpeg.js';

test('outputDir is the fixed ~/.manta-show/media dir (MANTA_SHOW_OUTPUT no longer honored) and is created on demand', () => {
  process.env.MANTA_SHOW_OUTPUT = '/tmp/manta-show-should-be-ignored';
  try {
    const dir = outputDir();
    assert.ok(dir.endsWith(path.join('.manta-show', 'media')));
    assert.ok(fs.statSync(dir).isDirectory());
  } finally {
    delete process.env.MANTA_SHOW_OUTPUT;
  }
});

test('mediaPath lands in the output dir with the requested extension and is unique', () => {
  const a = mediaPath('video', 'mp4');
  const b = mediaPath('video', 'mp4');
  assert.ok(a.startsWith(outputDir() + path.sep) && a.endsWith('.mp4'));
  assert.ok(a.includes('video-'));
  assert.notEqual(a, b);
});

test('relativeRef returns the absolute path when outside cwd', () => {
  assert.equal(relativeRef('/definitely/not/under/cwd/file.mp4'), '/definitely/not/under/cwd/file.mp4');
});

test('scanMediaFiles keeps only media extensions, newest first, tolerates missing dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-show-unit-'));
  try {
    assert.deepEqual(scanMediaFiles(path.join(tmp, 'missing')), []);
    fs.writeFileSync(path.join(tmp, 'old.png'), 'x');
    fs.writeFileSync(path.join(tmp, 'new.mp4'), 'x');
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(tmp, 'new.mp4'), future, future);
    const names = scanMediaFiles(tmp).map((f) => f.name);
    assert.deepEqual(names, ['new.mp4', 'old.png']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('formatBytes scales units', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536 * 1024), '1.5 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB');
});

test('textResult / errorResult shape', () => {
  assert.deepEqual(textResult('hi'), { content: [{ type: 'text', text: 'hi' }] });
  const err = errorResult('boom');
  assert.equal(err.isError, true);
  assert.deepEqual(err.content, [{ type: 'text', text: 'boom' }]);
});

test('videoFileResult reports path, duration and frames', () => {
  const res = videoFileResult('/tmp/demo.mp4', 1.234, 30);
  const text = res.content[0].type === 'text' ? res.content[0].text : '';
  assert.match(text, /\/tmp\/demo\.mp4/);
  assert.match(text, /1\.2s/);
  assert.match(text, /30/);
});

// ---- i18n ----

const LANG_BACKUP = process.env.MANTA_SHOW_LANG;

test('i18n: en is the default locale and t() interpolates params', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('session.notFound', { kind: 'web', id: 'web-abc', known: 'none' }),
    'No web session "web-abc" found (active web sessions: none). Call the corresponding open/launch tool first.');
});

test('i18n: both locales carry the same key set and switch via setLocale', () => {
  const before = getLocale();
  try {
    setLocale('zh-CN');
    assert.match(t('err.noRecording'), /该会话没有进行中的录制/);
    assert.equal(t('respond.saved', { file: '/x.png' }), '已保存：/x.png');
    setLocale('en');
    assert.match(t('err.noRecording'), /^No recording in progress/);
  } finally {
    setLocale(before);
  }
});

test('i18n: MANTA_SHOW_LANG resolves en (default), zh variants, and falls back on unknown values', async () => {
  const detect = async (lang?: string): Promise<Locale> => {
    if (lang === undefined) delete process.env.MANTA_SHOW_LANG;
    else process.env.MANTA_SHOW_LANG = lang;
    // Fresh import so the module-level detectLocale() runs with the new env
    const mod = await import(`../src/i18n/index.js?lang=${encodeURIComponent(String(lang))}`);
    return (mod as { getLocale(): Locale }).getLocale();
  };
  try {
    assert.equal(await detect(undefined), 'en');
    assert.equal(await detect('en'), 'en');
    assert.equal(await detect('zh-CN'), 'zh-CN');
    assert.equal(await detect('zh'), 'zh-CN');
    assert.equal(await detect('ZH_hans'), 'zh-CN');
    assert.equal(await detect('fr'), 'en');
  } finally {
    if (LANG_BACKUP === undefined) delete process.env.MANTA_SHOW_LANG;
    else process.env.MANTA_SHOW_LANG = LANG_BACKUP;
  }
});

test('handle converts thrown errors into isError results', async () => {
  const wrapped = handle(async () => {
    throw new Error('captured failed');
  });
  const res = await wrapped(undefined as never);
  assert.equal(res.isError, true);
  assert.deepEqual(res.content, [{ type: 'text', text: 'captured failed' }]);
});

// ---- envconfig (manta-show set) ----

test('envconfig: key allowlist is MANTA_SHOW_* plus PLAYWRIGHT_DOWNLOAD_HOST', () => {
  assert.equal(isEnvConfigKey('MANTA_SHOW_LANG'), true);
  assert.equal(isEnvConfigKey('MANTA_SHOW_FFMPEG'), true);
  assert.equal(isEnvConfigKey('PLAYWRIGHT_DOWNLOAD_HOST'), true);
  assert.equal(isEnvConfigKey('PATH'), false);
  assert.equal(isEnvConfigKey('OTHER_VAR'), false);
});

test('envconfig: save/load/apply round-trip under a redirected HOME', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-envconfig-'));
  const prevHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    assert.deepEqual(loadEnvConfig(), {});
    saveEnvConfig({ MANTA_SHOW_LANG: 'zh-CN', NOT_ALLOWED: 'x' }); // unknown keys are filtered on read
    const saved = loadEnvConfig();
    assert.deepEqual(saved, { MANTA_SHOW_LANG: 'zh-CN' });

    // applyEnvConfig fills only keys the caller env doesn't already have (real env wins)
    const env: NodeJS.ProcessEnv = {};
    applyEnvConfig(env);
    assert.equal(env.MANTA_SHOW_LANG, 'zh-CN');
    const env2: NodeJS.ProcessEnv = { MANTA_SHOW_LANG: 'en' };
    applyEnvConfig(env2);
    assert.equal(env2.MANTA_SHOW_LANG, 'en');
    assert.equal(envConfigPath().endsWith(path.join('.manta-show', 'config.json')), true);
  } finally {
    process.env.HOME = prevHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ---- ffmpeg location ----

const FFMPEG = 'ffmpeg'; // the managed binary filename resolveFfmpeg uses on non-win32 platforms

/** require id of the bundled platform package (mirrors resolveFfmpeg's construction) */
const BUNDLED_PKG_ID = `@manta-show/ffmpeg-${process.platform}-${process.arch}/package.json`;

/**
 * Build an injectable probe: `files` lists paths where exists() is true; `bundledPkg` simulates
 * require('@manta-show/ffmpeg-<platform>-<arch>/package.json') (resolve semantics — returns the
 * absolute path of the package.json)
 */
function makeProbe(opts: {
  env?: Record<string, string>;
  files?: string[];
  onPath?: boolean;
  wellKnownDirs?: string[];
  bundledPkg?: string;
}): FfmpegProbe {
  const files = new Set(opts.files ?? []);
  return {
    env: opts.env ?? {},
    wellKnownDirs: opts.wellKnownDirs ?? [],
    managedDir: `/managed/${FFMPEG}`,
    onPath: async () => opts.onPath === true,
    exists: (p) => files.has(p),
    require: (id) => {
      if (id === BUNDLED_PKG_ID) {
        if (opts.bundledPkg === undefined) throw new Error('bundled ffmpeg package is not installed');
        return opts.bundledPkg;
      }
      throw new Error(`unexpected require(${id})`);
    },
  };
}

test('resolveFfmpeg 探测顺序：MANTA_SHOW_FFMPEG > PATH > 知名路径 > managed > 内置平台包', async () => {
  const bundledBin = `/static/@manta-show/ffmpeg-${process.platform}-${process.arch}/${FFMPEG}`;
  const everything = makeProbe({
    env: { MANTA_SHOW_FFMPEG: '/custom/ffmpeg' },
    files: ['/custom/ffmpeg', '/opt/homebrew/bin/ffmpeg', `/managed/${FFMPEG}/ffmpeg`, bundledBin],
    onPath: true,
    wellKnownDirs: ['/opt/homebrew/bin/ffmpeg'],
    bundledPkg: `/static/@manta-show/ffmpeg-${process.platform}-${process.arch}/package.json`,
  });
  assert.deepEqual(await resolveFfmpeg(everything), { path: '/custom/ffmpeg', source: 'env' });
  assert.deepEqual(await resolveFfmpeg({ ...everything, env: {} }), { path: FFMPEG, source: 'path' });
  assert.deepEqual(
    await resolveFfmpeg({ ...everything, env: {}, onPath: async () => false }),
    { path: '/opt/homebrew/bin/ffmpeg', source: 'well-known' },
  );
  assert.deepEqual(
    await resolveFfmpeg({ ...everything, env: {}, onPath: async () => false, wellKnownDirs: [] }),
    { path: `/managed/${FFMPEG}/ffmpeg`, source: 'managed' },
  );
  assert.deepEqual(
    await resolveFfmpeg(makeProbe({ bundledPkg: `/static/@manta-show/ffmpeg-${process.platform}-${process.arch}/package.json`, files: [bundledBin] })),
    { path: bundledBin, source: 'bundled' },
  );
});

test('resolveFfmpeg PATH 缺失时回退知名路径（宿主精简 PATH 场景）', async () => {
  const probe = makeProbe({
    wellKnownDirs: ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'],
    files: ['/usr/local/bin/ffmpeg'], // first candidate missing, fall through to the second
  });
  assert.deepEqual(await resolveFfmpeg(probe), { path: '/usr/local/bin/ffmpeg', source: 'well-known' });
});

test('resolveFfmpeg 全部未命中返回 null（内置平台包缺失或二进制不存在时）', async () => {
  const probe = makeProbe({ bundledPkg: '/ghost/package.json' }); // require succeeds but the binary doesn't exist
  assert.equal(await resolveFfmpeg(probe), null);
});

test('locateFfmpeg 负结果不缓存，装好 ffmpeg 后下次调用即生效（回归 2026-10 安装时序问题）', async () => {
  resetFfmpegCacheForTest();
  try {
    // First probe: nothing exists anywhere (server started before ffmpeg was installed)
    const empty = makeProbe({});
    assert.equal(await locateFfmpeg(empty), null);
    // User installs ffmpeg (shows up in a well-known dir); re-probe without restarting the server → found immediately
    const fake = '/opt/homebrew/bin/ffmpeg';
    const installed = makeProbe({ wellKnownDirs: [fake], files: [fake] });
    assert.deepEqual(await locateFfmpeg(installed), { path: fake, source: 'well-known' });
    // Positive results are cached: later probes return the cache even if the environment worsens
    assert.deepEqual(await locateFfmpeg(empty), { path: fake, source: 'well-known' });
  } finally {
    resetFfmpegCacheForTest();
  }
});

test('containerSpawn builds docker run argv with mount, env and image', async () => {
  const { containerSpawn } = await import('../src/deps/container.js');

  const [cmd, argv] = containerSpawn(
    'docker',
    'npm',
    ['install', '-g', '@some/cool-pkg'],
    {
      image: 'node:22',
      cwd: '/tmp/demo',
      env: { NPM_CONFIG_REGISTRY: 'https://registry.npmmirror.com' },
      volumes: ['/tmp/demo-gitconfig:/root/.gitconfig'],
    },
  );
  assert.equal(cmd, 'docker');
  assert.deepEqual(argv, [
    'run',
    '--rm',
    '-it',
    '-v',
    '/tmp/demo:/workspace',
    '-w',
    '/workspace',
    '-v',
    '/tmp/demo-gitconfig:/root/.gitconfig',
    '-e',
    'TERM=xterm-256color',
    '-e',
    'COLORTERM=truecolor',
    '-e',
    'FORCE_COLOR=1',
    '-e',
    'NPM_CONFIG_REGISTRY=https://registry.npmmirror.com',
    'node:22',
    'npm',
    'install',
    '-g',
    '@some/cool-pkg',
  ]);

  const [podmanCmd] = containerSpawn('podman', 'bash', undefined, { image: 'node:22' });
  const [, bare] = containerSpawn('docker', 'bash', undefined, { image: 'node:22' });
  assert.equal(podmanCmd, 'podman');
  assert.ok(!bare.includes('-v'), 'no mount without cwd');
  assert.equal(bare.at(-2), 'node:22');
  assert.equal(bare.at(-1), 'bash');
});

// ---- media editing (pipeline/media.ts) ----

import {
  buildAudioConcatArgs,
  buildAudioSplitArgs,
  buildLoopArgs,
  buildMuxArgs,
  buildMuteArgs,
  buildVideoConcatArgs,
  concatOutputDuration,
  parseMediaInfo,
  splitBoundaries,
  type ConcatOptions,
} from '../src/pipeline/media.js';

const FFMPEG_STDERR_AV = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/a.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 1234 kb/s
    Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 1000 kb/s, 30 fps
    Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6D703461), 44100 Hz, stereo, fltp, 128 kb/s
`;

test('parseMediaInfo extracts duration, resolution and stream presence from the ffmpeg summary', () => {
  const info = parseMediaInfo(FFMPEG_STDERR_AV)!;
  assert.equal(info.durationSec, 62.5);
  assert.equal(info.width, 1920);
  assert.equal(info.height, 1080);
  assert.equal(info.hasVideo, true);
  assert.equal(info.hasAudio, true);
});

test('parseMediaInfo detects muted videos and rejects non-media output', () => {
  const muted = parseMediaInfo(
    "Duration: 00:00:03.00,\nStream #0:0: Video: h264, yuv420p, 1280x720, 30 fps\n",
  )!;
  assert.equal(muted.hasAudio, false);
  assert.equal(muted.durationSec, 3);
  assert.equal(parseMediaInfo('carriage return\nnothing useful'), null);
});

test('splitBoundaries turns sorted/de-duplicated points into full-coverage segments and validates range', () => {
  assert.deepEqual(splitBoundaries([8.5, 3, 3], 10), [
    { start: 0, end: 3 },
    { start: 3, end: 8.5 },
    { start: 8.5, end: 10 },
  ]);
  assert.throws(() => splitBoundaries([0], 10));
  assert.throws(() => splitBoundaries([10], 10));
  assert.throws(() => splitBoundaries([], 10));
});

function concatOpts(overrides: Partial<ConcatOptions> = {}): ConcatOptions {
  return {
    clips: [
      { file: '/a.mp4', durationSec: 4, hasAudio: true },
      { file: '/b.mp4', durationSec: 3, hasAudio: true },
    ],
    width: 1920,
    height: 1080,
    transition: 'cut',
    transitionDurationSec: 0.5,
    fadeInSec: 0,
    fadeOutSec: 0,
    ...overrides,
  };
}

test('video_concat (cut) normalizes clips and concats video+audio', () => {
  const args = buildVideoConcatArgs(concatOpts(), '/out.mp4');
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /scale=1920:1080:force_original_aspect_ratio=decrease/);
  assert.match(graph, /concat=n=2:v=1:a=1\[vc\]\[ac\]/);
  // concat pads are interleaved per segment: [v0][an0][v1][an1]
  assert.match(graph, /\[v0\]\[an0\]\[v1\]\[an1\]concat/);
  assert.ok(!graph.includes('xfade'));
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4), ['-map', '[vc]', '-map', '[ac]']);
  assert.equal(args.at(-1), '/out.mp4');
});

test('video_concat (fade) chains xfade/acrossfade with correct offsets and shortens the output', () => {
  const opts = concatOpts({ transition: 'fade' });
  assert.equal(concatOutputDuration(opts), 6.5);
  const graph = buildVideoConcatArgs(opts, '/out.mp4')[argsGraphIndex()];
  assert.match(graph, /xfade=transition=fade:duration=0\.500:offset=3\.500/);
  assert.match(graph, /acrossfade=d=0\.500/);
  assert.ok(!graph.includes('concat:'));

  function argsGraphIndex(): number {
    const a = buildVideoConcatArgs(opts, '/out.mp4');
    return a.indexOf('-filter_complex') + 1;
  }
});

test('video_concat pads audio-less clips with generated silence so one graph handles mixed inputs', () => {
  const opts = concatOpts({
    clips: [
      { file: '/a.mp4', durationSec: 4, hasAudio: true },
      { file: '/muted.mp4', durationSec: 3, hasAudio: false },
    ],
  });
  const args = buildVideoConcatArgs(opts, '/out.mp4');
  assert.ok(args.includes('anullsrc=channel_layout=stereo:sample_rate=44100'));
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /\[0:a\]aformat/);
  assert.match(graph, /\[2:a\]aformat/); // clip 1's audio comes from the appended silent input
});

test('video_concat fade-in/fade-out applies to video and audio at the program boundaries', () => {
  const graph = buildVideoConcatArgs(concatOpts({ fadeInSec: 1, fadeOutSec: 0.5 }), '/out.mp4')[
    argsIndexOfGraph()
  ];
  assert.match(graph, /fade=t=in:st=0:d=1\.000/);
  assert.match(graph, /fade=t=out:st=6\.500:d=0\.500/); // 7s program, 0.5s fade-out
  assert.match(graph, /afade=t=out:st=6\.500:d=0\.500/);

  function argsIndexOfGraph(): number {
    const a = buildVideoConcatArgs(concatOpts({ fadeInSec: 1, fadeOutSec: 0.5 }), '/out.mp4');
    return a.indexOf('-filter_complex') + 1;
  }
});

test('concatOutputDuration: cut adds up, fade overlaps by one transition per junction', () => {
  const cut = concatOpts({ transition: 'cut' });
  assert.equal(concatOutputDuration(cut), 7);
  assert.equal(
    concatOutputDuration(
      concatOpts({
        transition: 'fade',
        clips: [
          { file: '/a', durationSec: 2, hasAudio: false },
          { file: '/b', durationSec: 2, hasAudio: false },
          { file: '/c', durationSec: 2, hasAudio: false },
        ],
      }),
    ),
    5, // 6 - 2 * 0.5
  );
});

test('audio/video single-op arg builders', () => {
  assert.deepEqual(buildAudioSplitArgs('/in.mp3', { start: 1.5, end: 3.5 }, '/p1.m4a'), [
    '-ss', '1.500', '-i', '/in.mp3', '-t', '2.000', '-vn', '-c:a', 'aac', '-b:a', '192k', '/p1.m4a',
  ]);
  const concatArgs = buildAudioConcatArgs(['/a.m4a', '/b.m4a'], '/out.m4a');
  const concatGraph = concatArgs[concatArgs.indexOf('-filter_complex') + 1];
  assert.equal(concatGraph, '[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];[a0][a1]concat=n=2:v=0:a=1[a]');
  assert.ok(!concatArgs.includes('-ar')); // input-side -ar is rejected by common demuxers; normalization lives in the graph
  assert.deepEqual(buildMuteArgs('/in.mp4', '/out.mp4'), [
    '-i', '/in.mp4', '-an', '-c:v', 'copy', '-movflags', '+faststart', '/out.mp4',
  ]);
  const loop = buildLoopArgs('/anim.mp4', false, 30, '/loop.mp4');
  assert.deepEqual(loop.slice(0, 5), ['-stream_loop', '-1', '-i', '/anim.mp4', '-t']);
  assert.ok(loop.includes('-an'));
  const loopAudio = buildLoopArgs('/anim.mp4', true, 30, '/loop.mp4');
  assert.ok(loopAudio.includes('-c:a'));
  assert.ok(!loopAudio.includes('-an'));
  assert.deepEqual(buildMuxArgs('/v.mp4', '/a.m4a', '/out.mp4'), [
    '-i', '/v.mp4', '-i', '/a.m4a', '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', '/out.mp4',
  ]);
});
