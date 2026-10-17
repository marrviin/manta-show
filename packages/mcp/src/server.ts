import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionStore } from './session.js';
import { registerWebTools } from './tools/web.js';
import { registerCliTools } from './tools/cli.js';
import { registerElectronTools } from './tools/electron.js';

export function createServer(): { server: McpServer; store: SessionStore } {
  const store = new SessionStore();
  const server = new McpServer(
    { name: 'manta-show', version: '0.1.0' },
    {
      instructions:
        'manta-show：为产品文档捕获高画质媒体。三条能力线：\n' +
        '1. 网页：browser_open → browser_snapshot 确定选择器 → browser_click/type/hover 交互 → browser_screenshot（selector 可做组件级截图）/ browser_record_start+record_stop 录 mp4。\n' +
        '2. 命令行工具：terminal_open 启动并录制 → terminal_read 看输出 → terminal_send/terminal_send_key 交互 → terminal_record_stop 导出 mp4。\n' +
        '3. Electron 应用：electron_launch → electron_snapshot/click/screenshot → electron_record_start/stop。\n' +
        '所有视频统一输出 mp4 (H.264)；截图直接以图片返回并附带保存路径与 markdown 引用片段，可直接插入 README。',
    },
  );
  registerWebTools(server, store);
  registerCliTools(server, store);
  registerElectronTools(server, store);
  return { server, store };
}
