import { readFile } from 'node:fs/promises';
import { relativeRef } from './media.js';

export type TextContent = { type: 'text'; text: string };
export type ImageContent = { type: 'image'; data: string; mimeType: string };
export type ToolContent = TextContent | ImageContent;
export interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function imageMime(file: string): string {
  return file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
}

/**
 * 截图返回体：MCP image content（Agent 可直接"看到"）+ 保存路径 + markdown 引用片段。
 */
export async function imageFileResult(file: string, extra?: string): Promise<ToolResult> {
  const data = (await readFile(file)).toString('base64');
  const text = [
    `已保存：${file}`,
    `markdown 引用：![screenshot](${relativeRef(file)})`,
    extra,
  ]
    .filter(Boolean)
    .join('\n');
  return { content: [{ type: 'image', data, mimeType: imageMime(file) }, { type: 'text', text }] };
}

/**
 * 视频返回体：保存路径 + markdown 引用片段（mp4 无法内嵌返回，Agent 拿路径插文档）。
 */
export function videoFileResult(file: string, durationSec: number, frameCount: number): ToolResult {
  const text = [
    `视频已生成：${file}`,
    `时长：${durationSec.toFixed(1)}s，帧数：${frameCount}，格式：mp4 (H.264)`,
    `markdown 引用：https://github.com/user-attachments/assets 需上传后使用；本地相对引用：\n![demo](${relativeRef(file)})`,
  ].join('\n');
  return textResult(text);
}

/** 统一的工具异常包装：抛错转为 isError 结果，便于 Agent 自行恢复 */
export function handle<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  };
}
