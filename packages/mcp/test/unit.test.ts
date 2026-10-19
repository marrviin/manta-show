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
