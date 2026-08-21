import { FuzzySuggestModal, Menu, Notice, parseYaml } from 'obsidian';
import type { App, BasesPropertyId, BasesViewConfig } from 'obsidian';
import { CSS_CLASSES } from './constants.ts';
import { createDemoBoard } from './demo.ts';
import { t } from './i18n/index.ts';

/**
 * View-config keys that are safe and meaningful to copy from one view to
 * another (the "use this view as a template" whitelist). Deliberately
 * excludes cardOrders: manual drag positions are per-view transient state.
 * 'order' (visible property list) is managed by the Bases host — copying it
 * is best-effort and harmless if the host ignores the write.
 */
export const COPYABLE_KEYS: readonly string[] = [
	'groupByProperty',
	'swimlaneByProperty',
	'quickAddFolder',
	'cardTitleProperty',
	'cardColorProperty',
	'cardColorOrder',
	'cardColors',
	'cardSelectOptions',
	'imageProperty',
	'imageFit',
	'imageAspectRatio',
	'wrapPropertyValues',
	'hideEmptyColumns',
	'columnWidth',
	'columnWidths',
	'columnColors',
	'columnOrders',
	'masonryMode',
	'masonryColumnFirst',
	'masonryColumns',
	'masonrySortProperty',
	'minimalMode',
	'order',
	'sort',
];

export interface ViewTemplate {
	name: string;
	description: string;
	config: Record<string, unknown>;
}

const STATUS_ORDER = [
	'🟤 未開始',
	'🔴 進行中',
	'🟡 25%',
	'🔵 50%',
	'🟣 75%',
	'🩵 90%',
	'🩷 99%',
	'🟢 100%',
	'⚪ 已交付',
	'🟤 可以封存',
];
const STATUS_COLORS = Object.fromEntries([
	['🟤 未開始', 'brown'],
	['🔴 進行中', 'red'],
	['🟡 25%', 'yellow'],
	['🔵 50%', 'blue'],
	['🟣 75%', 'purple'],
	['🩵 90%', 'cyan'],
	['🩷 99%', 'pink'],
	['🟢 100%', 'green'],
	['⚪ 已交付', 'gray'],
	['🟤 可以封存', 'brown'],
]);

export const DEFAULT_VIEW_TEMPLATES: readonly ViewTemplate[] = [
	{
		name: '每日工作台',
		description: '依時間安排每日優先順序',
		config: {
			groupByProperty: 'note.時間',
			quickAddFolder: 'B1_個人策略/5-主線看板',
			cardTitleProperty: 'note.目標',
			cardColorProperty: 'note.狀態',
			cardColorOrder: STATUS_ORDER,
			cardSelectOptions: { 'note.優先度': ['⭐⭐⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐', '⭐⭐', '⭐'] },
			cardColors: { 'note.狀態': STATUS_COLORS },
			columnOrders: { 'note.時間': ['專案列表', '今天必達', '本週目標', '本月目標', '本季目標'] },
			columnWidth: 260,
			wrapPropertyValues: true,
			minimalMode: true,
			masonryMode: false,
			hideEmptyColumns: false,
			order: ['優先度', '狀態', '下一步'],
			sort: [{ property: '優先度', direction: 'DESC' }],
		},
	},
	{
		name: '專案進度看板',
		description: '依狀態追蹤交付進度',
		config: {
			groupByProperty: 'note.狀態',
			quickAddFolder: 'B1_個人策略/5-主線看板',
			cardTitleProperty: 'note.目標',
			cardColorProperty: 'note.狀態',
			cardColorOrder: STATUS_ORDER,
			cardSelectOptions: { 'note.優先度': ['⭐⭐⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐', '⭐⭐', '⭐'] },
			cardColors: { 'note.狀態': STATUS_COLORS },
			columnOrders: { 'note.狀態': STATUS_ORDER },
			columnWidth: 300,
			wrapPropertyValues: true,
			minimalMode: false,
			masonryMode: false,
			hideEmptyColumns: false,
			order: ['優先度', '時間', '下一步'],
			sort: [{ property: '優先度', direction: 'DESC' }],
		},
	},
];

export interface SiblingViewConfig {
	name: string;
	config: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the other configured hans-kanban views of the currently open .base
 * file. There is no public API to enumerate sibling views from a BasesView,
 * so this reads the active file (adding/configuring a view means the .base is
 * the active tab). Any failure — embedded base, unreadable file, malformed
 * YAML — returns [] and the caller degrades to the onboarding card.
 */
export async function readSiblingKanbanViews(app: App, excludeName: string): Promise<SiblingViewConfig[]> {
	try {
		const file = app.workspace.getActiveFile();
		if (!file || file.extension !== 'base') return [];
		const raw = await app.vault.read(file);
		const parsed: unknown = parseYaml(raw);
		if (!isRecord(parsed) || !Array.isArray(parsed.views)) return [];
		const siblings: SiblingViewConfig[] = [];
		for (const view of parsed.views) {
			if (!isRecord(view)) continue;
			if (view.type !== 'hans-kanban-view') continue;
			const name = typeof view.name === 'string' ? view.name : '';
			if (name === '' || name === excludeName) continue;
			if (typeof view.groupByProperty !== 'string' || view.groupByProperty === '') continue;
			siblings.push({ name, config: view });
		}
		return siblings;
	} catch (error) {
		console.error('KanbanView: failed to read sibling views', error);
		return [];
	}
}

/** Copy every whitelisted key that the sibling actually has into `config`. */
export function applyViewConfigCopy(config: BasesViewConfig, sibling: SiblingViewConfig): void {
	for (const key of COPYABLE_KEYS) {
		if (key in sibling.config && sibling.config[key] !== undefined) {
			config.set(key, sibling.config[key]);
		}
	}
}

export function applyViewTemplate(config: BasesViewConfig, template: ViewTemplate): void {
	applyViewConfigCopy(config, { name: template.name, config: template.config });
	config.set('inheritedFrom', `template:${template.name}`);
}

export class TemplatePickerModal extends FuzzySuggestModal<ViewTemplate> {
	constructor(
		app: App,
		private templates: readonly ViewTemplate[],
		private onPick: (template: ViewTemplate) => void,
	) {
		super(app);
		this.setPlaceholder('選擇看板模板');
	}
	getItems(): ViewTemplate[] {
		return [...this.templates];
	}
	getItemText(item: ViewTemplate): string {
		return `${item.name}：${item.description}`;
	}
	onChooseItem(item: ViewTemplate): void {
		this.onPick(item);
	}
}

class GroupByPropertyModal extends FuzzySuggestModal<BasesPropertyId> {
	constructor(
		app: App,
		private properties: BasesPropertyId[],
		private displayName: (id: BasesPropertyId) => string,
		private onPick: (id: BasesPropertyId) => void,
	) {
		super(app);
		this.setPlaceholder(t('onboarding.pickProperty.placeholder'));
	}

	getItems(): BasesPropertyId[] {
		return this.properties;
	}

	getItemText(item: BasesPropertyId): string {
		return this.displayName(item);
	}

	onChooseItem(item: BasesPropertyId): void {
		this.onPick(item);
	}
}

export interface OnboardingCtx {
	app: App;
	config: BasesViewConfig;
	/** Dataset properties, used for the group-by picker (file.* filtered out). */
	allProperties: BasesPropertyId[];
	getDisplayName: (id: BasesPropertyId) => string;
}

/**
 * Friendly empty state for an unconfigured view: instead of the confusing
 * one-column-per-file fallback, explain the situation and offer three ways
 * out — copy a configured sibling view, pick a group-by property, or build
 * the demo board.
 */
export function renderOnboarding(containerEl: HTMLElement, ctx: OnboardingCtx): void {
	const card = containerEl.createDiv({ cls: CSS_CLASSES.ONBOARDING });
	card.createDiv({ cls: CSS_CLASSES.ONBOARDING_TITLE, text: t('onboarding.title') });
	card.createDiv({ cls: CSS_CLASSES.ONBOARDING_DESC, text: t('onboarding.desc') });
	const actions = card.createDiv({ cls: CSS_CLASSES.ONBOARDING_ACTIONS });
	for (const [index, template] of DEFAULT_VIEW_TEMPLATES.entries()) {
		const button = actions.createEl('button', {
			text: index === 0 ? `${template.name}（推薦）` : template.name,
			cls: index === 0 ? 'mod-cta' : '',
		});
		button.addEventListener('click', () => {
			applyViewTemplate(ctx.config, template);
			new Notice(t('notice.copiedView').replace('{name}', template.name));
		});
	}

	const copyBtn = actions.createEl('button', { text: t('onboarding.copyView') });
	copyBtn.addEventListener('click', (e) => {
		void (async () => {
			const siblings = await readSiblingKanbanViews(ctx.app, ctx.config.name);
			if (siblings.length === 0) {
				new Notice(t('onboarding.copyView.none'));
				return;
			}
			const apply = (sibling: SiblingViewConfig) => {
				applyViewConfigCopy(ctx.config, sibling);
				new Notice(t('notice.copiedView').replace('{name}', sibling.name));
			};
			if (siblings.length === 1) {
				apply(siblings[0]);
				return;
			}
			const menu = new Menu();
			for (const sibling of siblings) {
				menu.addItem((item) => item.setTitle(sibling.name).onClick(() => apply(sibling)));
			}
			menu.showAtMouseEvent(e);
		})();
	});

	const pickBtn = actions.createEl('button', { text: t('onboarding.pickProperty') });
	pickBtn.addEventListener('click', () => {
		const properties = ctx.allProperties.filter((id) => !id.startsWith('file.'));
		new GroupByPropertyModal(ctx.app, properties, ctx.getDisplayName, (id) => {
			ctx.config.set('groupByProperty', id);
		}).open();
	});

	const demoBtn = actions.createEl('button', { text: t('onboarding.demo') });
	demoBtn.addEventListener('click', () => {
		void createDemoBoard(ctx.app);
	});
}
