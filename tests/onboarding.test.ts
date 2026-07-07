import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COPYABLE_KEYS, applyViewConfigCopy, readSiblingKanbanViews } from '../src/onboarding.ts';
import { createMockApp, createMockQueryController } from './helpers.ts';

function appWithBase(views: unknown[] | string): ReturnType<typeof createMockApp> {
	const app = createMockApp() as any;
	app.workspace.getActiveFile = () => ({ extension: 'base', path: 'board.base' });
	app.vault.read = async () => (typeof views === 'string' ? views : JSON.stringify({ views }));
	return app;
}

const configuredView = {
	type: 'hans-kanban-view',
	name: '決策看板',
	groupByProperty: 'note.應徵方式',
	cardTitleProperty: 'note.姓名',
	cardColorProperty: 'note.狀態',
	cardColorOrder: ['🟣 已面試', '🔴 淘汰'],
	cardOrders: { x: ['a.md'] },
};

describe('readSiblingKanbanViews', () => {
	test('returns configured hans-kanban views, excluding self', async () => {
		const app = appWithBase([
			configuredView,
			{ type: 'hans-kanban-view', name: '自己' },
			{ type: 'table', name: '表格' },
		]);
		const siblings = await readSiblingKanbanViews(app, '自己');
		assert.strictEqual(siblings.length, 1);
		assert.strictEqual(siblings[0].name, '決策看板');
	});

	test('returns [] when the active file is not a .base', async () => {
		const app = appWithBase([configuredView]) as any;
		app.workspace.getActiveFile = () => ({ extension: 'md', path: 'note.md' });
		assert.deepStrictEqual(await readSiblingKanbanViews(app, 'x'), []);
	});

	test('returns [] when there is no active file', async () => {
		const app = appWithBase([configuredView]) as any;
		app.workspace.getActiveFile = (): null => null;
		assert.deepStrictEqual(await readSiblingKanbanViews(app, 'x'), []);
	});

	test('returns [] on malformed file content', async () => {
		const app = appWithBase('not: [valid');
		assert.deepStrictEqual(await readSiblingKanbanViews(app, 'x'), []);
	});

	test('skips kanban views without a groupByProperty', async () => {
		const app = appWithBase([{ type: 'hans-kanban-view', name: '空的' }]);
		assert.deepStrictEqual(await readSiblingKanbanViews(app, 'x'), []);
	});
});

describe('applyViewConfigCopy', () => {
	test('copies whitelisted keys and skips cardOrders', () => {
		const controller = createMockQueryController([], []) as any;
		applyViewConfigCopy(controller.config, { name: '決策看板', config: configuredView });
		assert.strictEqual(controller.config.get('groupByProperty'), 'note.應徵方式');
		assert.strictEqual(controller.config.get('cardTitleProperty'), 'note.姓名');
		assert.deepStrictEqual(controller.config.get('cardColorOrder'), ['🟣 已面試', '🔴 淘汰']);
		assert.strictEqual(controller.config.get('cardOrders'), null, 'cardOrders is per-view drag state, never copied');
		assert.ok(!COPYABLE_KEYS.includes('cardOrders'));
	});
});
