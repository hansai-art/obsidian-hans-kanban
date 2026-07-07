import { Plugin } from 'obsidian';
import { HOVER_LINK_SOURCE_ID } from './constants.ts';
import { createDemoBoard, DemoPromptModal } from './demo.ts';
import { t } from './i18n/index.ts';
import {
	KanbanView,
	type LegacyData,
	isRecord,
	isColumnOrders,
	isColumnColors,
	installPropertySuggesterPatch,
	installWriteTimeAutoColor,
	registerGlobalAutoColor,
	registerGlobalRenameSync,
	restorePropertySuggester,
	restoreWriteTimeAutoColor,
	setSuggesterOptionsPersistence,
} from './kanbanView.ts';
import { openRecolorModal } from './recolorModal.ts';

export const KANBAN_VIEW_TYPE = 'hans-kanban-view';

/**
 * Reads column order and color data previously stored in plugin.data.json
 * (via Obsidian's Plugin.saveData API) and normalises it into LegacyData.
 *
 * Column state is now persisted per-base using BasesViewConfig.set/get, so
 * plugin.data.json is no longer written to. This function is the bridge that
 * lets existing users keep their configuration when upgrading.
 *
 * Two historical shapes are handled:
 *   - Current:  { columnOrders: { [propertyId]: string[] }, columnColors: { [propertyId]: { [value]: color } } }
 *   - Pre-v0.1: { [propertyId]: string[] }  (columnOrders only, no color support)
 */
function parseLegacyData(data: unknown): LegacyData | null {
	if (!isRecord(data)) return null;

	// Current on-disk format: { columnOrders: {...}, columnColors: {...} }
	if ('columnOrders' in data && isColumnOrders(data.columnOrders)) {
		return {
			columnOrders: data.columnOrders,
			columnColors: isColumnColors(data.columnColors) ? data.columnColors : {},
		};
	}

	// Pre-migration format: { 'note.status': ['To Do', ...], ... }
	if (isColumnOrders(data)) {
		return {
			columnOrders: data,
			columnColors: {},
		};
	}

	return null;
}

export default class KanbanBasesViewPlugin extends Plugin {
	async onload() {
		// Read any data previously saved to plugin.data.json and pass it to each
		// view instance so it can lazily migrate state into the base config on
		// first render. Once migrated, plugin.data.json is no longer consulted.
		const raw: unknown = await this.loadData();
		const legacyData = parseLegacyData(raw);

		this.registerHoverLinkSource(HOVER_LINK_SOURCE_ID, {
			display: 'Kanban',
			defaultMod: true,
		});

		this.registerBasesView(KANBAN_VIEW_TYPE, {
			name: 'Hans Kanban',
			icon: 'columns',
			factory: (controller, scrollEl) => {
				return new KanbanView(controller, scrollEl, legacyData);
			},
			options: KanbanView.getViewOptions,
		});

		// Auto-color edited card-color values plugin-wide. This must outlive any
		// single board view: Bases tears a view down whenever its tab goes to the
		// background, which is exactly when the user edits a note's property.
		const autoColorRef = registerGlobalAutoColor(this.app);
		if (autoColorRef) this.registerEvent(autoColorRef);

		// Sync renamed-file paths into all open boards' _prefs.cardOrders so a
		// renamed card keeps its saved column position instead of falling to the
		// end. Closed boards self-recover on next open via recoverStalePath().
		const renameSyncRef = registerGlobalRenameSync(this.app);
		if (renameSyncRef) this.registerEvent(renameSyncRef);

		// Option lists persisted from previous sessions make the suggester patch,
		// the write-time patch and the auto-color listener effective from app
		// startup — no board render needed first. Board renders keep them fresh.
		const data = isRecord(raw) ? { ...raw } : {};
		setSuggesterOptionsPersistence(data.suggesterOptions, (options) => {
			data.suggesterOptions = options;
			void this.saveData(data);
		});
		installPropertySuggesterPatch(this.app);
		installWriteTimeAutoColor(this.app);

		// One-click sample board, always available from the command palette.
		this.addCommand({
			id: 'create-demo-board',
			name: t('command.createDemo'),
			callback: () => {
				void createDemoBoard(this.app);
			},
		});

		// Recolor any status value (picker UI) without opening a board.
		this.addCommand({
			id: 'recolor-status',
			name: t('command.recolor'),
			callback: () => {
				openRecolorModal(this.app);
			},
		});

		// First run after install: offer the demo board once. We merge the flag
		// into existing data so any not-yet-migrated legacy column state survives,
		// and record it before showing the modal so it never nags twice.
		if (!data.demoPrompted) {
			data.demoPrompted = true;
			await this.saveData(data);
			this.app.workspace.onLayoutReady(() => {
				new DemoPromptModal(this.app, () => {
					void createDemoBoard(this.app);
				}).open();
			});
		}
	}

	onunload() {
		// Hand Obsidian's property-value suggester and processFrontMatter back to
		// their original implementations (boards keep them patched across view
		// close, see kanbanView.ts).
		restorePropertySuggester();
		restoreWriteTimeAutoColor();
	}
}
