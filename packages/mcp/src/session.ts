import { randomBytes } from 'node:crypto';
import { t } from './i18n/index.js';
import { Recorder } from './pipeline/recorder.js';
import { mediaPath } from './util/media.js';

export type SessionKind = 'web' | 'cli' | 'electron';

export interface SessionBase {
  id: string;
  kind: SessionKind;
  lastUsed: number;
  close(): Promise<void>;
}

/**
 * Shared base for the three capture lines (web / cli / electron). Owns the one piece of state
 * they all carry — an in-flight Recorder — and the identical close flow: flush an unfinished
 * recording to a file, then let the subclass release its target.
 */
export abstract class BaseCaptureSession implements SessionBase {
  abstract kind: SessionKind;
  /** Media file prefix for auto-named outputs, e.g. 'web' → web-video-*.mp4 */
  abstract readonly mediaPrefix: string;
  lastUsed = Date.now();
  recorder: Recorder | null = null;

  constructor(public id: string) {}

  async close(): Promise<void> {
    if (this.recorder) {
      try {
        await this.recorder.stop(mediaPath(`${this.mediaPrefix}-video`, 'mp4'));
      } catch {
        // Discard any unfinished recording when the session closes
      }
      this.recorder = null;
    }
    await this.release();
  }

  /** Release the session's target resources (browser context, pty, Electron app) */
  protected abstract release(): Promise<void>;
}

const IDLE_MS = 10 * 60_000;

/** In-memory session store: interactive tools default to the most recently used session of a kind, reclaimed after idle timeout */
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

  /**
   * Resolve a session: explicit sessionId wins, otherwise the most recently used of that kind;
   * throws an actionable error when missing. Typed via the generic parameter at call sites
   * (store.get<WebSession>('web', id)) — the kind check below guarantees the cast is sound.
   */
  get<T extends SessionBase = SessionBase>(kind: SessionKind, sessionId?: string): T {
    if (sessionId) {
      const s = this.sessions.get(sessionId);
      if (!s || s.kind !== kind) {
        const known = this.list(kind).join(', ') || t('session.none');
        throw new Error(t('session.notFound', { kind, id: sessionId, known }));
      }
      this.touch(s);
      return s as T;
    }
    const candidates = [...this.sessions.values()]
      .filter((s) => s.kind === kind)
      .sort((a, b) => b.lastUsed - a.lastUsed);
    if (candidates.length === 0) {
      throw new Error(t('session.noActive', { kind }));
    }
    this.touch(candidates[0]);
    return candidates[0] as T;
  }

  async remove(session: SessionBase): Promise<void> {
    this.sessions.delete(session.id);
    await session.close().catch(() => {});
  }

  /** Close every live session (used on process exit so pty/Chromium children don't leak) */
  async closeAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(all.map((s) => s.close()));
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
