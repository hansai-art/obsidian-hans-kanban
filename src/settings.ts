import { type App, PluginSettingTab, Setting, type SettingDefinitionItem, normalizePath } from 'obsidian';
import { DEFAULT_DEMO_FOLDER } from './demo.ts';
import { t } from './i18n/index.ts';
import { isRecord } from './kanbanView.ts';
import type KanbanBasesViewPlugin from './main.ts';

export interface KanbanPluginSettings {
	/** Vault-relative folder where the one-click demo board is created and removed. */
	demoFolder: string;
}

export const DEFAULT_SETTINGS: KanbanPluginSettings = {
	demoFolder: DEFAULT_DEMO_FOLDER,
};

/**
 * Validates a raw persisted value into settings. Empty or non-string folder
 * falls back to the default so create/remove never operate on ''.
 */
export function parseSettings(raw: unknown): KanbanPluginSettings {
	const record: Record<string, unknown> = isRecord(raw) ? raw : {};
	const folder = typeof record.demoFolder === 'string' ? record.demoFolder.trim() : '';
	return {
		demoFolder: folder ? normalizePath(folder) : DEFAULT_SETTINGS.demoFolder,
	};
}

export class KanbanSettingTab extends PluginSettingTab {
	private readonly plugin: KanbanBasesViewPlugin;

	constructor(app: App, plugin: KanbanBasesViewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative settings (Obsidian 1.13+). Returning a non-empty array makes
	 * Obsidian render the tab from these definitions and index them for
	 * settings search; display() below is never called there.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t('settings.demoFolder.name'),
				desc: t('settings.demoFolder.desc'),
				control: {
					type: 'folder',
					key: 'demoFolder',
					placeholder: DEFAULT_SETTINGS.demoFolder,
					defaultValue: DEFAULT_SETTINGS.demoFolder,
				},
			},
		];
	}

	/**
	 * The default implementation writes the raw input straight to
	 * plugin.settings. Route it through the same normalization display() uses so
	 * an empty or unnormalized folder can never reach create/remove demo board.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		// demoFolder is the only declared control; deliberately no super call, so
		// nothing here touches an API that Obsidian 1.10.2 (our minAppVersion)
		// does not have.
		if (key !== 'demoFolder') return;
		const raw = typeof value === 'string' ? value.trim() : '';
		this.plugin.settings.demoFolder = raw ? normalizePath(raw) : DEFAULT_SETTINGS.demoFolder;
		await this.plugin.saveSettings();
	}

	/** Fallback for Obsidian older than 1.13.0, which has no declarative settings. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settings.demoFolder.name'))
			.setDesc(t('settings.demoFolder.desc'))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.demoFolder)
					.setValue(this.plugin.settings.demoFolder)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.demoFolder = trimmed ? normalizePath(trimmed) : DEFAULT_SETTINGS.demoFolder;
						await this.plugin.saveSettings();
					}),
			);
	}
}
