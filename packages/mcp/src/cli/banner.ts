import { readFileSync } from 'node:fs';
import { t } from '../i18n/index.js';

const LOGO = String.raw`
███╗   ███╗ █████╗███╗   ██╗████████╗ █████╗
████╗ ████║██╔══██╗████╗  ██║╚══██╔══╝██╔══██╗
██╔████╔██║███████║██╔██╗ ██║   ██║   ███████║
██║╚██╔╝██║██╔══██║██║╚██╗██║   ██║   ██╔══██║
██║ ╚═╝ ██║██║  ██║██║ ╚████║   ██║   ██║  ██║
╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝`;

function version(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return '?';
  }
}

/** ASCII banner printed at the start of init / doctor (colored only on a TTY) */
export function printBanner(): void {
  const colored = Boolean(process.stdout.isTTY);
  const cyan = (s: string) => (colored ? `\x1b[36m${s}\x1b[0m` : s);
  const dim = (s: string) => (colored ? `\x1b[2m${s}\x1b[0m` : s);
  console.log(cyan(LOGO));
  console.log(dim(`  manta-show v${version()} — ${t('banner.tagline')}\n`));
}
