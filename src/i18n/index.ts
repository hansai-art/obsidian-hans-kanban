import { en, type StringKey } from './en.ts';
import { zhTW } from './zh-TW.ts';

/**
 * Detects the active locale from Obsidian's stored UI language.
 * Obsidian persists the chosen language in localStorage under "language".
 * Any zh* variant maps to Traditional Chinese; everything else falls back to English.
 */
function detectLocale(): 'zh-TW' | 'en' {
	try {
		const lang = window.localStorage.getItem('language');
		if (lang && lang.toLowerCase().startsWith('zh')) return 'zh-TW';
	} catch {
		// localStorage may be unavailable in some contexts (tests); fall through.
	}
	return 'en';
}

const locale = detectLocale();
const dict: Record<StringKey, string> = locale === 'zh-TW' ? zhTW : en;

/** Translate a key to the active locale, falling back to English. */
export function t(key: StringKey): string {
	return dict[key] ?? en[key] ?? key;
}
