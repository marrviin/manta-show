import { en, type MessageKey } from './en.js';
import { zhCN } from './zh-CN.js';

export type { MessageKey };

/** Supported locales; `en` is the default and the fallback for unknown values */
export type Locale = 'en' | 'zh-CN';

const DICTS: Record<Locale, Record<MessageKey, string>> = {
  en,
  'zh-CN': zhCN,
};

/**
 * Normalize a raw language tag (e.g. "en", "zh-CN", "ZH_HANS") to a supported locale.
 * Unknown values fall back to `en` with a one-line stderr warning (stderr is safe under MCP
 * stdio — only stdout carries the JSON-RPC protocol).
 */
export function resolveLocale(raw: string): Locale {
  const norm = raw.trim().toLowerCase().replace(/_/g, '-');
  if (norm === 'zh-cn' || norm === 'zh' || norm === 'zh-hans') return 'zh-CN';
  if (norm === 'en' || norm.startsWith('en-')) return 'en';
  console.error(en['i18n.unsupportedLang'].replace('{value}', raw.trim()));
  return 'en';
}

let locale: Locale = process.env.MANTA_SHOW_LANG?.trim()
  ? resolveLocale(process.env.MANTA_SHOW_LANG)
  : 'en';

/** Translate the message key, interpolating `{param}` placeholders; params are typed loosely to keep call sites lean */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text = DICTS[locale][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Override the locale (test-only: locale is resolved once at module load) */
export function setLocale(l: Locale): void {
  locale = l;
}

/** Current locale (test-only) */
export function getLocale(): Locale {
  return locale;
}
