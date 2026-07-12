import { type App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
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
