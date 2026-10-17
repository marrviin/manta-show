import { randomBytes } from 'node:crypto';

export type SessionKind = 'web' | 'cli' | 'electron';

export interface SessionBase {
  id: string;
  kind: SessionKind;
  lastUsed: number;
  close(): Promise<void>;
}

const IDLE_MS = 10 * 60_000;

/** 内存会话表：所有交互工具缺省复用「该类型最近活跃的会话」，空闲超时自动回收 */
export class SessionStore {
  private sessions = new Map<string, SessionBase>();
  private timer: NodeJS.Timeout | null = null;

  nextId(kind: SessionKind): string {
    return `${kind}-${randomBytes(3).toString('hex')}`;
  }

  add(session: SessionBase): void {
    this.sessions.set(session.id, session);
  }

  touch(session: SessionBase): void {
    session.lastUsed = Date.now();
  }

  list(kind: SessionKind): string[] {
    return [...this.sessions.values()].filter((s) => s.kind === kind).map((s) => s.id);
  }

  /** 取会话：显式 sessionId 优先，否则取该类型最近活跃的；找不到/不在则抛可操作错误 */
  get(kind: SessionKind, sessionId?: string): SessionBase {
    if (sessionId) {
      const s = this.sessions.get(sessionId);
      if (!s || s.kind !== kind) {
        const known = this.list(kind).join(', ') || '无';
        throw new Error(`未找到 ${kind} 会话 "${sessionId}"（该类型活跃会话：${known}）。请先调用对应的 open/launch 工具。`);
      }
      this.touch(s);
      return s;
    }
    const candidates = [...this.sessions.values()]
      .filter((s) => s.kind === kind)
      .sort((a, b) => b.lastUsed - a.lastUsed);
    if (candidates.length === 0) {
      throw new Error(`当前没有活跃的 ${kind} 会话，请先调用对应的 open/launch 工具。`);
    }
    this.touch(candidates[0]);
    return candidates[0];
  }

  async remove(session: SessionBase): Promise<void> {
    this.sessions.delete(session.id);
    await session.close().catch(() => {});
  }

  startReaper(): void {
    this.timer ??= setInterval(() => {
      for (const s of [...this.sessions.values()]) {
        if (Date.now() - s.lastUsed > IDLE_MS) {
          this.sessions.delete(s.id);
          void s.close().catch(() => {});
        }
      }
    }, 60_000);
    this.timer.unref?.();
  }
}
