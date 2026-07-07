import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { Notice, TFile, TFolder } from 'obsidian';
import { createDemoBoard, removeDemoBoard } from '../src/demo.ts';
import { setupTestEnvironment } from './helpers.ts';

setupTestEnvironment();

const DEMO_FOLDER = 'Hans Kanban 範例';

// Same pattern as kanbanView.test.ts: the mock Notice records messages statically.
const noticeMessages = (): unknown[] => (Notice as unknown as { notices: unknown[] }).notices;

function demoFile(name: string, extension: string): TFile {
	return Object.assign(new TFile(), {
		path: `${DEMO_FOLDER}/${name}`,
		name,
		basename: name.replace(/\.[^.]+$/, ''),
		extension,
	});
}

const DEMO_MD = '---\nhans_kanban_demo: true\narea: "x"\n---\n\nbody\n';
const USER_MD = '---\ntitle: mine\n---\n\nmy own note\n';

/** App stub for removeDemoBoard: a folder tree + recording trashFile. */
function makeRemovalApp(children: TFile[], contents: Record<string, string>) {
	const folder: TFolder = Object.assign(new TFolder(), {
		path: DEMO_FOLDER,
		name: DEMO_FOLDER,
		children: [...children],
	});
	const trashed: string[] = [];
	const app = {
		vault: {
			getFolderByPath: (path: string) => (path === DEMO_FOLDER ? folder : null),
			read: async (file: TFile) => contents[file.path] ?? '',
		},
		fileManager: {
			trashFile: async (file: TFile | TFolder) => {
				trashed.push(file.path);
				folder.children = folder.children.filter((c) => c !== file);
			},
		},
	} as any;
	return { app, trashed };
}

beforeEach(() => {
	noticeMessages().length = 0;
});

describe('removeDemoBoard', () => {
	test('trashes all flagged notes, the .base, then the empty folder', async () => {
		const md = demoFile('01 歡迎 Welcome.md', 'md');
		const base = demoFile('範例看板 Demo.base', 'base');
		const { app, trashed } = makeRemovalApp([md, base], { [md.path]: DEMO_MD });

		await removeDemoBoard(app);

		assert.deepStrictEqual(trashed, [md.path, base.path, DEMO_FOLDER]);
		assert.ok(
			noticeMessages().some((n) => n === 'Demo board removed. The files went to your trash.'),
			'should confirm full removal',
		);
	});

	test('keeps user files and the folder, removing only flagged files', async () => {
		const md = demoFile('01 歡迎 Welcome.md', 'md');
		const base = demoFile('範例看板 Demo.base', 'base');
		const mine = demoFile('我的筆記.md', 'md');
		const subfolder = Object.assign(new TFolder(), { path: `${DEMO_FOLDER}/sub`, name: 'sub' });
		const { app, trashed } = makeRemovalApp([md, base, mine, subfolder as unknown as TFile], {
			[md.path]: DEMO_MD,
			[mine.path]: USER_MD,
		});

		await removeDemoBoard(app);

		assert.deepStrictEqual(trashed, [md.path, base.path], 'user note and subfolder survive, folder is kept');
		assert.ok(
			noticeMessages().some((n) => typeof n === 'string' && n.includes('folder was kept')),
			'should explain why the folder was kept',
		);
	});

	test('missing demo folder: notices and does not throw', async () => {
		const app = { vault: { getFolderByPath: (): null => null } } as any;

		await removeDemoBoard(app);

		assert.ok(
			noticeMessages().some((n) => n === 'No demo board found: nothing to remove.'),
			'should notice that there is nothing to remove',
		);
	});

	test('trashFile failure surfaces the remove-failed notice instead of throwing', async () => {
		const md = demoFile('01 歡迎 Welcome.md', 'md');
		const { app } = makeRemovalApp([md], { [md.path]: DEMO_MD });
		app.fileManager.trashFile = async () => {
			throw new Error('disk on fire');
		};

		await removeDemoBoard(app);

		assert.ok(
			noticeMessages().some((n) => n === 'Could not remove the demo board.'),
			'should notice the failure',
		);
	});
});

describe('createDemoBoard', () => {
	test('creates the tutorial notes plus a two-view base (kanban + masonry flow)', async () => {
		const created: Record<string, string> = {};
		let openedPath: string | null = null;
		const app = {
			vault: {
				getAbstractFileByPath: (): null => null,
				createFolder: async () => {},
				create: async (path: string, content: string) => {
					created[path] = content;
					return Object.assign(new TFile(), { path, extension: 'base' });
				},
			},
			workspace: {
				getLeaf: () => ({
					openFile: async (file: TFile) => {
						openedPath = file.path;
					},
				}),
			},
		} as any;

		await createDemoBoard(app);

		const mdPaths = Object.keys(created).filter((p) => p.endsWith('.md'));
		assert.strictEqual(mdPaths.length, 7, 'seven tutorial cards');
		for (const path of mdPaths) {
			assert.match(created[path], /^hans_kanban_demo: true$/m, `${path} must carry the removal flag`);
			assert.match(created[path], /^stars: /m, `${path} must have a stars rating for the flow sort`);
		}

		const basePath = `${DEMO_FOLDER}/範例看板 Demo.base`;
		const base = created[basePath];
		assert.ok(base, 'demo .base created');
		assert.ok(base.includes('name: 範例看板 Demo'), 'kanban view present');
		assert.ok(base.includes('name: 瀑布 Flow'), 'masonry flow view present');
		assert.ok(base.includes('masonryMode: true'), 'flow view uses masonry mode');
		assert.ok(base.includes('masonrySortProperty: note.stars'), 'flow view sorts by stars');
		assert.strictEqual(openedPath, basePath, 'board opened after creation');
	});
});
