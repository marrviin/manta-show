import { BaseCaptureSession, type SessionKind } from '../session.js';
import type { PtySession, TerminalView } from './terminal.js';

/** A cli session: one pty process + the xterm.js replay page it renders into */
export class CliSession extends BaseCaptureSession {
  kind = 'cli' as const satisfies SessionKind;
  readonly mediaPrefix = 'terminal';
  view: TerminalView | null = null;

  constructor(
    id: string,
    public pty: PtySession,
  ) {
    super(id);
  }

  protected async release(): Promise<void> {
    await this.pty.dispose();
    await this.view?.close();
  }
}
