import type {
	App,
	BasesEntry,
	BasesPropertyId,
	BasesViewConfig,
	CachedMetadata,
	EventRef,
	HoverPopover,
	QueryController,
	ViewOption,
} from 'obsidian';
import { BasesView, Keymap, Notice, normalizePath, parsePropertyId, setIcon } from 'obsidian';
import {
	createCard as createCardEl,
	computeCardFingerprint,
	type CardRenderCtx,
	type CardCallbacks,
} from './components/card.ts';
import {
	createAddButton as createAddButtonEl,
	createQuickAddCard as createQuickAddCardEl,
	closeNativeNewItemPopover as closeNativeNewItemPopoverEl,
	type QuickAddCtx,
	type QuickAddCallbacks,
} from './components/quickAdd.ts';
import {
	applyColumnColor as applyColumnColorEl,
	createColumn as createColumnEl,
	patchColumnCards as patchColumnCardsEl,
	type ColumnRenderCtx,
	type ColumnCallbacks,
} from './components/column.ts';
import {
	buildSwimlaneElement as buildSwimlaneElementEl,
	updateSwimlaneToggle as updateSwimlaneToggleEl,
	sortSwimlaneValues,
	getOrderedSwimlaneValues as getOrderedSwimlaneValuesEl,
	type RowRenderCtx,
	type RowCallbacks,
} from './components/row.ts';
import { TFile } from 'obsidian';
import Sortable from 'sortablejs';
import {
	COLOR_NAME_TO_EMOJI,
	COLOR_PALETTE,
	CSS_CLASSES,
	DATA_ATTRIBUTES,
	DEBOUNCE_DELAY,
	EMOJI_COLOR_MAP,
	EMPTY_STATE_MESSAGES,
	HOVER_LINK_SOURCE_ID,
	SORTABLE_CONFIG,
	SORTABLE_GROUP,
	SORTED_CARD_ORDER_NOTICE,
	SWIMLANE_KEY_SEPARATOR,
	UNCATEGORIZED_LABEL,
} from './constants.ts';
import type { DebouncedFn } from './utils/debounce.ts';
import { debounce } from './utils/debounce.ts';
import { t } from './i18n/index.ts';
import { ensureGroupExists, normalizePropertyValue } from './utils/grouping.ts';

export interface LegacyData {
	columnOrders: Record<string, string[]>;
	columnColors: Record<string, Record<string, string>>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Frontmatter scalar → string for card-color comparison. Numbers count
 * (`phase: 123` renders as "123"); everything else (lists, booleans, null)
 * returns null so callers skip rather than mis-compare.
 */
function frontmatterString(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	return null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Obsidian's native property-value suggester is fed by the (internal)
 * `metadataCache.getFrontmatterPropertyValuesForKey`, which only returns
 * values currently in use across the vault — so configured-but-unused
 * card-color options never show up there. Each board render stores its full
 * option list here (keyed by frontmatter property name) and a wrapper merges
 * it into the suggester (configured order first, then in-use extras).
 *
 * The cache deliberately OUTLIVES the view: Bases tears a board view down
 * whenever its tab goes to the background, which is exactly when the user is
 * editing a note's property — so unpatching on view close would remove the
 * options at the moment they're needed. The original function is restored
 * only on plugin unload (restorePropertySuggester, called from main.ts).
 */
const SUGGESTER_FN_KEY = 'getFrontmatterPropertyValuesForKey';
type PropertyValuesFn = (key: string) => unknown;
const isPropertyValuesFn = (value: unknown): value is PropertyValuesFn => typeof value === 'function';
const suggesterOptions = new Map<string, string[]>();
let suggesterPatch: { cache: object; original: PropertyValuesFn } | null = null;
let suggesterPersist: ((options: Record<string, string[]>) => void) | null = null;

/** Restore the original suggester function. Call only on plugin unload. */
export function restorePropertySuggester(): void {
	suggesterOptions.clear();
	suggesterPersist = null;
	if (suggesterPatch) {
		Reflect.set(suggesterPatch.cache, SUGGESTER_FN_KEY, suggesterPatch.original);
		suggesterPatch = null;
	}
}

/**
 * Seed the option cache from plugin data saved in a previous session and
 * register the persistence callback. With this, the suggester patch and the
 * auto-color paths work from app startup — no board render needed first.
 * Live board renders still take precedence over seeded values.
 */
export function setSuggesterOptionsPersistence(
	seed: unknown,
	persist: (options: Record<string, string[]>) => void,
): void {
	if (isStringArrayRecord(seed)) {
		for (const [key, values] of Object.entries(seed)) {
			if (!suggesterOptions.has(key)) suggesterOptions.set(key, [...values]);
		}
	}
	suggesterPersist = persist;
}

function persistSuggesterOptions(): void {
	suggesterPersist?.(Object.fromEntries(suggesterOptions));
}

/**
 * Install the suggester merge wrapper on the metadataCache. Idempotent;
 * called at plugin load (so persisted options work immediately) and from
 * every board render. No-op on hosts without the internal API.
 */
export function installPropertySuggesterPatch(app: App): void {
	if (suggesterPatch) return;
	const cache = app.metadataCache;
	if (!cache) return;
	const current: unknown = Reflect.get(cache, SUGGESTER_FN_KEY);
	if (!isPropertyValuesFn(current)) return;
	const original = current;
	const wrapper = (key: string): unknown => {
		const raw: unknown = original.call(cache, key);
		const options = suggesterOptions.get(key);
		if (!options || options.length === 0) return raw;
		const base: unknown[] = Array.isArray(raw) ? raw : [];
		const merged: unknown[] = [...options];
		for (const value of base) {
			if (merged.includes(value)) continue;
			// Color properties only offer colored values. Emoji-less entries in
			// the vault index are transient by design (the write-time patch and
			// the auto-color listener rewrite them) or stale session ghosts —
			// either way, showing them would duplicate their colored twin.
			if (typeof value === 'string' && !EMOJI_COLOR_MAP[[...value][0] ?? '']) continue;
			merged.push(value);
		}
		return merged;
	};
	Reflect.set(cache, SUGGESTER_FN_KEY, wrapper);
	suggesterPatch = { cache, original };
}

/**
 * Write-time auto-color: wrap fileManager.processFrontMatter so any write
 * that leaves a registered card-color property holding a raw (emoji-less)
 * value gets the color emoji prepended INSIDE the same write — no transient
 * raw value ever hits disk or the metadata index. This is what makes values
 * picked through third-party property UIs (e.g. Metadata Menu's modal)
 * colored instantly instead of one metadata-event later.
 */
const FRONTMATTER_FN_KEY = 'processFrontMatter';
type ProcessFrontMatterFn = (
	file: unknown,
	fn: (frontmatter: Record<string, unknown>) => unknown,
	...rest: unknown[]
) => unknown;
const isProcessFrontMatterFn = (value: unknown): value is ProcessFrontMatterFn => typeof value === 'function';
let frontmatterPatch: { manager: object; original: ProcessFrontMatterFn } | null = null;

export function installWriteTimeAutoColor(app: App): void {
	if (frontmatterPatch) return;
	const manager = app.fileManager;
	if (!manager) return;
	const current: unknown = Reflect.get(manager, FRONTMATTER_FN_KEY);
	if (!isProcessFrontMatterFn(current)) return;
	const original = current;
	const wrapper: ProcessFrontMatterFn = (file, fn, ...rest) => {
		const shimmed = (frontmatter: Record<string, unknown>): unknown => {
			const result = fn(frontmatter);
			for (const [propertyName, options] of suggesterOptions) {
				const raw = frontmatterString(frontmatter[propertyName]);
				if (raw === null) continue;
				const value = raw.trim();
				if (!value || EMOJI_COLOR_MAP[[...value][0] ?? '']) continue;
				const emoji = leastUsedEmojiAmong(options);
				if (emoji) frontmatter[propertyName] = `${emoji} ${value}`;
			}
			return result;
		};
		return original.call(manager, file, shimmed, ...rest);
	};
	Reflect.set(manager, FRONTMATTER_FN_KEY, wrapper);
	frontmatterPatch = { manager, original };
}

/** Restore the original processFrontMatter. Call only on plugin unload. */
export function restoreWriteTimeAutoColor(): void {
	if (frontmatterPatch) {
		Reflect.set(frontmatterPatch.manager, FRONTMATTER_FN_KEY, frontmatterPatch.original);
		frontmatterPatch = null;
	}
}

/** Strip a single leading color emoji (and its trailing space) from a value. */
export function stripLeadingColorEmoji(value: string): string {
	const leadEmoji = [...value][0] ?? '';
	if (!EMOJI_COLOR_MAP[leadEmoji]) return value;
	return value.slice(leadEmoji.length).replace(/^\s+/, '');
}

/** Snapshot of the registered card-color options, for the recolor picker. */
export function getRegisteredColorOptions(): Map<string, string[]> {
	return new Map([...suggesterOptions].map(([key, values]) => [key, [...values]]));
}

/**
 * Rewrite a status value everywhere: every markdown note whose card-color
 * property matches it (by bare text), cardColorOrder entries inside .base
 * files, the option cache, and best-effort Metadata Menu's preset-field
 * valuesList. Returns the number of notes rewritten. Backs both the recolor
 * and the rename actions of the manage-status command.
 */
export async function applyValueRewrite(
	app: App,
	propertyName: string,
	oldValue: string,
	newValue: string,
): Promise<number> {
	const oldBare = stripLeadingColorEmoji(oldValue.trim());
	if (!oldBare || newValue === oldValue) return 0;

	// 1. Rewrite matching notes (bare-text match so any current emoji counts).
	let count = 0;
	for (const file of app.vault.getMarkdownFiles()) {
		const current = frontmatterString(app.metadataCache.getFileCache(file)?.frontmatter?.[propertyName]);
		if (current === null || stripLeadingColorEmoji(current.trim()) !== oldBare) continue;
		const guard = `${file.path}::${propertyName}`;
		autoColorNormalizing.add(guard);
		try {
			await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				const cur = frontmatterString(frontmatter[propertyName]);
				if (cur !== null && stripLeadingColorEmoji(cur.trim()) === oldBare) {
					frontmatter[propertyName] = newValue;
				}
			});
			count++;
		} catch (error) {
			console.error('KanbanView: status rewrite failed', error);
		} finally {
			autoColorNormalizing.delete(guard);
		}
	}

	// 2. Update cardColorOrder entries in .base configs so the board's fixed
	// option list follows.
	if (oldValue !== oldBare) {
		await rewriteBaseConfigs(app, (content) =>
			content.includes(oldValue) ? content.split(oldValue).join(newValue) : content,
		);
	}

	// 3. Refresh the option cache (and persist it).
	const options = suggesterOptions.get(propertyName);
	if (options) {
		const updated = options.map((value) => (stripLeadingColorEmoji(value.trim()) === oldBare ? newValue : value));
		suggesterOptions.set(propertyName, updated);
		persistSuggesterOptions();
	}

	// 4. Best-effort: keep Metadata Menu's preset Select options in sync.
	syncMetadataMenuOption(app, propertyName, oldBare, newValue);

	return count;
}

/** Recolor: same bare text, new leading emoji. */
export async function applyRecolor(app: App, propertyName: string, oldValue: string, emoji: string): Promise<number> {
	const bare = stripLeadingColorEmoji(oldValue.trim());
	if (!bare) return 0;
	return applyValueRewrite(app, propertyName, oldValue, `${emoji} ${bare}`);
}

/** Rename: new bare text, keeping the current leading emoji if there is one. */
export async function applyRename(app: App, propertyName: string, oldValue: string, newBare: string): Promise<number> {
	const trimmed = newBare.trim();
	if (!trimmed) return 0;
	const lead = [...oldValue.trim()][0] ?? '';
	const newValue = EMOJI_COLOR_MAP[lead] ? `${lead} ${trimmed}` : trimmed;
	return applyValueRewrite(app, propertyName, oldValue, newValue);
}

/**
 * Delete an UNUSED option: drop its cardColorOrder line from .base files,
 * remove it from Metadata Menu's valuesList and from the option cache. The
 * caller is responsible for checking the usage count first.
 */
export async function applyDeleteOption(app: App, propertyName: string, value: string): Promise<void> {
	const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const linePattern = new RegExp(`^\\s*-\\s*["']?${escaped}["']?\\s*$`);
	await rewriteBaseConfigs(app, (content) =>
		content
			.split('\n')
			.filter((line) => !linePattern.test(line))
			.join('\n'),
	);

	const options = suggesterOptions.get(propertyName);
	if (options) {
		suggesterOptions.set(
			propertyName,
			options.filter((option) => option !== value),
		);
		persistSuggesterOptions();
	}

	removeMetadataMenuOption(app, propertyName, stripLeadingColorEmoji(value.trim()));
}

/** Map of bare value text → number of markdown notes currently using it. */
export function countValueUsage(app: App, propertyName: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const file of app.vault.getMarkdownFiles()) {
		const current = frontmatterString(app.metadataCache.getFileCache(file)?.frontmatter?.[propertyName]);
		if (current === null) continue;
		const bare = stripLeadingColorEmoji(current.trim());
		if (!bare) continue;
		counts.set(bare, (counts.get(bare) ?? 0) + 1);
	}
	return counts;
}

/** Run a content transform over every .base file in the vault. */
async function rewriteBaseConfigs(app: App, transform: (content: string) => string): Promise<void> {
	for (const file of app.vault.getFiles()) {
		if (file.extension !== 'base') continue;
		try {
			await app.vault.process(file, transform);
		} catch (error) {
			console.error('KanbanView: .base update failed', error);
		}
	}
}

/** Replace bare-matching entries inside one valuesList record. */
function replaceValuesListMatches(valuesList: Record<string, unknown>, bare: string, newValue: string): boolean {
	let touched = false;
	for (const [key, value] of Object.entries(valuesList)) {
		if (typeof value !== 'string' || stripLeadingColorEmoji(value.trim()) !== bare) continue;
		valuesList[key] = newValue;
		touched = true;
	}
	return touched;
}

/** Delete bare-matching entries from one valuesList record. */
function deleteValuesListMatches(valuesList: Record<string, unknown>, bare: string): boolean {
	let touched = false;
	for (const [key, value] of Object.entries(valuesList)) {
		if (typeof value !== 'string' || stripLeadingColorEmoji(value.trim()) !== bare) continue;
		delete valuesList[key];
		touched = true;
	}
	return touched;
}

/**
 * Apply a mutation to Metadata Menu's preset-field valuesList(s) for one
 * property, then persist via its own saveSettings. Best-effort: silently a
 * no-op when the plugin, the field or the valuesList is absent.
 */
function mutateMetadataMenuOptions(
	app: App,
	propertyName: string,
	mutate: (valuesList: Record<string, unknown>) => boolean,
): void {
	try {
		const plugins: unknown = Reflect.get(app, 'plugins');
		if (typeof plugins !== 'object' || plugins === null) return;
		const registry: unknown = Reflect.get(plugins, 'plugins');
		if (typeof registry !== 'object' || registry === null) return;
		const mm: unknown = Reflect.get(registry, 'metadata-menu');
		if (typeof mm !== 'object' || mm === null) return;
		const settings: unknown = Reflect.get(mm, 'settings');
		if (typeof settings !== 'object' || settings === null) return;
		const presetFields: unknown = Reflect.get(settings, 'presetFields');
		if (!Array.isArray(presetFields)) return;
		let touched = false;
		for (const field of presetFields) {
			if (!isRecord(field) || field.name !== propertyName) continue;
			const options = field.options;
			if (!isRecord(options) || !isRecord(options.valuesList)) continue;
			if (mutate(options.valuesList)) touched = true;
		}
		if (!touched) return;
		const save: unknown = Reflect.get(mm, 'saveSettings');
		if (typeof save === 'function') void save.call(mm);
	} catch (error) {
		console.error('KanbanView: Metadata Menu sync failed', error);
	}
}

/** Replace a matching value inside Metadata Menu's preset-field valuesList. */
function syncMetadataMenuOption(app: App, propertyName: string, bare: string, newValue: string): void {
	mutateMetadataMenuOptions(app, propertyName, (valuesList) => replaceValuesListMatches(valuesList, bare, newValue));
}

/** Remove a matching value from Metadata Menu's preset-field valuesList. */
function removeMetadataMenuOption(app: App, propertyName: string, bare: string): void {
	mutateMetadataMenuOptions(app, propertyName, (valuesList) => deleteValuesListMatches(valuesList, bare));
}

/**
 * Plugin-level auto-color: whenever any note's frontmatter changes and one of
 * its properties is a known card-color property (per suggesterOptions, fed by
 * board renders), prepend a color emoji to a raw value. This lives on the
 * PLUGIN lifecycle, not the view's — Bases tears the board view down whenever
 * its tab goes background, which is exactly when the user edits a note's
 * property, so a view-scoped listener would be dead at that moment.
 * Returns the EventRef for Plugin.registerEvent, or null without the API.
 */
export function registerGlobalAutoColor(app: App): EventRef | null {
	const cache = app.metadataCache;
	if (!cache || typeof cache.on !== 'function') return null;
	return cache.on('changed', (file, _data, fileCache) => {
		void autoColorFileProperties(app, file, fileCache);
	});
}

const autoColorNormalizing = new Set<string>();

async function autoColorFileProperties(app: App, file: TFile, fileCache: CachedMetadata | null): Promise<void> {
	const frontmatter = fileCache?.frontmatter;
	if (!frontmatter || !app.fileManager) return;
	for (const [propertyName, options] of suggesterOptions) {
		const raw = frontmatterString(frontmatter[propertyName]);
		if (raw === null) continue;
		const value = raw.trim();
		if (!value) continue;
		const leadEmoji = [...value][0] ?? '';
		if (EMOJI_COLOR_MAP[leadEmoji]) continue; // already colored
		const guard = `${file.path}::${propertyName}`;
		if (autoColorNormalizing.has(guard)) continue;
		const emoji = leastUsedEmojiAmong(options);
		if (!emoji) continue;
		autoColorNormalizing.add(guard);
		try {
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				const current = frontmatterString(fm[propertyName]);
				if (current !== null && current.trim() === value) {
					fm[propertyName] = `${emoji} ${value}`;
				}
			});
		} catch (error) {
			console.error('KanbanView: global auto color-emoji failed', error);
		} finally {
			autoColorNormalizing.delete(guard);
		}
	}
}

/** Dot emoji of the palette color least used by the given option values. */
function leastUsedEmojiAmong(options: string[]): string | null {
	const counts = new Map<string, number>();
	for (const option of options) {
		const colorName = EMOJI_COLOR_MAP[[...option][0] ?? ''];
		if (colorName) counts.set(colorName, (counts.get(colorName) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestCount = Number.POSITIVE_INFINITY;
	for (const color of COLOR_PALETTE) {
		const count = counts.get(color.name) ?? 0;
		if (count < bestCount) {
			best = color.name;
			bestCount = count;
		}
	}
	return best ? (COLOR_NAME_TO_EMOJI[best] ?? null) : null;
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
	return isRecord(value) && !Array.isArray(value) && Object.values(value).every(isStringArray);
}

export function isColumnOrders(value: unknown): value is Record<string, string[]> {
	return isStringArrayRecord(value);
}

export function isColumnColors(value: unknown): value is Record<string, Record<string, string>> {
	return (
		isRecord(value) &&
		Object.values(value).every((v) => isRecord(v) && Object.values(v).every((c) => typeof c === 'string'))
	);
}

export function isColumnWidths(value: unknown): value is Record<string, Record<string, number>> {
	return (
		isRecord(value) &&
		Object.values(value).every((v) => isRecord(v) && Object.values(v).every((n) => typeof n === 'number'))
	);
}

export function isCardOrders(value: unknown): value is Record<string, Record<string, string[]>> {
	return (
		isRecord(value) &&
		!Array.isArray(value) &&
		Object.values(value).every((v) => isRecord(v) && !Array.isArray(v) && Object.values(v).every(isStringArray))
	);
}

export function isCollapsedLanes(value: unknown): value is Record<string, string[]> {
	return isStringArrayRecord(value);
}

// Module-level registry of open KanbanView instances. The global vault.rename
// listener (registered in main.ts) iterates this set to sync each board's
// in-session _prefs.cardOrders when a markdown file is renamed — otherwise the
// renamed card falls out of its saved order and gets appended to the end on
// next render.
const openKanbanViews = new Set<KanbanView>();

/**
 * Registers a single vault.rename listener that syncs all open KanbanView
 * boards. Returns the EventRef for Plugin.registerEvent.
 *
 * Bug fixed: card path strings in _prefs.cardOrders / .base config become
 * stale after a markdown rename. Without this sync, the renamed card falls
 * out of its saved order and gets appended to the end of its column.
 */
export function registerGlobalRenameSync(app: App): EventRef | null {
	const vault = app.vault;
	if (!vault || typeof vault.on !== 'function') return null;
	return vault.on('rename', (file, oldPath) => {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const newPath = file.path;
		if (oldPath === newPath) return;
		for (const view of openKanbanViews) {
			try {
				view.handleRename(oldPath, newPath);
			} catch (error) {
				console.error('KanbanView: handleRename failed', error);
			}
		}
	});
}

/** Narrow a raw config value to a BasesPropertyId ('note.x' / 'file.x' / 'formula.x'). */
function isBasesPropertyId(value: unknown): value is BasesPropertyId {
	return (
		typeof value === 'string' && (value.startsWith('note.') || value.startsWith('file.') || value.startsWith('formula.'))
	);
}

export class KanbanView extends BasesView {
	type = 'kanban-view';
	hoverPopover: HoverPopover | null = null;

	scrollEl: HTMLElement;
	containerEl: HTMLElement;
	private legacyData: LegacyData | null;
	private groupByPropertyId: BasesPropertyId | null = null;
	private swimlaneByPropertyId: BasesPropertyId | null = null;
	private cardTitlePropertyId: BasesPropertyId | null = null;
	private imagePropertyId: BasesPropertyId | null = null;
	private cardColorPropertyId: BasesPropertyId | null = null;
	private masonrySortPropertyId: BasesPropertyId | null = null;
	private _lastCardColorPropertyId: BasesPropertyId | null = null;
	private _lastCardColorOrderKey = '[]';
	/** Per-render cache: distinct card-color values + value→css-color map. */
	private _cardColorValues: string[] = [];
	/** Subset for the suggester/auto-color cache: configured + colored extras. */
	private _suggesterValues: string[] = [];
	private _cardColorMap: Map<string, string> = new Map();
	/** Per-render cache: value→resolved palette color name (mirrors _cardColorMap). */
	private _cardColorNames: Map<string, string> = new Map();
	/** Per-render usage count per palette color, so new values pick the least-used one. */
	private _cardColorCounts: Map<string, number> = new Map();
	/**
	 * User color overrides for card-color values (value → palette color name),
	 * scoped to the current cardColorPropertyId. Takes priority over the leading
	 * emoji and the automatic palette. Persisted under config key 'cardColors'
	 * (flushed on close like every other pref).
	 */
	private _cardColorPrefs: Record<string, string> = {};
	private _cardColorPrefsKey: BasesPropertyId | null = null;
	/** Re-entrancy guard so the render-time color sweep skips in-flight writes. */
	private _normalizingColorPaths: Set<string> = new Set();
	/** Set at the top of onClose; guards late renders/sweeps on a dead view. */
	private _closed = false;
	private _columnSortables: Map<string, Sortable> = new Map();
	private _entryMap: Map<string, BasesEntry> = new Map();
	private swimlaneSortable: Sortable | null = null;
	private swimlaneColumnSortables: Map<string | null, Sortable> = new Map();
	private _debouncedRender: DebouncedFn<() => void>;
	private activeColorPicker: HTMLElement | null = null;

	/**
	 * In-memory display preferences — the single source of truth during a session.
	 *
	 * Loaded from config once when groupByPropertyId changes. Renders read from
	 * here exclusively and never call config.set(). Only explicit user actions
	 * (drag-drop, column remove, color change) update _prefs and then call
	 * _persistPrefs() to write back to config.
	 *
	 * This breaks the config.set() → onDataUpdated() feedback loop that caused
	 * state thrashing on every render cycle.
	 */
	private _lastOrderKey: string = '';
	private _lastWrapValue: boolean | null = null;
	private _lastCardTitlePropertyId: BasesPropertyId | null | undefined = undefined;
	private _lastImagePropertyId: BasesPropertyId | null | undefined = undefined;
	private _lastImageFit: string | undefined = undefined;
	private _lastImageAspectRatio: number | undefined = undefined;
	private _lastSwimlanePropertyId: BasesPropertyId | null | undefined = undefined;
	private _lastQuickAddFolder: string | null | undefined = undefined;
	private _cardFingerprints: Map<string, string> = new Map();
	private _deferredSortableListeners: Map<string, { el: HTMLElement; handler: () => void }> = new Map();

	private _prefs: {
		columnOrder: string[];
		swimlaneOrder: string[];
		cardOrders: Record<string, string[]>;
		columnColors: Record<string, string>;
		columnWidths: Record<string, number>;
		collapsedLanes: Set<string>;
	} = {
		columnOrder: [],
		swimlaneOrder: [],
		cardOrders: {},
		columnColors: {}, // columnValue → colorName
		columnWidths: {}, // columnValue → px width
		collapsedLanes: new Set(),
	};
	private _prefsPropertyId: BasesPropertyId | null = null;
	private _prefsSwimlanePropertyId: BasesPropertyId | null = null;

	/**
	 * True while a card or column drag is in flight. When set, patchColumnCards
	 * skips DOM reordering so Sortable's live drag preview is not disturbed by
	 * re-renders triggered during the drag.
	 */
	private _dragging = false;
	/**
	 * Set when an interactive action (drag, color, width, reorder) mutates _prefs.
	 * Writing prefs to the .base config (config.set) makes Obsidian's Bases host
	 * tear down and rebuild the entire view, which is visible as a flash. So we
	 * never write config during interaction: _prefs is the in-session source of
	 * truth, and the dirty prefs are flushed to config once in onClose (where the
	 * unavoidable rebuild is invisible because the view is going away anyway).
	 */
	private _prefsDirty = false;
	/** Like _prefsDirty, but for the minimalMode view option. Flushed on close. */
	private _minimalModeDirty = false;
	private _activeCardPath: string | null = null;
	private _minimalMode = false;
	private _minimalToggleEl: HTMLElement | null = null;
	private _minimalRetryScheduled = false;
	/** Like _minimalModeDirty, but for masonryMode. Flushed on close. */
	private _masonryModeDirty = false;
	private _masonryMode = false;
	private _masonryToggleEl: HTMLElement | null = null;
	private _masonryRetryScheduled = false;
	private _lastMasonryEntriesKey = '';
	private _toolbarObserver: MutationObserver | null = null;

	constructor(controller: QueryController, scrollEl: HTMLElement, legacyData: LegacyData | null = null) {
		super(controller);
		this.scrollEl = scrollEl;
		this.containerEl = scrollEl.createDiv({ cls: CSS_CLASSES.VIEW_CONTAINER });
		this.legacyData = legacyData;
		openKanbanViews.add(this);

		// Delegated handler for internal links rendered inside property values.
		// Obsidian's global click handler only covers MarkdownView/TextFileView
		// containers; BasesView does not inherit that, so we wire it up explicitly.
		this.containerEl.on('click', 'a.internal-link', (evt, linkEl) => {
			evt.preventDefault();
			const href = linkEl.getAttribute('data-href') || linkEl.getAttribute('href');
			if (href && this.app) {
				const cardEl = linkEl.closest(`[${DATA_ATTRIBUTES.ENTRY_PATH}]`);
				const sourcePath = cardEl.instanceOf(HTMLElement) ? (cardEl.getAttribute(DATA_ATTRIBUTES.ENTRY_PATH) ?? '') : '';
				void this.app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(evt));
			}
		});

		// Middle-click on internal links inside cards opens the linked note in a
		// background tab — same convention as middle-clicking the card itself.
		this.containerEl.on('auxclick', 'a.internal-link', (evt, linkEl) => {
			if (!evt.instanceOf(MouseEvent) || evt.button !== 1) return;
			evt.preventDefault();
			const href = linkEl.getAttribute('data-href') || linkEl.getAttribute('href');
			if (!href || !this.app) return;
			const cardEl = linkEl.closest(`[${DATA_ATTRIBUTES.ENTRY_PATH}]`);
			const sourcePath = cardEl.instanceOf(HTMLElement) ? (cardEl.getAttribute(DATA_ATTRIBUTES.ENTRY_PATH) ?? '') : '';
			const file = this.app.metadataCache.getFirstLinkpathDest(href, sourcePath);
			if (file) this.openInBackgroundTab(file);
		});

		this.containerEl.on('mouseover', 'a.internal-link', (evt, linkEl) => {
			if (!evt.instanceOf(MouseEvent)) return;
			const href = linkEl.getAttribute('data-href') || linkEl.getAttribute('href');
			if (!href) return;
			const cardEl = linkEl.closest(`[${DATA_ATTRIBUTES.ENTRY_PATH}]`);
			const sourcePath = cardEl.instanceOf(HTMLElement) ? (cardEl.getAttribute(DATA_ATTRIBUTES.ENTRY_PATH) ?? '') : '';
			this.triggerHoverPreview(href, sourcePath, evt, linkEl);
		});

		// NOTE: live auto-coloring of edited values is handled by the PLUGIN-level
		// listener (registerGlobalAutoColor in main.ts), not per-view — Bases tears
		// this view down whenever its tab goes background, which is exactly when
		// the user is editing a note's property in another tab.

		this._debouncedRender = debounce(() => {
			if (this._closed) return;
			try {
				this.loadConfig();
				this.render();
			} catch (error) {
				console.error('KanbanView error:', error);
			}
		}, DEBOUNCE_DELAY);
	}

	onDataUpdated(): void {
		this._debouncedRender();
	}

	private loadConfig(): void {
		this.groupByPropertyId = this.config.getAsPropertyId('groupByProperty');
		this.swimlaneByPropertyId = this.config.getAsPropertyId('swimlaneByProperty');
		this.cardTitlePropertyId = this.config.getAsPropertyId('cardTitleProperty');
		this.imagePropertyId = this.config.getAsPropertyId('imageProperty');
		this.cardColorPropertyId = this.config.getAsPropertyId('cardColorProperty');
		this.masonrySortPropertyId = this.config.getAsPropertyId('masonrySortProperty');
		this._minimalMode = this.config.get('minimalMode') === true;
		this._masonryMode = this.config.get('masonryMode') === true;
	}

	/**
	 * Build the value→color map and distinct-value list for the card-color
	 * property. Each distinct value gets a color: a user override wins, else a
	 * leading color emoji (🔴 → red), else the least-used palette color so new
	 * values avoid colors already taken (instead of colliding by index). Every
	 * value therefore always resolves to a color (never blank).
	 */
	private _computeCardColors(entries: BasesEntry[]): void {
		this._cardColorValues = [];
		this._cardColorMap = new Map();
		if (!this.cardColorPropertyId) return;

		// Load this property's color overrides once when the property changes.
		if (this.cardColorPropertyId !== this._cardColorPrefsKey) {
			this._cardColorPrefsKey = this.cardColorPropertyId;
			const rawCardColors = this.config?.get('cardColors');
			const all = isColumnColors(rawCardColors) ? rawCardColors : {};
			this._cardColorPrefs = { ...(all[this.cardColorPropertyId] ?? {}) };
		}

		// Values actually present in the data. A Bases Value wrapper is truthy
		// even when its inner data is null (a card whose property was cleared),
		// and then stringifies to the literal "null" — skip it, or every card's
		// switcher grows a phantom "null" option.
		const seen = new Set<string>();
		for (const entry of entries) {
			const value = entry.getValue(this.cardColorPropertyId);
			if (!value) continue;
			const raw = value.toString().trim();
			if (!raw || raw === 'null' || seen.has(raw)) continue;
			seen.add(raw);
		}

		// A user-configured ordered list (cardColorOrder) defines the full set of
		// switcher options and their order/color. Any in-data value not listed is
		// appended (sorted) so nothing is unselectable. With no config, fall back
		// to the sorted in-data values.
		const rawConfigured = this.config?.get('cardColorOrder');
		const configured = Array.isArray(rawConfigured)
			? rawConfigured.map((v) => String(v).trim()).filter((v) => v.length > 0)
			: [];
		const extras = [...seen].filter((v) => !configured.includes(v)).sort();
		const values = configured.length > 0 ? [...configured, ...extras] : [...seen].sort();
		this._cardColorValues = values;

		// What the suggester/auto-color cache gets: configured options as-is plus
		// only the COLORED in-data extras. Raw extras are transient by design
		// (the write-time patch / auto-color listener rewrites them) — caching
		// one would resurface it as a ghost menu entry after it's been recolored.
		this._suggesterValues = [...configured, ...extras.filter((v) => EMOJI_COLOR_MAP[[...v][0] ?? ''])];

		// First pass: values with an explicit color (override or leading emoji)
		// claim their color and bump its usage count.
		this._cardColorNames = new Map();
		this._cardColorCounts = new Map();
		const explicit = new Map<string, string>();
		for (const value of values) {
			const override = this._cardColorPrefs[value];
			const leadEmoji = [...value][0] ?? '';
			const colorName = override ?? EMOJI_COLOR_MAP[leadEmoji];
			if (colorName) {
				explicit.set(value, colorName);
				this._cardColorCounts.set(colorName, (this._cardColorCounts.get(colorName) ?? 0) + 1);
			}
		}

		// Second pass: emoji-less values each take the least-used palette color
		// (in list order, so assignment stays deterministic across renders).
		for (const value of values) {
			let colorName = explicit.get(value);
			if (!colorName) {
				colorName = this._leastUsedColorName();
				this._cardColorCounts.set(colorName, (this._cardColorCounts.get(colorName) ?? 0) + 1);
			}
			this._cardColorNames.set(value, colorName);
			const paletteEntry = COLOR_PALETTE.find((c) => c.name === colorName);
			if (paletteEntry) this._cardColorMap.set(value, paletteEntry.cssVar);
		}
	}

	/** First palette color with the lowest current usage count. */
	private _leastUsedColorName(): string {
		let best: string = COLOR_PALETTE[0].name;
		let bestCount = Number.POSITIVE_INFINITY;
		for (const color of COLOR_PALETTE) {
			const count = this._cardColorCounts.get(color.name) ?? 0;
			if (count < bestCount) {
				best = color.name;
				bestCount = count;
			}
		}
		return best;
	}

	/** Bare frontmatter key of the card-color property (e.g. "phase"), if any. */
	private _suggesterPropertyName(): string | null {
		if (!this.cardColorPropertyId) return null;
		const parsed = parsePropertyId(this.cardColorPropertyId);
		return parsed.type === 'note' && parsed.name ? parsed.name : null;
	}

	/**
	 * Refresh this board's option list in the module-level cache (persisting it
	 * when it changed) and make sure the suggester wrapper is installed.
	 */
	private _patchPropertySuggester(): void {
		const propertyName = this._suggesterPropertyName();
		if (!propertyName || !this.app) return;
		// The cache feeds the suggester wrapper, the write-time patch and the
		// global auto-color listener — refresh it on every render.
		const next = this._suggesterValues;
		const prev = suggesterOptions.get(propertyName);
		const changed = !prev || prev.length !== next.length || prev.some((value, i) => value !== next[i]);
		suggesterOptions.set(propertyName, [...next]);
		if (changed) persistSuggesterOptions();
		installPropertySuggesterPatch(this.app);
	}

	private triggerHoverPreview(linktext: string, sourcePath: string, event: MouseEvent, targetEl: HTMLElement): void {
		this.app?.workspace.trigger('hover-link', {
			event,
			source: HOVER_LINK_SOURCE_ID,
			hoverParent: this,
			targetEl,
			linktext,
			sourcePath,
		});
	}

	/**
	 * Composite key used by `_prefs.cardOrders` to disambiguate card order across
	 * swimlanes. When swimlanes are inactive, returns the bare column value so
	 * existing flat-mode persistence continues to round-trip unchanged.
	 */
	private cardOrderKey(swimlaneValue: string | null, columnValue: string): string {
		return swimlaneValue === null ? columnValue : `${swimlaneValue}${SWIMLANE_KEY_SEPARATOR}${columnValue}`;
	}

	private swimlanePrefsKey(groupPropertyId: BasesPropertyId, swimlanePropertyId: BasesPropertyId): string {
		return `${groupPropertyId}${SWIMLANE_KEY_SEPARATOR}${swimlanePropertyId}`;
	}

	/**
	 * Load display preferences from config for the given propertyId.
	 * Called once when groupByPropertyId changes; subsequent renders reuse _prefs.
	 */
	private _loadPrefs(propertyId: BasesPropertyId, swimlanePropertyId: BasesPropertyId | null): void {
		this._prefsPropertyId = propertyId;
		this._prefsSwimlanePropertyId = swimlanePropertyId;
		const swimlaneScopedKey = swimlanePropertyId ? this.swimlanePrefsKey(propertyId, swimlanePropertyId) : null;

		// Column order — with legacy migration
		const rawOrders = this.config?.get('columnOrders');
		const allOrders = isColumnOrders(rawOrders) ? rawOrders : {};
		let columnOrder = allOrders[propertyId] ?? null;
		const legacyOrder = this.legacyData?.columnOrders[propertyId] ?? null;
		if (!columnOrder && legacyOrder) {
			columnOrder = legacyOrder;
			// One-time migration from plugin.data.json: keep the value in _prefs and
			// let it persist on close (never config.set mid-session — that flashes).
			this._prefsDirty = true;
		}
		this._prefs.columnOrder = columnOrder ? [...columnOrder] : [];

		// Card orders — with stale-path recovery for files renamed while the board
		// was closed. Without recovery, a renamed card falls out of its saved
		// position and gets appended to the end of its column on next render.
		const rawCardOrders = this.config?.get('cardOrders');
		const allCardOrders = isCardOrders(rawCardOrders) ? rawCardOrders : {};
		const savedCardOrders = allCardOrders[swimlaneScopedKey ?? propertyId] ?? {};
		let recoveredAny = false;
		this._prefs.cardOrders = Object.fromEntries(
			Object.entries(savedCardOrders).map(([k, v]) => {
				const repaired = v.map((path) => {
					const recovered = this.recoverStalePath(path);
					if (recovered !== path) recoveredAny = true;
					return recovered;
				});
				return [k, repaired];
			}),
		);
		if (recoveredAny) {
			// Persist the corrected paths on close so the .base no longer carries
			// the stale references (and the recovery only runs once per rename).
			this._prefsDirty = true;
		}

		// Column colors — with legacy migration
		const rawColors = this.config?.get('columnColors');
		const allColors = isColumnColors(rawColors) ? rawColors : {};
		let columnColors = allColors[propertyId] ?? null;
		const legacyColors = this.legacyData?.columnColors[propertyId];
		if (!columnColors && legacyColors && Object.keys(legacyColors).length > 0) {
			columnColors = legacyColors;
			// One-time migration; persist on close rather than config.set (flashes).
			this._prefsDirty = true;
		}
		this._prefs.columnColors = columnColors ? { ...columnColors } : {};

		// Per-column widths (px), scoped by group property. No legacy migration.
		const rawWidths = this.config?.get('columnWidths');
		const allWidths = isColumnWidths(rawWidths) ? rawWidths : {};
		const columnWidths = allWidths[propertyId] ?? null;
		this._prefs.columnWidths = columnWidths ? { ...columnWidths } : {};

		// Collapsed swimlanes — scoped by group+swimlane property; default = none
		// collapsed (lanes start fully expanded so all cards are visible).
		const rawCollapsed = this.config?.get('collapsedLanes');
		const allCollapsed = isCollapsedLanes(rawCollapsed) ? rawCollapsed : {};
		this._prefs.collapsedLanes = new Set(swimlaneScopedKey ? (allCollapsed[swimlaneScopedKey] ?? []) : []);

		// Swimlane order — scoped by group+swimlane property. Same shape as
		// columnOrders (Record<key, string[]>) so isColumnOrders is the appropriate guard.
		const rawSwimlaneOrders = this.config?.get('swimlaneOrders');
		const allSwimlaneOrders = isColumnOrders(rawSwimlaneOrders) ? rawSwimlaneOrders : {};
		this._prefs.swimlaneOrder =
			swimlaneScopedKey && allSwimlaneOrders[swimlaneScopedKey] ? [...allSwimlaneOrders[swimlaneScopedKey]] : [];
	}

	/**
	 * Write _prefs back to config. Called only on user actions (drag-drop,
	 * column remove, color change) — never during renders.
	 *
	 * Change guards skip config.set() when the value hasn't changed, preventing
	 * spurious onDataUpdated() triggers.
	 */
	private _persistConfigKey<T>(
		key: string,
		guard: (v: unknown) => v is Record<string, T>,
		newValue: T,
		storageKey: string | null = this._prefsPropertyId,
	): void {
		if (!storageKey) return;
		const raw = this.config?.get(key);
		const all: Record<string, T> = guard(raw) ? raw : {};
		if (JSON.stringify(all[storageKey]) !== JSON.stringify(newValue)) {
			this.config?.set(key, { ...all, [storageKey]: newValue });
		}
	}

	/**
	 * Mark in-session prefs as needing persistence. Does NOT write config — see
	 * _prefsDirty. The actual write happens in _flushPrefs() on view close.
	 */
	private _persistPrefs(): void {
		this._prefsDirty = true;
	}

	/**
	 * Write the in-session prefs to the .base config. Called only from onClose,
	 * never mid-session: each config.set() makes the Bases host rebuild the view
	 * (a visible flash), which is acceptable only when the view is closing.
	 */
	private _flushPrefs(): void {
		try {
			if (this._minimalModeDirty) {
				this._minimalModeDirty = false;
				this.config?.set('minimalMode', this._minimalMode);
			}
			if (this._masonryModeDirty) {
				this._masonryModeDirty = false;
				this.config?.set('masonryMode', this._masonryMode);
			}
			if (this._prefsDirty && this._prefsPropertyId) {
				this._prefsDirty = false;
				const swimlaneScopedKey = this._prefsSwimlanePropertyId
					? this.swimlanePrefsKey(this._prefsPropertyId, this._prefsSwimlanePropertyId)
					: null;

				this._persistConfigKey('columnOrders', isColumnOrders, this._prefs.columnOrder, this._prefsPropertyId);
				this._persistConfigKey(
					'cardOrders',
					isCardOrders,
					this._prefs.cardOrders,
					swimlaneScopedKey ?? this._prefsPropertyId,
				);
				this._persistConfigKey('columnColors', isColumnColors, this._prefs.columnColors, this._prefsPropertyId);
				this._persistConfigKey('columnWidths', isColumnWidths, this._prefs.columnWidths, this._prefsPropertyId);

				// Card-color overrides are scoped by the card-color property, not the group.
				if (this.cardColorPropertyId) {
					this._persistConfigKey('cardColors', isColumnColors, this._cardColorPrefs, this.cardColorPropertyId);
				}

				if (swimlaneScopedKey) {
					this._persistConfigKey('swimlaneOrders', isColumnOrders, this._prefs.swimlaneOrder, swimlaneScopedKey);
					this._persistConfigKey(
						'collapsedLanes',
						isCollapsedLanes,
						Array.from(this._prefs.collapsedLanes),
						swimlaneScopedKey,
					);
				}
			}
		} catch (error) {
			console.error('KanbanView: failed to flush prefs to config on close', error);
		}
	}

	private render(): void {
		try {
			const entries = this.data?.data || [];
			const availablePropertyIds = this.allProperties || [];

			if (!this.groupByPropertyId && availablePropertyIds.length === 0) {
				this.fullReset();
				this.containerEl.createDiv({
					text: EMPTY_STATE_MESSAGES.NO_PROPERTIES,
					cls: CSS_CLASSES.EMPTY_STATE,
				});
				return;
			}
			if (!this.groupByPropertyId) {
				this.groupByPropertyId = availablePropertyIds[0];
			}
			// If groupByPropertyId is set but is no longer in availablePropertyIds
			// (e.g. all notes with that property were removed), keep the configured
			// value so the board renders from persisted prefs rather than switching
			// to an unrelated property.

			// Swimlane on the same axis as the column group is meaningless — every
			// lane would contain a single populated column. Treat as unset.
			const swimlanePropertyId =
				this.swimlaneByPropertyId && this.swimlaneByPropertyId !== this.groupByPropertyId
					? this.swimlaneByPropertyId
					: null;

			// Reload prefs when either grouping axis changes.
			const groupChanged = this.groupByPropertyId !== this._prefsPropertyId;
			if (groupChanged || swimlanePropertyId !== this._prefsSwimlanePropertyId) {
				// Persist the outgoing axis's prefs before switching keys, so a
				// group/swimlane change does not drop unflushed in-session edits.
				// (Group changes already force a full rebuild, so the config write
				// here adds no extra flash beyond the rebuild that happens anyway.)
				this._flushPrefs();
				this._loadPrefs(this.groupByPropertyId, swimlanePropertyId);
			}

			const hasNoEntries = entries.length === 0;
			const hasNoSavedColumns = this._prefs.columnOrder.length === 0;
			if (hasNoEntries && hasNoSavedColumns) {
				this.fullReset();
				this.containerEl.createDiv({
					text: EMPTY_STATE_MESSAGES.NO_ENTRIES,
					cls: CSS_CLASSES.EMPTY_STATE,
				});
				return;
			}
			// hasNoEntries && !hasNoSavedColumns: board has saved columns — render them as empty so the user can see and manage them.

			// Build path→entry lookup map for O(1) access in handleCardDrop
			this._entryMap = new Map(entries.map((e: BasesEntry) => [e.file.path, e]));

			// Distinct values + color map for the card-color / status property.
			this._computeCardColors(entries);

			// Feed the full option list to Obsidian's native property-value
			// suggester so both menus offer the same choices.
			if (this.cardColorPropertyId) this._patchPropertySuggester();

			// Catch-up pass: color any raw value already sitting on the board, e.g.
			// typed while the board was closed (the metadataCache listener only lives
			// while a view instance is open) or a brand-new card whose first change
			// event raced the entry-map rebuild. Self-terminating: rewritten values
			// carry an emoji, so the next render's sweep skips them.
			this._sweepColorEmoji(entries);

			// Global column width slider → CSS variable on the container.
			this._applyGlobalColumnWidth();

			// Masonry mode: bypass column layout, render flat card gallery.
			if (this._masonryMode) {
				// Clear any existing kanban board (switching from kanban → masonry).
				if (this.containerEl.querySelector(`.${CSS_CLASSES.BOARD}`)) {
					this.destroySortables();
					this.containerEl.empty();
				}
				const cols = Math.max(2, Math.min(12, Number(this.config?.get('masonryColumns')) || 4));
				this.containerEl.style.setProperty('--obk-masonry-columns', String(cols));
				const colorPropId = this.cardColorPropertyId;
				const sortPropId = this.masonrySortPropertyId;
				const entriesKey =
					entries.map((e) => e.file.path).join('\0') +
					`|${cols}` +
					(colorPropId ? `|${entries.map((e) => String(e.getValue(colorPropId) ?? '')).join('\0')}` : '') +
					(sortPropId ? `|sort:${entries.map((e) => String(e.getValue(sortPropId) ?? '')).join('\0')}` : '');
				if (
					!this.containerEl.querySelector(`.${CSS_CLASSES.MASONRY_BOARD}`) ||
					this._lastMasonryEntriesKey !== entriesKey
				) {
					this._lastMasonryEntriesKey = entriesKey;
					this._renderMasonry(entries);
				}
				this._applyMinimalMode();
				this._ensureMinimalToggle();
				this._ensureMasonryToggle();
				return;
			}
			// Leaving masonry mode — the masonry board will be cleared by fullRebuild
			// below (existingBoard is null when no .obk-board exists).
			this._ensureMasonryToggle();

			// Group entries — 2D when swimlanes are active, 1D otherwise. The
			// column-axis preference logic (order, colors, new-value detection)
			// runs against the union of columns across all lanes, so a single
			// canonical column ordering is shared by every lane.
			const groupedByLane = swimlanePropertyId
				? this.groupEntriesBySwimlaneAndColumn(entries, swimlanePropertyId, this.groupByPropertyId)
				: null;
			const groupedEntries = groupedByLane
				? this.flattenLanes(groupedByLane)
				: this.groupEntriesByProperty(entries, this.groupByPropertyId);
			const sortActive = this.hasActiveSort();

			// Apply manual card order only when the Base itself is not sorted.
			// When sorting is active, Bases has already ordered `entries`.
			if (!sortActive && groupedByLane) {
				groupedByLane.forEach((columns, laneValue) => {
					columns.forEach((cellEntries, columnValue) => {
						const savedOrder = this._prefs.cardOrders[this.cardOrderKey(laneValue, columnValue)];
						if (savedOrder) {
							columns.set(columnValue, this.applyCardOrder(cellEntries, savedOrder));
						}
					});
				});
			} else if (!sortActive) {
				groupedEntries.forEach((columnEntries, value) => {
					const savedOrder = this._prefs.cardOrders[this.cardOrderKey(null, value)];
					if (savedOrder) {
						groupedEntries.set(value, this.applyCardOrder(columnEntries, savedOrder));
					}
				});
			}

			// Merge any newly-seen column values into prefs and persist eagerly.
			// This is the only place render() calls _persistPrefs(), and only when
			// new columns appear — not on every render pass.
			const liveValues = Array.from(groupedEntries.keys());
			const liveValueSet = new Set(liveValues);
			let shouldPersistColumnOrder = false;
			if (this._prefs.columnOrder.includes(UNCATEGORIZED_LABEL) && !liveValueSet.has(UNCATEGORIZED_LABEL)) {
				this._prefs.columnOrder = this._prefs.columnOrder.filter((value) => value !== UNCATEGORIZED_LABEL);
				shouldPersistColumnOrder = true;
			}
			const newValues = liveValues.filter((v) => !this._prefs.columnOrder.includes(v));
			if (newValues.length > 0) {
				const isInitialOrder = this._prefs.columnOrder.length === 0;
				// No prior order — sort alphabetically as the initial ordering
				this._prefs.columnOrder = isInitialOrder ? [...newValues].sort() : [...this._prefs.columnOrder, ...newValues];
				shouldPersistColumnOrder = true;
			}
			if (shouldPersistColumnOrder) {
				this._persistPrefs();
			}

			const orderedValues = this.getOrderedColumnValues(liveValues);

			const currentOrderKey = JSON.stringify(this.config?.getOrder() ?? []);
			const orderChanged = currentOrderKey !== this._lastOrderKey;
			this._lastOrderKey = currentOrderKey;

			const currentWrapValue = this.config?.get('wrapPropertyValues') === true;
			const wrapChanged = currentWrapValue !== this._lastWrapValue;
			this._lastWrapValue = currentWrapValue;

			const currentCardTitlePropertyId = this.cardTitlePropertyId;
			const cardTitleChanged = currentCardTitlePropertyId !== this._lastCardTitlePropertyId;
			this._lastCardTitlePropertyId = currentCardTitlePropertyId;

			const currentImagePropertyId = this.imagePropertyId;
			const imagePropertyChanged = currentImagePropertyId !== this._lastImagePropertyId;
			this._lastImagePropertyId = currentImagePropertyId;

			const currentCardColorPropertyId = this.cardColorPropertyId;
			const cardColorPropertyChanged = currentCardColorPropertyId !== this._lastCardColorPropertyId;
			this._lastCardColorPropertyId = currentCardColorPropertyId;

			const currentCardColorOrderKey = JSON.stringify(this.config?.get('cardColorOrder') ?? []);
			const cardColorOrderChanged = currentCardColorOrderKey !== this._lastCardColorOrderKey;
			this._lastCardColorOrderKey = currentCardColorOrderKey;
			const cardColorChanged = cardColorPropertyChanged || cardColorOrderChanged;

			const currentImageFit = this.config?.get('imageFit') === 'contain' ? 'contain' : 'cover';
			const imageFitChanged = currentImageFit !== this._lastImageFit;
			this._lastImageFit = currentImageFit;

			const rawRatio = Number(this.config?.get('imageAspectRatio'));
			const currentImageAspectRatio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : 0.5;
			const imageAspectRatioChanged = currentImageAspectRatio !== this._lastImageAspectRatio;
			this._lastImageAspectRatio = currentImageAspectRatio;

			const currentSwimlanePropertyId = swimlanePropertyId;
			const swimlanePropertyChanged = currentSwimlanePropertyId !== this._lastSwimlanePropertyId;
			this._lastSwimlanePropertyId = currentSwimlanePropertyId;

			const currentQuickAddFolder = this.getQuickAddFolder();
			const quickAddFolderChanged = currentQuickAddFolder !== this._lastQuickAddFolder;
			this._lastQuickAddFolder = currentQuickAddFolder;

			const existingBoard = this.containerEl.querySelector<HTMLElement>(`.${CSS_CLASSES.BOARD}`);
			const optionsChanged =
				orderChanged ||
				wrapChanged ||
				cardTitleChanged ||
				imagePropertyChanged ||
				imageFitChanged ||
				imageAspectRatioChanged ||
				swimlanePropertyChanged ||
				cardColorChanged ||
				quickAddFolderChanged;

			const lanes = new Map<string | null, Map<string, BasesEntry[]>>();
			if (groupedByLane) {
				groupedByLane.forEach((v, k) => lanes.set(k, v));
			} else {
				lanes.set(null, groupedEntries);
			}
			const hasSwimlanes = groupedByLane !== null;
			const existingIsSwimlane = existingBoard?.classList.contains(CSS_CLASSES.BOARD_WITH_SWIMLANES) ?? false;
			const modeChanged = hasSwimlanes !== existingIsSwimlane;

			// Hide columns with no entries (when there are entries in the board).
			// Keeps all saved columns when the board is entirely empty (config mode).
			const valuesToRender =
				entries.length > 0
					? (() => {
							const nonEmpty = orderedValues.filter((v) => {
								for (const cols of lanes.values()) {
									if ((cols.get(v)?.length ?? 0) > 0) return true;
								}
								return false;
							});
							return nonEmpty.length > 0 ? nonEmpty : orderedValues;
						})()
					: orderedValues;

			if (!existingBoard || modeChanged || groupChanged || optionsChanged) {
				this.fullRebuild(valuesToRender, lanes, hasSwimlanes);
			} else {
				this.patchBoard(valuesToRender, lanes, hasSwimlanes);
			}
			this.reapplyActiveCard();
			this._applyMinimalMode();
			this._ensureMinimalToggle();
			this._ensureMasonryToggle();
		} catch (error) {
			console.error('KanbanView error:', error);
		}
	}

	private destroySortables(): void {
		this._columnSortables.forEach((s) => s.destroy());
		this._columnSortables.clear();
		if (this.swimlaneSortable) {
			this.swimlaneSortable.destroy();
			this.swimlaneSortable = null;
		}
		this.swimlaneColumnSortables.forEach((s) => s.destroy());
		this.swimlaneColumnSortables.clear();
		this._deferredSortableListeners.forEach(({ el, handler }) => {
			el.removeEventListener('pointerdown', handler);
		});
		this._deferredSortableListeners.clear();
	}

	private fullReset(): void {
		this.containerEl.empty();
		this.destroySortables();
		this._entryMap.clear();
		this._cardFingerprints.clear();
	}

	private fullRebuild(
		orderedColumnValues: string[],
		lanes: Map<string | null, Map<string, BasesEntry[]>>,
		hasSwimlanes: boolean,
	): void {
		this.containerEl.empty();
		this.containerEl.classList.toggle(CSS_CLASSES.VIEW_CONTAINER_WITH_SWIMLANES, hasSwimlanes);
		this.destroySortables();
		const boardEl = this.containerEl.createDiv({
			cls: hasSwimlanes ? `${CSS_CLASSES.BOARD} ${CSS_CLASSES.BOARD_WITH_SWIMLANES}` : CSS_CLASSES.BOARD,
		});

		if (hasSwimlanes) {
			const liveLaneValues = [...lanes.keys()].filter((k): k is string => k !== null);
			// Merge any newly-seen lane values into prefs once, on first observation.
			// Mirrors the column-order init in render() — alphabetical for the
			// initial save, append for subsequent additions. Persisted eagerly so
			// the order survives a reload even before the user reorders manually.
			const newLaneValues = liveLaneValues.filter((v) => !this._prefs.swimlaneOrder.includes(v));
			if (newLaneValues.length > 0) {
				const isInitialOrder = this._prefs.swimlaneOrder.length === 0;
				if (isInitialOrder) {
					this._prefs.swimlaneOrder = this._sortSwimlaneValues(newLaneValues);
				} else {
					this._prefs.swimlaneOrder = [...this._prefs.swimlaneOrder, ...newLaneValues];
				}
				this._persistPrefs();
			}

			const orderedLanes = this.getOrderedSwimlaneValues(liveLaneValues);
			orderedLanes.forEach((laneValue) => {
				const laneEntries = lanes.get(laneValue) ?? new Map<string, BasesEntry[]>();
				const laneColumns = this._filterLaneColumns(orderedColumnValues, laneEntries);
				const laneEl = this._buildSwimlaneElement(laneValue, laneEntries, laneColumns);
				boardEl.appendChild(laneEl);
				const bodyEl = laneEl.querySelector<HTMLElement>(`.${CSS_CLASSES.SWIMLANE_BODY}`);
				if (bodyEl) this.swimlaneColumnSortables.set(laneValue, this._createColumnSortable(bodyEl));
			});

			this.initializeSwimlaneSortable(boardEl);
		} else {
			const colEntries = lanes.get(null) ?? new Map<string, BasesEntry[]>();
			orderedColumnValues.forEach((colValue) => {
				const colEl = this.createColumn(colValue, colEntries.get(colValue) ?? []);
				boardEl.appendChild(colEl);
				const cardBody = colEl.querySelector<HTMLElement>(
					`.${CSS_CLASSES.COLUMN_BODY}[${DATA_ATTRIBUTES.SORTABLE_CONTAINER}]`,
				);
				if (cardBody) this.attachCardSortable(cardBody, this.cardOrderKey(null, colValue));
			});
			this.swimlaneColumnSortables.set(null, this._createColumnSortable(boardEl));
		}
	}

	private _buildRowCtx(): RowRenderCtx {
		return {
			...this._buildColumnCtx(),
			collapsedLanes: this._prefs.collapsedLanes,
		};
	}

	private _buildRowCallbacks(): RowCallbacks {
		return {
			...this._buildColumnCallbacks(),
			onToggleCollapsed: (laneVal, laneEl, toggleBtn) => this.toggleSwimlaneCollapsed(laneVal, laneEl, toggleBtn),
			attachCardSortable: (body, key) => this.attachCardSortable(body, key),
			cardOrderKey: (laneVal, colVal) => this.cardOrderKey(laneVal, colVal),
		};
	}

	/**
	 * Filter column values to only those with at least one entry in this lane.
	 * When the lane itself is empty, returns all columns so the user can still
	 * see and manage the config. Shared by fullRebuild and patchBoard.
	 */
	private _filterLaneColumns(allColumns: string[], laneEntries: Map<string, BasesEntry[]>): string[] {
		const hasAnyInLane = [...laneEntries.values()].some((es) => es.length > 0);
		if (!hasAnyInLane) return allColumns;
		const visible = allColumns.filter((v) => (laneEntries.get(v)?.length ?? 0) > 0);
		return visible.length > 0 ? visible : allColumns;
	}

	private _buildSwimlaneElement(
		laneValue: string,
		laneEntries: Map<string, BasesEntry[]>,
		orderedColumnValues: string[],
	): HTMLElement {
		return buildSwimlaneElementEl(
			laneValue,
			laneEntries,
			orderedColumnValues,
			this._buildRowCtx(),
			this._buildRowCallbacks(),
		);
	}

	private _createColumnSortable(containerEl: HTMLElement): Sortable {
		return new Sortable(containerEl, {
			animation: SORTABLE_CONFIG.ANIMATION_DURATION,
			handle: `.${CSS_CLASSES.COLUMN_DRAG_HANDLE}`,
			draggable: `.${CSS_CLASSES.COLUMN}`,
			ghostClass: CSS_CLASSES.COLUMN_GHOST,
			dragClass: CSS_CLASSES.COLUMN_DRAGGING,
			onStart: () => {
				this._dragging = true;
			},
			onEnd: (evt: Sortable.SortableEvent) => {
				this._dragging = false;
				try {
					this.handleSwimlaneColumnDrop(evt);
				} catch (error) {
					console.error('KanbanView: error handling column drop', error);
				}
			},
		});
	}

	private initializeSwimlaneSortable(boardEl: HTMLElement): void {
		if (this.swimlaneSortable) {
			this.swimlaneSortable.destroy();
			this.swimlaneSortable = null;
		}

		this.swimlaneSortable = new Sortable(boardEl, {
			animation: SORTABLE_CONFIG.ANIMATION_DURATION,
			handle: `.${CSS_CLASSES.SWIMLANE_DRAG_HANDLE}`,
			draggable: `.${CSS_CLASSES.SWIMLANE}`,
			ghostClass: CSS_CLASSES.SWIMLANE_GHOST,
			dragClass: CSS_CLASSES.SWIMLANE_DRAGGING,
			onStart: () => {
				this._dragging = true;
			},
			onEnd: () => {
				this._dragging = false;
				this.handleSwimlaneDrop(boardEl);
			},
		});
	}

	private handleSwimlaneDrop(boardEl: HTMLElement): void {
		const lanes = boardEl.querySelectorAll(`.${CSS_CLASSES.SWIMLANE}`);
		const order = Array.from(lanes)
			.map((lane) => lane.getAttribute(DATA_ATTRIBUTES.SWIMLANE_VALUE))
			.filter((v): v is string => v !== null);
		this._prefs.swimlaneOrder = order;
		this._persistPrefs();
	}

	private handleSwimlaneColumnDrop(evt: Sortable.SortableEvent): void {
		if (!this._prefsPropertyId || !evt.to.instanceOf(HTMLElement)) return;

		const order = Array.from(evt.to.children)
			.filter(
				(child): child is HTMLElement => child.instanceOf(HTMLElement) && child.classList.contains(CSS_CLASSES.COLUMN),
			)
			.map((col) => col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE))
			.filter((v): v is string => v !== null);

		if (order.length === 0) return;

		this._prefs.columnOrder = order;
		this._persistPrefs();
		this.render();
	}

	private patchBoard(
		orderedColumnValues: string[],
		lanes: Map<string | null, Map<string, BasesEntry[]>>,
		hasSwimlanes: boolean,
	): void {
		const boardEl = this.containerEl.querySelector<HTMLElement>(`.${CSS_CLASSES.BOARD}`);
		if (!boardEl) {
			console.error('KanbanView: patchBoard called but board element not found; skipping patch');
			return;
		}

		// Card rebuilds and DOM re-parenting can clamp scrollTop. Capture up-front
		// keyed by cardOrderKey(laneValue, colValue) and restore after layout settles.
		const scrollPositions = new Map<string, number>();
		boardEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN_BODY}`).forEach((body) => {
			const colEl = body.closest<HTMLElement>(`.${CSS_CLASSES.COLUMN}`);
			const colVal = colEl?.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE);
			const laneEl = body.closest<HTMLElement>(`.${CSS_CLASSES.SWIMLANE}`);
			const laneVal = laneEl?.getAttribute(DATA_ATTRIBUTES.SWIMLANE_VALUE) ?? null;
			if (colVal) scrollPositions.set(this.cardOrderKey(laneVal, colVal), body.scrollTop);
		});

		if (hasSwimlanes) {
			const liveLaneValues = [...lanes.keys()].filter((k): k is string => k !== null);
			// Merge any newly-seen lane values into prefs.
			const newLaneValues = liveLaneValues.filter((v) => !this._prefs.swimlaneOrder.includes(v));
			if (newLaneValues.length > 0) {
				const isInitialOrder = this._prefs.swimlaneOrder.length === 0;
				if (isInitialOrder) {
					this._prefs.swimlaneOrder = this._sortSwimlaneValues(newLaneValues);
				} else {
					this._prefs.swimlaneOrder = [...this._prefs.swimlaneOrder, ...newLaneValues];
				}
				this._persistPrefs();
			}

			const orderedLanes = this.getOrderedSwimlaneValues(liveLaneValues);
			const newLaneSet = new Set(orderedLanes);

			// Index existing lanes
			const existingLanes = new Map<string, HTMLElement>();
			boardEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.SWIMLANE}`).forEach((laneEl) => {
				const val = laneEl.getAttribute(DATA_ATTRIBUTES.SWIMLANE_VALUE);
				if (val !== null) existingLanes.set(val, laneEl);
			});

			// Remove lanes not in new set
			existingLanes.forEach((laneEl, laneValue) => {
				if (!newLaneSet.has(laneValue)) {
					const colSortable = this.swimlaneColumnSortables.get(laneValue);
					if (colSortable) {
						colSortable.destroy();
						this.swimlaneColumnSortables.delete(laneValue);
					}
					orderedColumnValues.forEach((colVal) => {
						const key = this.cardOrderKey(laneValue, colVal);
						const s = this._columnSortables.get(key);
						if (s) {
							s.destroy();
							this._columnSortables.delete(key);
						}
					});
					laneEl.remove();
					existingLanes.delete(laneValue);
				}
			});

			// Patch or create lanes
			orderedLanes.forEach((laneValue) => {
				const laneEntries = lanes.get(laneValue) ?? new Map<string, BasesEntry[]>();
				const laneColumns = this._filterLaneColumns(orderedColumnValues, laneEntries);
				if (!existingLanes.has(laneValue)) {
					const laneEl = this._buildSwimlaneElement(laneValue, laneEntries, laneColumns);
					boardEl.appendChild(laneEl);
					existingLanes.set(laneValue, laneEl);
					const bodyEl = laneEl.querySelector<HTMLElement>(`.${CSS_CLASSES.SWIMLANE_BODY}`);
					if (bodyEl) {
						this.swimlaneColumnSortables.set(laneValue, this._createColumnSortable(bodyEl));
					} else {
						console.error('KanbanView: swimlane body element not found; column sorting will be broken', laneValue);
					}
				} else {
					const laneEl = existingLanes.get(laneValue);
					if (laneEl) {
						// Update lane count
						const countEl = laneEl.querySelector(`.${CSS_CLASSES.SWIMLANE_COUNT}`);
						if (countEl) {
							const count = orderedColumnValues.reduce((sum, col) => sum + (laneEntries.get(col)?.length ?? 0), 0);
							countEl.textContent = `${count}`;
						}
						// Patch columns within lane body (using per-lane visible columns)
						const bodyEl = laneEl.querySelector<HTMLElement>(`.${CSS_CLASSES.SWIMLANE_BODY}`);
						if (bodyEl) this._patchColumns(bodyEl, laneColumns, laneEntries, laneValue);
					}
				}
			});

			// Re-order lanes in the DOM
			orderedLanes.forEach((laneValue) => {
				const laneEl = existingLanes.get(laneValue);
				if (laneEl) boardEl.appendChild(laneEl);
			});

			if (!this.swimlaneSortable) this.initializeSwimlaneSortable(boardEl);
		} else {
			// Null lane: columns are direct children of boardEl
			const colEntries = lanes.get(null) ?? new Map<string, BasesEntry[]>();
			this._patchColumns(boardEl, orderedColumnValues, colEntries, null);
		}

		// Defer scroll restoration to the next frame so layout has finalized.
		// Synchronous scrollTop assignment can be clamped when a transient layout
		// pass reports a smaller scrollHeight (e.g. image-backed cards not yet laid out).
		window.requestAnimationFrame(() => {
			try {
				boardEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN_BODY}`).forEach((body) => {
					const colEl = body.closest<HTMLElement>(`.${CSS_CLASSES.COLUMN}`);
					const colVal = colEl?.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE);
					const laneEl = body.closest<HTMLElement>(`.${CSS_CLASSES.SWIMLANE}`);
					const laneVal = laneEl?.getAttribute(DATA_ATTRIBUTES.SWIMLANE_VALUE) ?? null;
					if (colVal) {
						const top = scrollPositions.get(this.cardOrderKey(laneVal, colVal));
						if (top !== undefined) body.scrollTop = top;
					}
				});
			} catch (error) {
				console.error('KanbanView: error restoring scroll positions', error);
			}
		});
	}

	private _patchColumns(
		containerEl: HTMLElement,
		orderedColumnValues: string[],
		groupedEntries: Map<string, BasesEntry[]>,
		laneValue: string | null,
	): void {
		// Index existing columns
		const existingColumns = new Map<string, HTMLElement>();
		containerEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN}`).forEach((col) => {
			const val = col.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE);
			if (val !== null) existingColumns.set(val, col);
		});

		const newColSet = new Set(orderedColumnValues);

		// Remove columns not in the new ordered set
		existingColumns.forEach((colEl, colValue) => {
			if (!newColSet.has(colValue)) {
				const key = this.cardOrderKey(laneValue, colValue);
				const s = this._columnSortables.get(key);
				if (s) {
					s.destroy();
					this._columnSortables.delete(key);
				}
				colEl.remove();
				existingColumns.delete(colValue);
			}
		});

		// Add new columns or patch existing
		orderedColumnValues.forEach((colValue) => {
			const entries = groupedEntries.get(colValue) ?? [];
			if (!existingColumns.has(colValue)) {
				const options = laneValue !== null ? { showRemoveButton: false as const, swimlaneValue: laneValue } : {};
				const colEl = this.createColumn(colValue, entries, options);
				containerEl.appendChild(colEl);
				existingColumns.set(colValue, colEl);
				const cardBody = colEl.querySelector<HTMLElement>(
					`.${CSS_CLASSES.COLUMN_BODY}[${DATA_ATTRIBUTES.SORTABLE_CONTAINER}]`,
				);
				if (cardBody) {
					const key = this.cardOrderKey(laneValue, colValue);
					const attachOnce = () => {
						this.attachCardSortable(cardBody, key);
						this._deferredSortableListeners.delete(key);
						cardBody.removeEventListener('pointerdown', attachOnce);
					};
					cardBody.addEventListener('pointerdown', attachOnce);
					this._deferredSortableListeners.set(key, {
						el: cardBody,
						handler: attachOnce,
					});
				} else {
					console.warn('KanbanView: column body not found for new column; card drag will not work', colValue);
				}
			} else {
				const colEl = existingColumns.get(colValue);
				if (colEl) this.patchColumnCards(colEl, entries);
			}
		});

		// Re-order columns in the DOM to match orderedColumnValues
		orderedColumnValues.forEach((colValue) => {
			const colEl = existingColumns.get(colValue);
			if (colEl) containerEl.appendChild(colEl);
		});
	}

	private _computeCardFingerprint(entry: BasesEntry): string {
		return computeCardFingerprint(entry, this._buildCardCtx());
	}

	private patchColumnCards(columnEl: HTMLElement, newEntries: BasesEntry[]): void {
		patchColumnCardsEl(columnEl, newEntries, this._buildColumnCtx(), this._buildColumnCallbacks());
	}

	private groupEntriesByProperty(entries: BasesEntry[], propertyId: BasesPropertyId): Map<string, BasesEntry[]> {
		const grouped = new Map<string, BasesEntry[]>();

		entries.forEach((entry) => {
			try {
				const propValue = entry.getValue(propertyId);
				const value = normalizePropertyValue(propValue);
				const group = ensureGroupExists(grouped, value);
				group.push(entry);
			} catch (error) {
				console.warn('Error processing entry:', entry.file.path, error);
				const uncategorizedGroup = ensureGroupExists(grouped, UNCATEGORIZED_LABEL);
				uncategorizedGroup.push(entry);
			}
		});

		return grouped;
	}

	/**
	 * Two-axis bucketing: swimlane → column → entries. Entries that fail to read
	 * either property fall through to UNCATEGORIZED_LABEL on the offending axis.
	 */
	private groupEntriesBySwimlaneAndColumn(
		entries: BasesEntry[],
		swimlanePropertyId: BasesPropertyId,
		columnPropertyId: BasesPropertyId,
	): Map<string, Map<string, BasesEntry[]>> {
		const grouped = new Map<string, Map<string, BasesEntry[]>>();

		const ensureLane = (laneKey: string): Map<string, BasesEntry[]> => {
			const existing = grouped.get(laneKey);
			if (existing) return existing;
			const lane = new Map<string, BasesEntry[]>();
			grouped.set(laneKey, lane);
			return lane;
		};

		entries.forEach((entry) => {
			let laneKey = UNCATEGORIZED_LABEL;
			let columnKey = UNCATEGORIZED_LABEL;
			try {
				laneKey = normalizePropertyValue(entry.getValue(swimlanePropertyId));
			} catch (error) {
				console.warn('Error reading swimlane property for entry:', entry.file.path, error);
			}
			try {
				columnKey = normalizePropertyValue(entry.getValue(columnPropertyId));
			} catch (error) {
				console.warn('Error reading column property for entry:', entry.file.path, error);
			}
			const lane = ensureLane(laneKey);
			ensureGroupExists(lane, columnKey).push(entry);
		});

		return grouped;
	}

	private toggleSwimlaneCollapsed(laneValue: string, laneEl: HTMLElement, toggleBtn: HTMLElement): void {
		const willCollapse = !this._prefs.collapsedLanes.has(laneValue);
		if (willCollapse) this._prefs.collapsedLanes.add(laneValue);
		else this._prefs.collapsedLanes.delete(laneValue);
		laneEl.classList.toggle(CSS_CLASSES.SWIMLANE_COLLAPSED, willCollapse);
		updateSwimlaneToggleEl(toggleBtn, willCollapse);
		this._persistPrefs();
	}

	private _sortSwimlaneValues(values: string[]): string[] {
		return sortSwimlaneValues(values);
	}

	private getOrderedSwimlaneValues(liveValues: string[]): string[] {
		return getOrderedSwimlaneValuesEl(liveValues, this._prefs.swimlaneOrder);
	}

	/**
	 * Flatten a lane→column→entries map into the column→entries shape the
	 * single-axis render path expects, preserving union of column values across
	 * all lanes so empty cells still render as empty bodies.
	 */
	private flattenLanes(byLane: Map<string, Map<string, BasesEntry[]>>): Map<string, BasesEntry[]> {
		const flat = new Map<string, BasesEntry[]>();
		byLane.forEach((columns) => {
			columns.forEach((entries, columnValue) => {
				const existing = flat.get(columnValue);
				if (existing) existing.push(...entries);
				else flat.set(columnValue, [...entries]);
			});
		});
		return flat;
	}

	private _buildColumnCtx(): ColumnRenderCtx {
		return {
			doc: this.containerEl.doc,
			card: this._buildCardCtx(),
			cardCb: this._buildCardCallbacks(),
			prefs: { columnColors: this._prefs.columnColors, columnWidths: this._prefs.columnWidths },
			dragging: this._dragging,
			cardFingerprints: this._cardFingerprints,
		};
	}

	private _buildColumnCallbacks(): ColumnCallbacks {
		return {
			applyColumnColor: (el, name) => this.applyColumnColor(el, name),
			onColorPickerClick: (anchor, col, val) => this.openColorPicker(anchor, col, val),
			onRemoveColumn: (val, el) => this.removeColumn(val, el),
			createAddButton: (colVal, laneVal) => this.createAddButton(colVal, laneVal),
			getQuickAddFolder: () => this.getQuickAddFolder(),
			onColumnResize: (val, width) => this.setColumnWidth(val, width),
		};
	}

	/** Persist a per-column width override (px). Called on resize-handle release. */
	private setColumnWidth(columnValue: string, width: number | null): void {
		if (width === null) {
			delete this._prefs.columnWidths[columnValue];
		} else {
			this._prefs.columnWidths[columnValue] = Math.round(width);
		}
		this._persistPrefs();
	}

	/** Apply the global column-width slider as a CSS variable on the container. */
	private _applyGlobalColumnWidth(): void {
		const raw = Number(this.config?.get('columnWidth'));
		if (Number.isFinite(raw) && raw > 0) {
			this.containerEl.style.setProperty('--obk-column-width', `${raw}px`);
		} else {
			this.containerEl.style.removeProperty('--obk-column-width');
		}
	}

	/** Render all entries as a flat CSS multi-column card gallery (masonry layout). */
	private _renderMasonry(entries: BasesEntry[]): void {
		this.containerEl.empty();
		this.containerEl.classList.remove(CSS_CLASSES.VIEW_CONTAINER_WITH_SWIMLANES);
		const boardEl = this.containerEl.createDiv({ cls: CSS_CLASSES.MASONRY_BOARD });
		const ctx = this._buildCardCtx();
		const callbacks = this._buildCardCallbacks();
		// Sort by cardColorOrder first, then masonrySortProperty (desc) when no Bases sort is active
		let sorted = entries;
		if (!this.hasActiveSort()) {
			const colorOrderMap =
				this.cardColorPropertyId && this._cardColorValues.length > 0
					? new Map(this._cardColorValues.map((v, i) => [v, i]))
					: null;
			const maxColorIdx = this._cardColorValues.length;
			// Fallback: if getAsPropertyId failed, use raw config string directly as property ID
			const rawSortProperty = this.config.get('masonrySortProperty');
			const sortPropId = this.masonrySortPropertyId ?? (isBasesPropertyId(rawSortProperty) ? rawSortProperty : null);
			sorted = [...entries].sort((a, b) => {
				// Primary: cardColorOrder
				if (colorOrderMap && this.cardColorPropertyId) {
					const av = String(a.getValue(this.cardColorPropertyId) ?? '');
					const bv = String(b.getValue(this.cardColorPropertyId) ?? '');
					const colorCmp = (colorOrderMap.get(av) ?? maxColorIdx) - (colorOrderMap.get(bv) ?? maxColorIdx);
					if (colorCmp !== 0) return colorCmp;
				}
				// Secondary: masonrySortProperty descending — count ⭐ chars, empty → last
				if (sortPropId) {
					const av = String(a.getValue(sortPropId) ?? '');
					const bv = String(b.getValue(sortPropId) ?? '');
					const countStars = (s: string) => (s === '' ? -1 : [...s].filter((c) => c === '⭐').length || Number(s) || 0);
					const an = countStars(av);
					const bn = countStars(bv);
					if (bn !== an) return bn - an;
				}
				return 0;
			});
		}
		for (const entry of sorted) {
			boardEl.appendChild(createCardEl(entry, ctx, callbacks));
		}
	}

	private _ensureMasonryToggle(): void {
		const toolbarItems = this._findBasesToolbar();
		const home = toolbarItems ?? this.containerEl;
		const scope =
			this.containerEl.closest('.workspace-leaf') ?? this.containerEl.closest('.workspace-leaf-content') ?? home;
		scope.querySelectorAll(`.${CSS_CLASSES.MASONRY_TOGGLE}`).forEach((el) => {
			if (el !== this._masonryToggleEl) el.remove();
		});

		const placed = this._masonryToggleEl?.isConnected ?? false;
		const inToolbar = !!(toolbarItems && this._masonryToggleEl && toolbarItems.contains(this._masonryToggleEl));

		if (!placed || (toolbarItems && !inToolbar)) {
			this._masonryToggleEl?.remove();
			this._masonryToggleEl = this._createMasonryToggle(toolbarItems);
		}
		this._updateMasonryToggleState();

		if (!toolbarItems && !this._masonryRetryScheduled) {
			this._masonryRetryScheduled = true;
			let tries = 0;
			const retry = () => {
				if (this._findBasesToolbar()) {
					this._masonryRetryScheduled = false;
					this._ensureMasonryToggle();
				} else if (++tries < 12) {
					window.setTimeout(retry, 150);
				} else {
					this._masonryRetryScheduled = false;
				}
			};
			window.setTimeout(retry, 150);
		}
	}

	private _createMasonryToggle(toolbarItems: HTMLElement | null): HTMLElement {
		const inToolbar = toolbarItems !== null;
		const parent = toolbarItems ?? this.containerEl;
		const cls = inToolbar ? `bases-toolbar-item ${CSS_CLASSES.MASONRY_TOGGLE}` : `${CSS_CLASSES.MASONRY_TOGGLE}`;
		const btn = parent.createDiv({ cls });
		btn.setAttribute('role', 'button');
		btn.setAttribute('tabindex', '0');
		btn.setAttribute('aria-label', t('label.masonryMode'));

		const iconEl = btn.createSpan({ cls: CSS_CLASSES.MASONRY_TOGGLE_ICON });
		setIcon(iconEl, 'layout-grid');
		btn.createSpan({ text: t('label.masonryShort') });

		const toggle = () => {
			this._masonryMode = !this._masonryMode;
			this._masonryModeDirty = true;
			if (!this._masonryMode) {
				// Leaving masonry: clear masonry board so render() sees no .obk-board
				// and forces a fullRebuild of the kanban layout.
				if (this.containerEl.querySelector(`.${CSS_CLASSES.MASONRY_BOARD}`)) {
					this.containerEl.empty();
				}
			}
			this._updateMasonryToggleState();
			this._debouncedRender();
		};
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			toggle();
		});
		btn.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			e.preventDefault();
			toggle();
		});
		return btn;
	}

	private _updateMasonryToggleState(): void {
		const btn = this._masonryToggleEl;
		if (!btn) return;
		btn.classList.toggle(CSS_CLASSES.MASONRY_TOGGLE_ACTIVE, this._masonryMode);
		const iconEl = btn.querySelector<HTMLElement>(`.${CSS_CLASSES.MASONRY_TOGGLE_ICON}`);
		if (iconEl) setIcon(iconEl, this._masonryMode ? 'layout-list' : 'layout-grid');
		btn.setAttribute('aria-pressed', String(this._masonryMode));
	}

	/** Toggle the minimal-mode class (hides property labels) on the container. */
	private _applyMinimalMode(): void {
		this.containerEl.classList.toggle(CSS_CLASSES.MINIMAL, this._minimalMode);
	}

	/**
	 * Ensure the minimal-mode toggle exists and reflects state. Preferred home is
	 * Obsidian's native Bases toolbar (the sort/filter/properties row) so the
	 * board canvas stays clean — true to "minimal". If that toolbar can't be
	 * found (API/DOM change), fall back to a small floating button in the board
	 * corner. Re-injected whenever it goes missing (Obsidian may rebuild its
	 * toolbar independently of our renders).
	 */
	private _findBasesToolbar(): HTMLElement | null {
		// The native Bases toolbar container. Items (views/sort/filter/properties/
		// search/new) are direct .bases-toolbar-item children; there is no
		// ".bases-toolbar-items" wrapper. Scoped to this view's leaf.
		const scope = this.containerEl.closest('.workspace-leaf') ?? this.containerEl.closest('.workspace-leaf-content');
		return scope?.querySelector<HTMLElement>('.bases-toolbar') ?? null;
	}

	private _ensureMinimalToggle(): void {
		const toolbarItems = this._findBasesToolbar();

		// The native toolbar lives outside our container (in .bases-header), so it
		// survives view rebuilds. A fresh view instance starts with a null toggle
		// ref and would append a new button while the previous instances' buttons
		// linger, producing duplicates. Purge any toggle in this leaf that isn't
		// the one we currently own (both in the toolbar and any floating fallback).
		const home = toolbarItems ?? this.containerEl;
		const scope =
			this.containerEl.closest('.workspace-leaf') ?? this.containerEl.closest('.workspace-leaf-content') ?? home;
		scope.querySelectorAll(`.${CSS_CLASSES.MINIMAL_TOGGLE}`).forEach((el) => {
			if (el !== this._minimalToggleEl) el.remove();
		});

		const placed = this._minimalToggleEl?.isConnected ?? false;
		const inToolbar = !!(toolbarItems && this._minimalToggleEl && toolbarItems.contains(this._minimalToggleEl));

		// (Re)create when missing, or migrate the floating fallback into the
		// native toolbar once it becomes available.
		if (!placed || (toolbarItems && !inToolbar)) {
			this._minimalToggleEl?.remove();
			this._minimalToggleEl = this._createMinimalToggle(toolbarItems);
		}
		this._updateMinimalToggleState();
		this._watchToolbar();

		// Obsidian may build its toolbar after our first render. Poll briefly so
		// the button hops from the floating fallback into the toolbar when ready.
		if (!toolbarItems && !this._minimalRetryScheduled) {
			this._minimalRetryScheduled = true;
			let tries = 0;
			const retry = () => {
				if (this._findBasesToolbar()) {
					this._minimalRetryScheduled = false;
					this._ensureMinimalToggle();
				} else if (++tries < 12) {
					window.setTimeout(retry, 150);
				} else {
					this._minimalRetryScheduled = false;
				}
			};
			window.setTimeout(retry, 150);
		}
	}

	/**
	 * Obsidian owns and periodically rebuilds the native .bases-toolbar (tab
	 * switch, view reload, config changes). Since our toggle lives inside that
	 * toolbar (outside our container), a rebuild silently drops it and our view
	 * may not re-render to put it back. Watch the toolbar's header so we can
	 * re-inject the button into its correct slot the moment Obsidian recreates
	 * the toolbar.
	 */
	private _watchToolbar(): void {
		if (this._toolbarObserver) return;
		const header =
			this._findBasesToolbar()?.parentElement ??
			this.containerEl.closest('.workspace-leaf-content')?.querySelector('.bases-header');
		if (!header) return;
		const observer = new MutationObserver(() => {
			const toolbar = this._findBasesToolbar();
			// Re-inject only when the toolbar exists but no longer holds our
			// buttons. The contains() check also stops our own insert (which
			// mutates the header) from triggering an infinite loop.
			if (toolbar && (!this._minimalToggleEl || !toolbar.contains(this._minimalToggleEl))) {
				this._ensureMinimalToggle();
				this._ensureMasonryToggle();
			}
		});
		observer.observe(header, { childList: true, subtree: true });
		this._toolbarObserver = observer;
	}

	private _createMinimalToggle(toolbarItems: HTMLElement | null): HTMLElement {
		const inToolbar = toolbarItems !== null;
		const parent = toolbarItems ?? this.containerEl;
		const cls = inToolbar
			? `bases-toolbar-item ${CSS_CLASSES.MINIMAL_TOGGLE}`
			: `${CSS_CLASSES.MINIMAL_TOGGLE} ${CSS_CLASSES.MINIMAL_TOGGLE_FLOATING}`;
		const btn = parent.createDiv({ cls });
		btn.setAttribute('role', 'button');
		btn.setAttribute('tabindex', '0');
		btn.setAttribute('aria-label', t('label.minimalMode'));

		const iconEl = btn.createSpan({ cls: CSS_CLASSES.MINIMAL_TOGGLE_ICON });
		setIcon(iconEl, 'eye-off');
		btn.createSpan({ text: t('label.minimalShort') });

		const toggle = () => {
			this._minimalMode = !this._minimalMode;
			// The visual toggle is a CSS class (_applyMinimalMode) and needs no
			// config write. Defer persisting minimalMode to close — a config.set
			// here would make the host rebuild the whole view (a flash).
			this._minimalModeDirty = true;
			this._applyMinimalMode();
			this._updateMinimalToggleState();
		};
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			toggle();
		});
		btn.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			e.preventDefault();
			toggle();
		});
		return btn;
	}

	private _updateMinimalToggleState(): void {
		const btn = this._minimalToggleEl;
		if (!btn) return;
		btn.classList.toggle(CSS_CLASSES.MINIMAL_TOGGLE_ACTIVE, this._minimalMode);
		// Swap only the icon span; leave the text label untouched (no duplicates).
		const iconEl = btn.querySelector<HTMLElement>(`.${CSS_CLASSES.MINIMAL_TOGGLE_ICON}`);
		if (iconEl) setIcon(iconEl, this._minimalMode ? 'eye' : 'eye-off');
		btn.setAttribute('aria-pressed', String(this._minimalMode));
	}

	private createColumn(
		value: string,
		entries: BasesEntry[],
		options: { showRemoveButton?: boolean; swimlaneValue?: string | null } = {},
	): HTMLElement {
		return createColumnEl(value, entries, options, this._buildColumnCtx(), this._buildColumnCallbacks());
	}

	private _buildCardCtx(): CardRenderCtx {
		return {
			app: this.app,
			doc: this.containerEl.doc,
			groupByPropertyId: this.groupByPropertyId,
			cardTitlePropertyId: this.cardTitlePropertyId,
			imagePropertyId: this.imagePropertyId,
			imageFit: this._lastImageFit ?? 'cover',
			imageAspectRatio: this._lastImageAspectRatio ?? 0.5,
			wrapValues: this._lastWrapValue ?? false,
			order: this.config?.getOrder() ?? [],
			getDisplayName: (id) => this.config?.getDisplayName(id) ?? id,
			cardColorPropertyId: this.cardColorPropertyId,
			cardColorValues: this._cardColorValues,
			resolveColor: (value) => this._cardColorMap.get(value) ?? null,
		};
	}

	private _buildCardCallbacks(): CardCallbacks {
		return {
			onHoverPreview: (lt, sp, e, el) => this.triggerHoverPreview(lt, sp, e, el),
			onSetActiveCard: (path) => this.setActiveCard(path),
			onOpenInBackgroundTab: (file) => this.openInBackgroundTab(file),
			onSetCardProperty: (entry, propId, value) => void this.setCardProperty(entry, propId, value),
			onPickCardColor: (anchorEl, value) => this.openCardColorPicker(anchorEl, value),
		};
	}

	/**
	 * Write a single frontmatter property (the inline status switcher). The
	 * resulting file change fires onDataUpdated → render, which repaints the
	 * card with its new accent color and select value.
	 */
	private async setCardProperty(entry: BasesEntry, propertyId: BasesPropertyId, value: string): Promise<void> {
		if (!this.app?.fileManager) {
			console.warn('File manager not available');
			return;
		}
		const parsed = parsePropertyId(propertyId);
		if (parsed.type !== 'note' || !parsed.name) {
			console.warn('Card-color property is not a writable note property:', propertyId);
			return;
		}
		const propertyName = parsed.name;
		// When setting the card-color property to a value that has no leading
		// color emoji, prepend the resolved palette emoji so the value carries its
		// color everywhere (kanban card, table, and Obsidian's native property
		// editor) without the user having to type the emoji manually.
		const toWrite = value !== '' && propertyId === this.cardColorPropertyId ? this._withColorEmoji(value) : value;
		try {
			await this.app.fileManager.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
				if (value === '') {
					delete frontmatter[propertyName];
				} else {
					frontmatter[propertyName] = toWrite;
				}
			});
		} catch (error) {
			console.error('Error updating card property:', error);
		}
	}

	/**
	 * Return the value prefixed with its resolved palette color emoji (e.g.
	 * "有嗎" → "🟣 有嗎"). If the value already begins with a recognized color
	 * emoji it is returned unchanged. Resolution mirrors _computeCardColors:
	 * user override wins, else the render-time assignment, else the least-used
	 * palette color (so brand-new values avoid colors already on the board).
	 */
	private _withColorEmoji(value: string): string {
		if (!value.trim()) return value; // nothing to color (empty / emoji-only leftovers)
		const leadEmoji = [...value][0] ?? '';
		if (EMOJI_COLOR_MAP[leadEmoji]) return value;
		let colorName = this._cardColorPrefs[value] ?? this._cardColorNames.get(value);
		if (!colorName) {
			colorName = this._leastUsedColorName();
			// Reserve it so a burst of new values spreads across the palette.
			this._cardColorCounts.set(colorName, (this._cardColorCounts.get(colorName) ?? 0) + 1);
		}
		const emoji = COLOR_NAME_TO_EMOJI[colorName];
		return emoji ? `${emoji} ${value}` : value;
	}

	/** Strip a single leading color emoji (and its trailing space) from a value. */
	private _stripLeadingColorEmoji(value: string): string {
		return stripLeadingColorEmoji(value);
	}

	/**
	 * Catch-up sweep run on every render: prepend a color emoji to any in-board
	 * card-color value that lacks one. Complements the plugin-level auto-color
	 * listener (registerGlobalAutoColor), which only knows the option list after
	 * the first board render of the session.
	 */
	private _sweepColorEmoji(entries: BasesEntry[]): void {
		if (this._closed || !this.cardColorPropertyId || !this.app?.fileManager) return;
		const parsed = parsePropertyId(this.cardColorPropertyId);
		if (parsed.type !== 'note' || !parsed.name) return;
		const propertyName = parsed.name;
		for (const entry of entries) {
			const raw = entry.getValue(this.cardColorPropertyId)?.toString().trim() ?? '';
			// "null" = a truthy Value wrapper around cleared/absent data; nothing
			// to color (and the in-note guard below would reject the write anyway).
			if (!raw || raw === 'null') continue;
			const leadEmoji = [...raw][0] ?? '';
			if (EMOJI_COLOR_MAP[leadEmoji]) continue; // already colored
			const colored = this._withColorEmoji(raw);
			if (colored === raw) continue;
			const path = entry.file.path;
			if (this._normalizingColorPaths.has(path)) continue;
			this._normalizingColorPaths.add(path);
			void this.app.fileManager
				.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
					// Numbers count too: `phase: 123` renders as "123" — without the
					// coercion the guard never matches and the sweep retries forever.
					const current = frontmatterString(frontmatter[propertyName]);
					if (current !== null && current.trim() === raw) {
						frontmatter[propertyName] = colored;
					}
				})
				.catch((error: unknown) => console.error('KanbanView: color-emoji sweep failed', error))
				.finally(() => this._normalizingColorPaths.delete(path));
		}
	}

	private createCard(entry: BasesEntry): HTMLElement {
		return createCardEl(entry, this._buildCardCtx(), this._buildCardCallbacks());
	}

	private applyColumnColor(columnEl: HTMLElement, colorName: string | null): void {
		applyColumnColorEl(columnEl, colorName);
	}

	private openColorPicker(anchorEl: HTMLElement, columnEl: HTMLElement, columnValue: string): void {
		this.activeColorPicker?.remove();
		this.activeColorPicker = null;

		const popover = anchorEl.doc.createElement('div');
		popover.className = CSS_CLASSES.COLUMN_COLOR_POPOVER;

		// Single teardown path: removes the popover AND the document-level dismiss
		// listener (a bare popover.remove() would leave the listener behind, where
		// its next firing could null out a newer picker's activeColorPicker).
		const cleanup = (): void => {
			popover.remove();
			if (this.activeColorPicker === popover) this.activeColorPicker = null;
			anchorEl.doc.removeEventListener('click', dismiss);
		};

		const currentColor = columnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_COLOR);

		const noneSwatch = anchorEl.doc.createElement('div');
		noneSwatch.className = `${CSS_CLASSES.COLUMN_COLOR_SWATCH} ${CSS_CLASSES.COLUMN_COLOR_NONE}`;
		if (!currentColor) noneSwatch.classList.add(CSS_CLASSES.COLUMN_COLOR_SWATCH_ACTIVE);
		noneSwatch.title = t('label.noColor');
		noneSwatch.addEventListener('click', () => {
			this.applyColumnColor(columnEl, null);
			delete this._prefs.columnColors[columnValue];
			this._persistPrefs();
			cleanup();
		});
		popover.appendChild(noneSwatch);

		for (const color of COLOR_PALETTE) {
			const swatch = anchorEl.doc.createElement('div');
			swatch.className = CSS_CLASSES.COLUMN_COLOR_SWATCH;
			swatch.style.background = color.cssVar;
			swatch.title = color.name;
			if (currentColor === color.name) swatch.classList.add(CSS_CLASSES.COLUMN_COLOR_SWATCH_ACTIVE);
			swatch.addEventListener('click', () => {
				this.applyColumnColor(columnEl, color.name);
				this._prefs.columnColors[columnValue] = color.name;
				this._persistPrefs();
				cleanup();
			});
			popover.appendChild(swatch);
		}

		const rect = anchorEl.getBoundingClientRect();
		popover.style.top = `${rect.bottom + 4}px`;
		popover.style.left = `${rect.left}px`;
		anchorEl.doc.body.appendChild(popover);
		this.activeColorPicker = popover;

		const dismiss = (e: MouseEvent) => {
			if (e.target instanceof Node && !popover.contains(e.target) && e.target !== anchorEl) cleanup();
		};
		anchorEl.doc.addEventListener('click', dismiss);
	}

	/**
	 * Color picker for a card-color value (the inline status switcher's dot).
	 * Choosing a swatch rewrites the leading color emoji of the frontmatter value
	 * (e.g. "🟣 測試" → "🟢 測試") across every card that currently holds that
	 * value, so the chosen color shows everywhere: the card, the Bases table, and
	 * Obsidian's native property editor. "none" resets to the auto palette color.
	 * The repaint happens via onDataUpdated after the frontmatter writes settle.
	 */
	private openCardColorPicker(anchorEl: HTMLElement, value: string): void {
		this.activeColorPicker?.remove();
		this.activeColorPicker = null;
		if (!value) return;

		const popover = anchorEl.doc.createElement('div');
		popover.className = CSS_CLASSES.COLUMN_COLOR_POPOVER;
		const leadEmoji = [...value][0] ?? '';
		const currentColor = EMOJI_COLOR_MAP[leadEmoji] ?? this._cardColorPrefs[value] ?? null;

		// Single teardown path (popover + document dismiss listener), see openColorPicker.
		const cleanup = (): void => {
			popover.remove();
			if (this.activeColorPicker === popover) this.activeColorPicker = null;
			anchorEl.doc.removeEventListener('click', dismiss);
		};

		const choose = (colorName: string | null): void => {
			cleanup();
			const propertyId = this.cardColorPropertyId;
			if (!propertyId) return;
			const bare = this._stripLeadingColorEmoji(value);
			if (!bare.trim()) return; // emoji-only value: nothing meaningful to recolor
			const emoji = colorName ? COLOR_NAME_TO_EMOJI[colorName] : '';
			// colorName set → that color's emoji; "none" → let the auto palette pick.
			const newValue = colorName && emoji ? `${emoji} ${bare}` : this._withColorEmoji(bare);
			if (newValue === value) return;
			const targets = (this.data?.data ?? []).filter((e) => (e.getValue(propertyId)?.toString().trim() ?? '') === value);
			void Promise.all(targets.map((e) => this.setCardProperty(e, propertyId, newValue)));
		};

		const noneSwatch = anchorEl.doc.createElement('div');
		noneSwatch.className = `${CSS_CLASSES.COLUMN_COLOR_SWATCH} ${CSS_CLASSES.COLUMN_COLOR_NONE}`;
		if (!currentColor) noneSwatch.classList.add(CSS_CLASSES.COLUMN_COLOR_SWATCH_ACTIVE);
		noneSwatch.title = t('label.noColor');
		noneSwatch.addEventListener('click', () => choose(null));
		popover.appendChild(noneSwatch);

		for (const color of COLOR_PALETTE) {
			const swatch = anchorEl.doc.createElement('div');
			swatch.className = CSS_CLASSES.COLUMN_COLOR_SWATCH;
			swatch.style.background = color.cssVar;
			swatch.title = color.name;
			if (currentColor === color.name) swatch.classList.add(CSS_CLASSES.COLUMN_COLOR_SWATCH_ACTIVE);
			swatch.addEventListener('click', () => choose(color.name));
			popover.appendChild(swatch);
		}

		const rect = anchorEl.getBoundingClientRect();
		popover.style.top = `${rect.bottom + 4}px`;
		popover.style.left = `${rect.left}px`;
		anchorEl.doc.body.appendChild(popover);
		this.activeColorPicker = popover;

		const dismiss = (e: MouseEvent) => {
			if (e.target instanceof Node && !popover.contains(e.target) && e.target !== anchorEl) cleanup();
		};
		anchorEl.doc.addEventListener('click', dismiss);
	}

	private getQuickAddFolder(): string | null {
		const raw = this.config?.get('quickAddFolder');
		if (typeof raw !== 'string') return null;
		const trimmed = raw.trim();
		if (!trimmed) return null;
		return normalizePath(trimmed);
	}

	private _buildQuickAddCtx(): QuickAddCtx {
		return {
			app: this.app,
			doc: this.containerEl.doc,
			prefsPropertyId: this._prefsPropertyId,
			prefsSwimlanePropertyId: this._prefsSwimlanePropertyId,
			quickAddFolder: this.getQuickAddFolder(),
		};
	}

	private _buildQuickAddCallbacks(): QuickAddCallbacks {
		return {
			createFileForView: (path, setFm) => this.createFileForView(path, setFm),
		};
	}

	private createAddButton(columnValue: string, swimlaneValue: string | null): HTMLElement {
		return createAddButtonEl(columnValue, swimlaneValue, this._buildQuickAddCtx(), this._buildQuickAddCallbacks());
	}

	private async createQuickAddCard(title: string, columnValue: string, swimlaneValue: string | null): Promise<void> {
		return createQuickAddCardEl(
			title,
			columnValue,
			swimlaneValue,
			this._buildQuickAddCtx(),
			this._buildQuickAddCallbacks(),
		);
	}

	private closeNativeNewItemPopover(): void {
		closeNativeNewItemPopoverEl(this.containerEl.doc);
	}

	private detachColumn(value: string, colEl: HTMLElement): void {
		const sortable = this._columnSortables.get(value);
		if (sortable) {
			sortable.destroy();
			this._columnSortables.delete(value);
		}
		colEl.remove();
	}

	private removeColumn(value: string, columnEl: HTMLElement): void {
		if (!this._prefsPropertyId) return;
		this._prefs.columnOrder = this._prefs.columnOrder.filter((v) => v !== value);
		this._persistPrefs();
		this.detachColumn(value, columnEl);
	}

	private attachCardSortable(body: HTMLElement, value: string): void {
		const sortable = new Sortable(body, {
			group: SORTABLE_GROUP,

			animation: SORTABLE_CONFIG.ANIMATION_DURATION,

			// The whole card is draggable (no handle), so a mousedown on the inline
			// status <select> would otherwise start a drag and the native dropdown
			// never opens. Exclude it from drag, and preventOnFilter:false so
			// Sortable does not preventDefault the event the <select> needs to open.
			filter: `.${CSS_CLASSES.CARD_STATUS_SELECT}`,
			preventOnFilter: false,

			// require a press-and-hold before drag begins on touch so that
			// swiping to scroll a column isn't mistaken for a card drag
			delay: SORTABLE_CONFIG.TOUCH_DELAY,
			delayOnTouchOnly: true,
			touchStartThreshold: SORTABLE_CONFIG.TOUCH_START_THRESHOLD,

			// Keep same-column sorting enabled so Sortable can report whether the
			// user actually tried to move a card. Sorted boards snap back in
			// handleCardDrop after optionally showing an action-specific notice.
			sort: true,

			dragClass: CSS_CLASSES.CARD_DRAGGING,
			ghostClass: CSS_CLASSES.CARD_GHOST,
			chosenClass: CSS_CLASSES.CARD_CHOSEN,
			onStart: (evt: Sortable.SortableEvent) => {
				this._dragging = true;
				if (evt.item.instanceOf(HTMLElement)) evt.item.classList.remove(CSS_CLASSES.CARD_HOVER);
			},
			onEnd: (evt: Sortable.SortableEvent) => {
				this._dragging = false;
				this.setActiveCard(null);
				void this.handleCardDrop(evt);
			},
		});
		this._columnSortables.set(value, sortable);
	}

	private async handleCardDrop(evt: Sortable.SortableEvent): Promise<void> {
		if (!evt.item.instanceOf(HTMLElement)) {
			console.warn('Card element is not an HTMLElement:', evt.item);
			return;
		}

		const cardEl = evt.item;
		const entryPath = cardEl.getAttribute(DATA_ATTRIBUTES.ENTRY_PATH);

		if (!entryPath) {
			console.warn('No entry path found on card');
			return;
		}

		const columnSelector = `.${CSS_CLASSES.COLUMN}`;
		const oldColumnEl = evt.from.closest(columnSelector);
		const newColumnEl = evt.to.closest(columnSelector);

		if (!newColumnEl || !newColumnEl.instanceOf(HTMLElement)) {
			console.warn('Could not find new column element');
			return;
		}

		const oldColumnValue = oldColumnEl?.instanceOf(HTMLElement)
			? oldColumnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE)
			: null;
		const newColumnValue = newColumnEl.getAttribute(DATA_ATTRIBUTES.COLUMN_VALUE);

		if (!newColumnValue) {
			console.warn('No column value found');
			return;
		}

		if (!this._prefsPropertyId) {
			console.warn('No group by property ID set');
			return;
		}

		// Resolve swimlane axis (if active) from the dragged card's surrounding lanes
		const swimlaneSelector = `.${CSS_CLASSES.SWIMLANE}`;
		const oldLaneEl = evt.from.closest(swimlaneSelector);
		const newLaneEl = evt.to.closest(swimlaneSelector);
		const swimlaneActive = newLaneEl?.instanceOf(HTMLElement) ?? false;
		const oldLaneValue = oldLaneEl?.instanceOf(HTMLElement)
			? oldLaneEl.getAttribute(DATA_ATTRIBUTES.SWIMLANE_VALUE)
			: null;
		const newLaneValue = swimlaneActive ? newLaneEl.getAttribute(DATA_ATTRIBUTES.SWIMLANE_VALUE) : null;

		// Helper: read card paths from a column body element
		const getColumnPaths = (bodyEl: Element): string[] =>
			Array.from(bodyEl.querySelectorAll(`.${CSS_CLASSES.CARD}`))
				.map((c) => (c.instanceOf(HTMLElement) ? c.getAttribute(DATA_ATTRIBUTES.ENTRY_PATH) : null))
				.filter((p): p is string => p !== null);

		const oldKey = this.cardOrderKey(oldLaneValue, oldColumnValue ?? '');
		const newKey = this.cardOrderKey(newLaneValue, newColumnValue);
		const sortActive = this.hasActiveSort();

		// Same cell reorder: update prefs and persist
		if (oldLaneValue === newLaneValue && oldColumnValue === newColumnValue) {
			if (sortActive) {
				if (this.didSortableIndexChange(evt)) {
					new Notice(SORTED_CARD_ORDER_NOTICE, 4000);
				}
				this.render();
				return;
			}
			this._prefs.cardOrders[newKey] = getColumnPaths(evt.to);
			this._persistPrefs();
			return;
		}

		// Cross-cell drop: capture DOM order for both source and destination
		if (!sortActive) {
			if (oldColumnEl?.instanceOf(HTMLElement) && oldColumnValue) {
				const oldBody = oldColumnEl.querySelector(`.${CSS_CLASSES.COLUMN_BODY}`);
				if (oldBody) this._prefs.cardOrders[oldKey] = getColumnPaths(oldBody);
			}
			this._prefs.cardOrders[newKey] = getColumnPaths(evt.to);
			this._persistPrefs();
		}

		const entry = this._entryMap.get(entryPath);
		if (!entry) {
			console.warn('Entry not found for path:', entryPath);
			return;
		}

		if (!this.app?.fileManager) {
			console.warn('File manager not available');
			return;
		}

		try {
			const columnValueToSet = newColumnValue === UNCATEGORIZED_LABEL ? '' : newColumnValue;
			const columnPropertyName = parsePropertyId(this._prefsPropertyId).name;

			const swimlanePropertyId = swimlaneActive ? this._prefsSwimlanePropertyId : null;
			const swimlaneCrossed =
				swimlaneActive && swimlanePropertyId !== null && newLaneValue !== null && oldLaneValue !== newLaneValue;
			const swimlanePropertyName = swimlaneCrossed ? parsePropertyId(swimlanePropertyId).name : null;
			const swimlaneValueToSet = swimlaneCrossed && newLaneValue !== UNCATEGORIZED_LABEL ? newLaneValue : '';

			await this.app.fileManager.processFrontMatter(entry.file, (frontmatter: Record<string, unknown>) => {
				if (columnValueToSet === '') {
					delete frontmatter[columnPropertyName];
				} else {
					frontmatter[columnPropertyName] = columnValueToSet;
				}
				if (swimlanePropertyName) {
					if (swimlaneValueToSet === '') {
						delete frontmatter[swimlanePropertyName];
					} else {
						frontmatter[swimlanePropertyName] = swimlaneValueToSet;
					}
				}
			});
		} catch (error) {
			console.error('Error updating entry property:', error);
			this.render();
		}
	}

	private findCardEl(path: string): HTMLElement | null {
		return (
			Array.from(this.containerEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.CARD}`)).find(
				(el) => el.getAttribute(DATA_ATTRIBUTES.ENTRY_PATH) === path,
			) ?? null
		);
	}

	/**
	 * Open a file in a new background tab, keeping the kanban as the active leaf.
	 *
	 * Obsidian's getLeaf('tab') makes the new tab the visible one in its group,
	 * so we capture the kanban's leaf, kick off openFile (fire-and-forget), and
	 * switch the active leaf back synchronously — before the browser repaints —
	 * so the new tab is never visible to the user. { focus: false } avoids an
	 * extra focus-driven scroll-into-view; the kanban still becomes the active
	 * (visible) leaf.
	 *
	 * During the leaf swap a transient layout pass clamps column scrollTop on
	 * image-backed cards (their <img> hasn't decoded, so scrollHeight briefly
	 * shrinks). We capture column scroll positions and restore them aggressively —
	 * synchronously plus over several animation frames — so no paint shows the
	 * clamped state.
	 */
	private openInBackgroundTab(file: TFile): void {
		if (!this.app?.workspace) return;

		const scrollPositions: Array<[HTMLElement, number]> = [];
		this.containerEl.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.COLUMN_BODY}`).forEach((body) => {
			if (body.scrollTop > 0) scrollPositions.push([body, body.scrollTop]);
		});

		const previousLeaf = this.app.workspace.getMostRecentLeaf();
		const newLeaf = this.app.workspace.getLeaf('tab');
		void newLeaf.openFile(file, { active: false });
		if (previousLeaf && previousLeaf !== newLeaf) {
			this.app.workspace.setActiveLeaf(previousLeaf, { focus: false });
		}

		if (scrollPositions.length === 0) return;
		const restore = () => {
			scrollPositions.forEach(([body, top]) => {
				if (body.scrollTop !== top) body.scrollTop = top;
			});
		};
		restore();
		let frames = 4;
		const tick = () => {
			restore();
			if (--frames > 0) window.requestAnimationFrame(tick);
		};
		window.requestAnimationFrame(tick);
	}

	private setActiveCard(path: string | null): void {
		if (this._activeCardPath) {
			this.findCardEl(this._activeCardPath)?.classList.remove(CSS_CLASSES.CARD_ACTIVE);
		}
		this._activeCardPath = path;
		if (path) {
			this.findCardEl(path)?.classList.add(CSS_CLASSES.CARD_ACTIVE);
		}
	}

	private reapplyActiveCard(): void {
		if (!this._activeCardPath) return;
		this.findCardEl(this._activeCardPath)?.classList.add(CSS_CLASSES.CARD_ACTIVE);
	}

	private didSortableIndexChange(evt: Sortable.SortableEvent): boolean {
		if (evt.oldDraggableIndex !== undefined || evt.newDraggableIndex !== undefined) {
			return evt.oldDraggableIndex !== evt.newDraggableIndex;
		}
		if (evt.oldIndex !== undefined || evt.newIndex !== undefined) {
			return evt.oldIndex !== evt.newIndex;
		}
		return false;
	}

	private hasActiveSort(): boolean {
		const sortConfig = this.config?.getSort();
		if (Array.isArray(sortConfig)) return sortConfig.length > 0;
		if (!sortConfig || typeof sortConfig !== 'object') return Boolean(sortConfig);
		return Object.keys(sortConfig).length > 0;
	}

	private getOrderedColumnValues(liveValues: string[]): string[] {
		if (!this._prefs.columnOrder.length) return liveValues.sort();
		// Include all saved columns (even empty ones); append any new live values.
		const newValues = liveValues.filter((v) => !this._prefs.columnOrder.includes(v));
		return [...this._prefs.columnOrder, ...newValues];
	}

	private applyCardOrder(entries: BasesEntry[], savedOrder: string[]): BasesEntry[] {
		const entryMap = new Map(entries.map((e) => [e.file.path, e]));
		const ordered = savedOrder.map((p) => entryMap.get(p)).filter((e): e is BasesEntry => e !== undefined);
		const unsaved = entries.filter((e) => !savedOrder.includes(e.file.path));
		return [...ordered, ...unsaved];
	}

	/**
	 * If `savedPath` still exists in the vault, return it unchanged. Otherwise
	 * try to recover from a rename that happened while this board was closed:
	 * look in the same directory for a unique markdown file whose basename
	 * shares the same hyphen-prefix (e.g. `C0-2-`). Returns the recovered path
	 * if exactly one candidate matches; otherwise returns the original path.
	 *
	 * Conservative on purpose — silently keeps the stale path when the match
	 * is ambiguous (so it never picks the wrong card).
	 */
	private recoverStalePath(savedPath: string): string {
		const app = this.app;
		if (!app?.vault) return savedPath;
		if (app.vault.getAbstractFileByPath(savedPath)) return savedPath;
		const lastSlash = savedPath.lastIndexOf('/');
		const dir = lastSlash >= 0 ? savedPath.slice(0, lastSlash) : '';
		const basename = savedPath.slice(lastSlash + 1).replace(/\.md$/, '');
		const parts = basename.split('-');
		if (parts.length < 2) return savedPath;
		// Prefix = first two hyphen segments, e.g. "C0-2"
		const prefix = `${parts[0]}-${parts[1]}-`;
		const candidates: string[] = [];
		for (const f of app.vault.getMarkdownFiles()) {
			if (f.parent?.path !== dir) continue;
			if (f.name.startsWith(prefix)) candidates.push(f.path);
			if (candidates.length > 1) return savedPath; // ambiguous
		}
		return candidates.length === 1 ? candidates[0] : savedPath;
	}

	/**
	 * Called from the global vault.rename listener (registerGlobalRenameSync).
	 * Updates in-session _prefs.cardOrders so the renamed card keeps its saved
	 * position instead of being treated as a new entry and appended to the end.
	 *
	 * Marks _prefs dirty so the corrected paths are flushed back to config on
	 * close (the Bases host then persists the updated paths to the .base file).
	 */
	public handleRename(oldPath: string, newPath: string): void {
		let changed = false;
		for (const key of Object.keys(this._prefs.cardOrders)) {
			const order = this._prefs.cardOrders[key];
			const idx = order.indexOf(oldPath);
			if (idx >= 0) {
				order[idx] = newPath;
				changed = true;
			}
		}
		if (changed) {
			this._prefsDirty = true;
		}
	}

	onClose(): void {
		// Tear down event paths FIRST: the flush below writes config, which can make
		// the Bases host emit onDataUpdated / metadata events while we are closing.
		// Mark closed (guards any already-queued debounced render), then cancel the
		// debounce.
		this._closed = true;
		openKanbanViews.delete(this);
		this._debouncedRender.cancel();
		// NOTE: the property-suggester patch is deliberately NOT removed here —
		// Bases closes the view whenever its tab goes background, which is when
		// the user edits note properties. main.ts restores it on plugin unload.
		// Flush any in-session pref changes (card/column order, colors, widths) to
		// the .base config now. We deliberately never write config during a session
		// because each write makes the Bases host rebuild the whole view (a visible
		// flash); on close the view is going away, so the rebuild is invisible.
		this._flushPrefs();
		this.destroySortables();
		this.activeColorPicker?.remove();
		this.activeColorPicker = null;
		// The toggle may live in the native toolbar (outside our container), so it
		// won't be torn down with the view. Remove it explicitly to avoid orphans.
		this._toolbarObserver?.disconnect();
		this._toolbarObserver = null;
		this._minimalToggleEl?.remove();
		this._minimalToggleEl = null;
	}

	/**
	 * Column state (order and colors) is persisted using BasesViewConfig.set/get
	 * (https://docs.obsidian.md/Reference/TypeScript+API/BasesViewConfig#Methods)
	 * rather than Plugin.saveData/loadData
	 * (https://docs.obsidian.md/Plugins/User+interface/Settings).
	 *
	 * Why: Plugin.saveData writes a single plugin-wide plugin.data.json, so all
	 * bases shared the same column state keyed only by property ID. Using the
	 * BasesViewConfig API instead means each .base file carries its own state —
	 * deleting and re-adding the plugin no longer wipes configuration, and two bases
	 * that group by the same property can have independent column orders and colors.
	 *
	 * Migration: versions prior to 0.3.0 wrote to plugin.data.json. The
	 * legacyData parameter passed from main.ts holds that data. On the first
	 * render after upgrade, the legacy value is written into the base config via
	 * set() and subsequent renders use _prefs which is already populated — so
	 * this migration path is exercised at most once per base.
	 *
	 * plugin.data.json is intentionally left in place after migration rather than
	 * deleted: removing it would be destructive if something went wrong mid-upgrade,
	 * and the file simply becomes stale once each base has migrated its own state.
	 */

	static getViewOptions(this: void): ViewOption[] {
		return [
			{
				displayName: t('option.groupBy'),
				type: 'property',
				key: 'groupByProperty',
				filter: (prop: string) => !prop.startsWith('file.'),
				placeholder: t('option.groupBy.placeholder'),
			},
			{
				displayName: t('option.swimlaneBy'),
				type: 'property',
				key: 'swimlaneByProperty',
				filter: (prop: string) => !prop.startsWith('file.'),
				placeholder: t('option.swimlaneBy.placeholder'),
			},
			{
				displayName: t('option.quickAddFolder'),
				type: 'folder',
				key: 'quickAddFolder',
				placeholder: t('option.quickAddFolder.placeholder'),
			},
			{
				displayName: t('option.cardTitle'),
				type: 'property',
				key: 'cardTitleProperty',
				placeholder: t('option.cardTitle.placeholder'),
			},
			{
				displayName: t('option.cardColor'),
				type: 'property',
				key: 'cardColorProperty',
				filter: (prop: string) => !prop.startsWith('file.'),
				placeholder: t('option.cardColor.placeholder'),
			},
			{
				displayName: t('option.cardColorOrder'),
				type: 'multitext',
				key: 'cardColorOrder',
				shouldHide: (config: BasesViewConfig) => !config.getAsPropertyId('cardColorProperty'),
			},
			{
				displayName: t('option.imageProperty'),
				type: 'property',
				key: 'imageProperty',
				placeholder: t('option.imageProperty.placeholder'),
			},
			{
				displayName: t('option.imageFit'),
				type: 'dropdown',
				key: 'imageFit',
				default: 'cover',
				options: { cover: t('option.imageFit.cover'), contain: t('option.imageFit.contain') },
			},
			{
				displayName: t('option.imageAspectRatio'),
				type: 'slider',
				key: 'imageAspectRatio',
				default: 0.5,
				min: 0.25,
				max: 2.5,
				step: 0.05,
			},
			{
				displayName: t('option.wrapPropertyValues'),
				type: 'toggle',
				key: 'wrapPropertyValues',
			},
			{
				displayName: t('option.columnWidth'),
				type: 'slider',
				key: 'columnWidth',
				default: 280,
				min: 200,
				max: 520,
				step: 10,
			},
			{
				displayName: t('option.masonryColumns'),
				type: 'slider',
				key: 'masonryColumns',
				default: 4,
				min: 2,
				max: 12,
				step: 1,
			},
		];
	}
}
