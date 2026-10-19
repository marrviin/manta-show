import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Persisted environment overrides for manta-show, stored as a flat JSON map at
 * ~/.manta-show/config.json (managed by `manta-show set --env KEY=VALUE`). Applied into
 * process.env on startup so the whole server (i18n locale, ffmpeg location, …) picks them up
 * without the user exporting anything.
 */

/** Keys that may be persisted: manta-show's own MANTA_SHOW_* vars, plus playwright's mirror setting */
export function isEnvConfigKey(key: string): boolean {
  return key === 'PLAYWRIGHT_DOWNLOAD_HOST' || key.startsWith('MANTA_SHOW_');
}

/** Location of the persisted env-override config */
export function envConfigPath(): string {
  return path.join(homedir(), '.manta-show', 'config.json');
}

/** Load the saved overrides; missing/corrupt file yields {} (a broken config must not break startup) */
export function loadEnvConfig(): Record<string, string> {
  try {
    const raw = fs.readFileSync(envConfigPath(), 'utf8');
    if (!raw.trim()) return {};
    const json = JSON.parse(raw) as Record<string, unknown>;
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(json)) {
      if (typeof value === 'string' && isEnvConfigKey(key)) entries[key] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

/** Merge updates into the saved overrides and persist them; returns the full resulting config */
export function saveEnvConfig(updates: Record<string, string>): Record<string, string> {
  const config = { ...loadEnvConfig(), ...updates };
  fs.mkdirSync(path.dirname(envConfigPath()), { recursive: true });
  fs.writeFileSync(envConfigPath(), JSON.stringify(config, null, 2) + '\n');
  return config;
}

/**
 * Apply persisted overrides into the given env (defaults to process.env). The real environment
 * always wins: a key that is already set is left alone, so `MANTA_SHOW_LANG=en manta-show …`
 * can temporarily override the saved value.
 */
export function applyEnvConfig(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(loadEnvConfig())) {
    if (env[key] === undefined) env[key] = value;
  }
}

// Self-apply on import: index.ts imports this module first, so saved values are in process.env
// before i18n (imported later) resolves its locale at module-evaluation time.
applyEnvConfig();
