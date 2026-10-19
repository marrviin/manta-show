import * as p from '@clack/prompts';
import { resolveLocale, setLocale, t } from '../i18n/index.js';
import {
  applyEnvConfig,
  envConfigPath,
  isEnvConfigKey,
  loadEnvConfig,
  saveEnvConfig,
} from '../util/envconfig.js';

/** Whether the value is an acceptable MANTA_SHOW_LANG tag (same normalization as i18n) */
function isValidLang(value: string): boolean {
  const norm = value.trim().toLowerCase().replace(/_/g, '-');
  return norm === 'en' || norm.startsWith('en-') || norm === 'zh' || norm === 'zh-cn' || norm === 'zh-hans';
}

function fail(message: string): never {
  p.log.error(message);
  process.exit(1);
}

/** Format saved entries as aligned `KEY=VALUE` lines */
function formatEntries(entries: Record<string, string>): string {
  const keys = Object.keys(entries).sort();
  const width = Math.max(...keys.map((k) => k.length), 0);
  return keys.map((k) => `  ${k.padEnd(width)}  ${entries[k]}`).join('\n');
}

/**
 * `manta-show set --env KEY=VALUE` (repeatable): persist env overrides to
 * ~/.manta-show/config.json so every later run (MCP server + CLI subcommands) picks them up.
 * Bare `manta-show set` lists what is saved. Only MANTA_SHOW_* variables and
 * PLAYWRIGHT_DOWNLOAD_HOST are accepted; MANTA_SHOW_LANG values are validated up front.
 */
export async function runSet(args: string[]): Promise<void> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== '--env') {
      fail(t('set.unknownArg', { arg }));
    }
    const raw = args[++i];
    if (raw === undefined) {
      fail(t('set.invalidFormat', { arg: '(missing value)' }));
    }
    const eq = raw.indexOf('=');
    if (eq <= 0) {
      fail(t('set.invalidFormat', { arg: raw }));
    }
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    if (!isEnvConfigKey(key) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      fail(t('set.invalidKey', { key }));
    }
    if (key === 'MANTA_SHOW_LANG' && !isValidLang(value)) {
      fail(t('set.invalidValue', { value }));
    }
    entries[key] = value;
  }

  // Bare `manta-show set`: show the command's own help (like --help elsewhere)
  if (Object.keys(entries).length === 0) {
    console.log(t('set.help'));
    return;
  }

  saveEnvConfig(entries);

  // Make the saved value effective for this run too — where the real env doesn't already
  // override it (applyEnvConfig skips keys that are already set)
  applyEnvConfig();
  const effectiveLang = process.env.MANTA_SHOW_LANG;
  if (effectiveLang?.trim()) {
    setLocale(resolveLocale(effectiveLang));
  }

  p.log.success(t('set.saved', { path: envConfigPath(), entries: formatEntries(loadEnvConfig()) }));
}
