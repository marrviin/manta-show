import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { formatBytes, mediaPath, outputDir, relativeRef, scanMediaFiles } from '../src/util/media.js';
import { errorResult, handle, textResult, videoFileResult } from '../src/util/respond.js';

test('outputDir uses MANTA_SHOW_OUTPUT and creates the directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-show-unit-'));
  const target = path.join(tmp, 'nested', 'out');
  process.env.MANTA_SHOW_OUTPUT = target;
  try {
    assert.equal(outputDir(), target);
    assert.ok(fs.statSync(target).isDirectory());
  } finally {
    delete process.env.MANTA_SHOW_OUTPUT;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mediaPath lands in the output dir with the requested extension and is unique', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manta-show-unit-'));
  process.env.MANTA_SHOW_OUTPUT = tmp;
  try {
    const a = mediaPath('video', 'mp4');
    const b = mediaPath('video', 'mp4');
    assert.ok(a.startsWith(tmp + path.sep) && a.endsWith('.mp4'));
    assert.ok(a.includes('video-'));
    assert.notEqual(a, b);
  } finally {
    delete process.env.MANTA_SHOW_OUTPUT;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

test('handle converts thrown errors into isError results', async () => {
  const wrapped = handle(async () => {
    throw new Error('captured failed');
  });
  const res = await wrapped(undefined as never);
  assert.equal(res.isError, true);
  assert.deepEqual(res.content, [{ type: 'text', text: 'captured failed' }]);
});
