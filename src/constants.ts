/**
 * Constants used throughout the Kanban view
 */

import { t } from './i18n/index.ts';

/** Label used for entries without a property value */
export const UNCATEGORIZED_LABEL = t('label.uncategorized');

/** Source id registered with Obsidian's Page Preview core plugin */
export const HOVER_LINK_SOURCE_ID = 'hans-kanban';

/** Color palette for column accents, using Obsidian design system variables */
export const COLOR_PALETTE = [
	{ name: 'red', cssVar: 'var(--color-red)' },
	{ name: 'orange', cssVar: 'var(--color-orange)' },
	{ name: 'yellow', cssVar: 'var(--color-yellow)' },
	{ name: 'green', cssVar: 'var(--color-green)' },
	{ name: 'cyan', cssVar: 'var(--color-cyan)' },
	{ name: 'blue', cssVar: 'var(--color-blue)' },
	{ name: 'purple', cssVar: 'var(--color-purple)' },
	{ name: 'pink', cssVar: 'var(--color-pink)' },
	// Obsidian themes don't define brown/gray accent variables, so these two
	// carry fallbacks. They extend the palette to 10 so boards with all 8
	// classic colors taken can still hand new values an unused color.
	{ name: 'brown', cssVar: 'var(--color-brown, #9a6b4a)' },
	{ name: 'gray', cssVar: 'var(--color-gray, #8a8a8a)' },
] as const;

export type ColorName = (typeof COLOR_PALETTE)[number]['name'];

/**
 * Leading color-emoji → palette color name. Lets a status value like
 * "🔴 講義" map to its intuitive accent color without manual configuration.
 * Values without a leading color emoji fall back to palette-by-index.
 */
export const EMOJI_COLOR_MAP: Record<string, ColorName> = {
	'🔴': 'red',
	'🟠': 'orange',
	'🟡': 'yellow',
	'🟢': 'green',
	'🔵': 'blue',
	'🟣': 'purple',
	'🩵': 'cyan',
	'🩷': 'pink',
	'🟤': 'brown',
	'🩶': 'gray',
	// Alternates selectable via the recolor picker. All single-codepoint (no
	// VS16 sequences like ❤️), so the leading-emoji strip logic stays safe.
	'🌹': 'red',
	'🧡': 'orange',
	'🔥': 'orange',
	'💛': 'yellow',
	'⭐': 'yellow',
	'💚': 'green',
	'✅': 'green',
	'💙': 'blue',
	'💎': 'cyan',
	'💜': 'purple',
	'🌸': 'pink',
	'🤎': 'brown',
	'🖤': 'gray',
	'🤍': 'gray',
};

/**
 * Picker grid for the recolor command: every choice the user can assign to a
 * status value, grouped by palette color. The first emoji of each color is
 * the canonical dot used for automatic assignment (COLOR_NAME_TO_EMOJI).
 */
export const EMOJI_CHOICES: ReadonlyArray<{ emoji: string; color: ColorName }> = [
	{ emoji: '🔴', color: 'red' },
	{ emoji: '🌹', color: 'red' },
	{ emoji: '🟠', color: 'orange' },
	{ emoji: '🧡', color: 'orange' },
	{ emoji: '🔥', color: 'orange' },
	{ emoji: '🟡', color: 'yellow' },
	{ emoji: '💛', color: 'yellow' },
	{ emoji: '⭐', color: 'yellow' },
	{ emoji: '🟢', color: 'green' },
	{ emoji: '💚', color: 'green' },
	{ emoji: '✅', color: 'green' },
	{ emoji: '🩵', color: 'cyan' },
	{ emoji: '💎', color: 'cyan' },
	{ emoji: '🔵', color: 'blue' },
	{ emoji: '💙', color: 'blue' },
	{ emoji: '🟣', color: 'purple' },
	{ emoji: '💜', color: 'purple' },
	{ emoji: '🩷', color: 'pink' },
	{ emoji: '🌸', color: 'pink' },
	{ emoji: '🟤', color: 'brown' },
	{ emoji: '🤎', color: 'brown' },
	{ emoji: '🩶', color: 'gray' },
	{ emoji: '🖤', color: 'gray' },
	{ emoji: '🤍', color: 'gray' },
];

/** Inverse of EMOJI_COLOR_MAP: palette color name → leading dot emoji. */
export const COLOR_NAME_TO_EMOJI: Record<string, string> = {
	red: '🔴',
	orange: '🟠',
	yellow: '🟡',
	green: '🟢',
	blue: '🔵',
	purple: '🟣',
	cyan: '🩵',
	pink: '🩷',
	brown: '🟤',
	gray: '🩶',
};

/** Sortable.js group name for kanban columns */
export const SORTABLE_GROUP = 'obk-columns';

/** Notice shown when Base sorting prevents manual card ordering */
export const SORTED_CARD_ORDER_NOTICE = t('notice.sortedCardOrder');

/** Data attribute names */
export const DATA_ATTRIBUTES = {
	COLUMN_VALUE: 'data-column-value',
	ENTRY_PATH: 'data-entry-path',
	SORTABLE_CONTAINER: 'data-sortable-container',
	COLUMN_POSITION: 'data-column-position',
	COLUMN_COLOR: 'data-column-color',
	SWIMLANE_VALUE: 'data-swimlane-value',
} as const;

/**
 * Separator used to build composite cardOrders keys when swimlanes are active.
 * Unit Separator (U+001F) is unlikely to occur inside a property value.
 */
export const SWIMLANE_KEY_SEPARATOR = '\u001F';

/** CSS class names */
export const CSS_CLASSES = {
	// Container
	/** Applied to Obsidian's .bases-view wrapper while it hosts this view. */
	BASES_HOST: 'obk-bases-host',
	VIEW_CONTAINER: 'obk-view-container',
	VIEW_CONTAINER_WITH_SWIMLANES: 'obk-view-container--with-swimlanes',
	BOARD: 'obk-board',
	BOARD_WITH_SWIMLANES: 'obk-board--with-swimlanes',

	// Swimlane (horizontal grouping band)
	SWIMLANE: 'obk-swimlane',
	SWIMLANE_COLLAPSED: 'obk-swimlane--collapsed',
	SWIMLANE_HEADER: 'obk-swimlane-header',
	SWIMLANE_TITLE: 'obk-swimlane-title',
	SWIMLANE_COUNT: 'obk-swimlane-count',
	SWIMLANE_BODY: 'obk-swimlane-body',
	SWIMLANE_TOGGLE: 'obk-swimlane-toggle',
	SWIMLANE_DRAG_HANDLE: 'obk-swimlane-drag-handle',
	SWIMLANE_DRAGGING: 'obk-swimlane-dragging',
	SWIMLANE_GHOST: 'obk-swimlane-ghost',

	// Property selector (for future or framework-driven UI)
	PROPERTY_SELECTOR: 'obk-property-selector',
	PROPERTY_LABEL: 'obk-property-label',
	PROPERTY_SELECT: 'obk-property-select',

	// Column
	COLUMN: 'obk-column',
	COLUMN_HEADER: 'obk-column-header',
	COLUMN_TITLE: 'obk-column-title',
	COLUMN_COUNT: 'obk-column-count',
	COLUMN_BODY: 'obk-column-body',
	COLUMN_DRAG_HANDLE: 'obk-column-drag-handle',
	COLUMN_DRAGGING: 'obk-column-dragging',
	COLUMN_GHOST: 'obk-column-ghost',
	COLUMN_ADD_BTN: 'obk-column-add-btn',

	// Card
	CARD: 'obk-card',
	CARD_COLORED: 'obk-card--colored',
	CARD_STATUS: 'obk-card-status',
	CARD_STATUS_SELECT: 'obk-card-status-select',
	/** Clickable color dot before the status switcher; opens the card-color picker. */
	CARD_COLOR_DOT: 'obk-card-color-dot',
	CARD_TITLE: 'obk-card-title',
	CARD_PREVIEW: 'obk-card-preview',
	CARD_COVER: 'obk-card-cover',
	CARD_COVER_FIT_COVER: 'obk-card-cover--fit-cover',
	CARD_COVER_FIT_CONTAIN: 'obk-card-cover--fit-contain',
	CARD_ACTIVE: 'obk-card--active',
	CARD_HOVER: 'obk-card--hover',
	CARD_DRAGGING: 'obk-card-dragging',
	CARD_GHOST: 'obk-card-ghost',
	CARD_CHOSEN: 'obk-card-chosen',
	CARD_PROPERTY: 'obk-card-property',
	CARD_PROPERTY_WRAP: 'obk-card-property-wrap',
	CARD_PROPERTY_LABEL: 'obk-card-property-label',
	CARD_PROPERTY_VALUE: 'obk-card-property-value',

	// Empty state
	EMPTY_STATE: 'obk-empty-state',

	// Sortable placeholder (fallback / shared ghost style)
	SORTABLE_GHOST: 'obk-sortable-ghost',

	// Column remove button (shown only when column is empty)
	COLUMN_REMOVE_BTN: 'obk-column-remove-btn',

	// Per-column width resize handle
	COLUMN_RESIZE_HANDLE: 'obk-column-resize-handle',
	COLUMN_RESIZING: 'obk-column--resizing',

	// View toggles (minimal / masonry), injected as one group into Obsidian's
	// native Bases toolbar (canvas stays clean); floating fallback if not found.
	TOOLBAR_TOGGLES: 'obk-toolbar-toggles',
	TOOLBAR_TOGGLES_FLOATING: 'obk-toolbar-toggles--floating',

	// Onboarding empty state (unconfigured view) + config warnings.
	ONBOARDING: 'obk-onboarding',
	ONBOARDING_TITLE: 'obk-onboarding-title',
	ONBOARDING_DESC: 'obk-onboarding-desc',
	ONBOARDING_ACTIONS: 'obk-onboarding-actions',
	CONFIG_WARNING: 'obk-config-warning',

	// Minimal (zen) mode: hide property labels.
	MINIMAL: 'obk-minimal',
	MINIMAL_TOGGLE: 'obk-minimal-toggle',
	MINIMAL_TOGGLE_ICON: 'obk-minimal-toggle-icon',
	MINIMAL_TOGGLE_ACTIVE: 'obk-minimal-toggle--active',

	// Masonry (flow) mode: cards flow in a CSS column-count grid, no groupBy columns.
	MASONRY_BOARD: 'obk-masonry-board',
	MASONRY_TOGGLE: 'obk-masonry-toggle',
	MASONRY_TOGGLE_ICON: 'obk-masonry-toggle-icon',
	MASONRY_TOGGLE_ACTIVE: 'obk-masonry-toggle--active',

	// Quick add modal
	QUICK_ADD_FORM: 'obk-quick-add-form',
	QUICK_ADD_INPUT: 'obk-quick-add-input',
	QUICK_ADD_ACTIONS: 'obk-quick-add-actions',

	// Color picker
	COLUMN_COLOR_BTN: 'obk-column-color-btn',
	COLUMN_COLOR_POPOVER: 'obk-column-color-popover',
	COLUMN_COLOR_SWATCH: 'obk-column-color-swatch',
	COLUMN_COLOR_SWATCH_ACTIVE: 'obk-column-color-swatch--active',
	COLUMN_COLOR_NONE: 'obk-column-color-none',
} as const;

/** Sortable.js configuration constants */
export const SORTABLE_CONFIG = {
	ANIMATION_DURATION: 150,
	TOUCH_DELAY: 150,
	TOUCH_START_THRESHOLD: 4,
} as const;

/** Debounce delay in ms for onDataUpdated renders */
export const DEBOUNCE_DELAY = 50;

/** Empty state messages */
export const EMPTY_STATE_MESSAGES = {
	NO_ENTRIES: t('empty.noEntries'),
	NO_PROPERTIES: t('empty.noProperties'),
} as const;
