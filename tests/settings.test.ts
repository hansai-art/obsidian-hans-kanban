import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import './helpers.ts';
import { DEFAULT_SETTINGS, KanbanSettingTab, parseSettings } from '../src/settings.ts';

function createTab() {
	const saved: number[] = [];
	const plugin = {
		settings: { ...DEFAULT_SETTINGS },
		saveSettings: async () => {
			saved.push(1);
		},
	};
	const tab = new KanbanSettingTab({} as any, plugin as any);
	return { tab, plugin, savedCount: () => saved.length };
}

describe('Settings tab', () => {
	test('declares one folder control bound to demoFolder', () => {
		const { tab } = createTab();
		const definitions = tab.getSettingDefinitions();

		assert.strictEqual(definitions.length, 1);
		const [definition] = definitions;
		assert.ok('control' in definition && definition.control, 'entry is a control definition');
		assert.ok('name' in definition && definition.name, 'setting has a display name for settings search');
		assert.ok('desc' in definition && definition.desc, 'setting has a description');
		assert.strictEqual(definition.control.type, 'folder');
		assert.strictEqual(definition.control.key, 'demoFolder');
		assert.strictEqual(definition.control.defaultValue, DEFAULT_SETTINGS.demoFolder);
	});

	test('setControlValue normalizes the folder and persists it', async () => {
		const { tab, plugin, savedCount } = createTab();
		await tab.setControlValue('demoFolder', '  Projects//Demo Board/  ');

		assert.strictEqual(plugin.settings.demoFolder, 'Projects/Demo Board');
		assert.strictEqual(savedCount(), 1, 'saveSettings called once');
	});

	// Same guarantee display() gives: create/remove demo board must never run
	// against an empty folder path.
	test('setControlValue falls back to the default on blank input', async () => {
		const { tab, plugin } = createTab();
		plugin.settings.demoFolder = 'something else';
		await tab.setControlValue('demoFolder', '   ');

		assert.strictEqual(plugin.settings.demoFolder, DEFAULT_SETTINGS.demoFolder);
	});

	test('setControlValue ignores keys it does not own', async () => {
		const { tab, plugin, savedCount } = createTab();
		await tab.setControlValue('somethingElse', 'value');

		assert.deepStrictEqual(plugin.settings, { ...DEFAULT_SETTINGS });
		assert.strictEqual(savedCount(), 0, 'no write for an unknown key');
	});
});

describe('parseSettings', () => {
	test('normalizes a stored folder', () => {
		assert.strictEqual(parseSettings({ demoFolder: ' Boards//Demo ' }).demoFolder, 'Boards/Demo');
	});

	test('falls back to the default for empty, wrong-typed, or missing values', () => {
		for (const raw of [{ demoFolder: '   ' }, { demoFolder: 42 }, {}, null, 'not an object']) {
			assert.strictEqual(parseSettings(raw).demoFolder, DEFAULT_SETTINGS.demoFolder);
		}
	});
});
