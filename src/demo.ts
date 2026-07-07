import { type App, Modal, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { t } from './i18n/index.ts';

/**
 * One-click demo board. Creates a small, self-contained folder of bilingual
 * sample notes plus a pre-configured .base so a brand-new user sees a colored,
 * draggable kanban with on-card status switching the moment they open it. The
 * board doubles as an interactive tutorial: each card explains one feature.
 *
 * Everything lives under a single folder and is matched by a private
 * `hans_kanban_demo` frontmatter flag, so it never mixes with the user's notes
 * and is trivial to delete.
 */

const DEMO_FOLDER = 'Hans Kanban 範例';
const DEMO_BASE = `${DEMO_FOLDER}/範例看板 Demo.base`;

// Two axes, like a real board: columns come from `area` (each gets its own
// backplate color via columnColors), while `status` colors each card and is the
// on-card switcher. The leading color emoji on a status maps to its card color
// automatically. These strings must match cardColorOrder / columnColors below.
const TODO = '🔴 待辦 To Do';
const DOING = '🟡 進行中 In Progress';
const DONE = '🟢 完成 Done';

const PLAN = '規劃 Plan';
const BUILD = '製作 Build';
const LAUNCH = '上線 Launch';

interface DemoNote {
	file: string;
	area: string;
	status: string;
	/** ⭐ rating; the 瀑布 Flow view sorts by it so the sort is visible. */
	stars: string;
	outline: string[];
	body: string;
}

const DEMO_NOTES: DemoNote[] = [
	{
		file: '01 歡迎 Welcome.md',
		area: PLAN,
		status: TODO,
		stars: '⭐⭐⭐',
		outline: [
			'Columns are colored by category',
			'Drag a card between columns',
			'Switch views (top left): 範例看板 Demo ↔ 瀑布 Flow',
		],
		body: '這是一塊範例看板。This is a sample board: drag the cards around and watch what happens.',
	},
	{
		file: '02 一張卡片 A card.md',
		area: PLAN,
		status: DOING,
		stars: '⭐',
		outline: ['A card is just a note', 'Click a card to open the note'],
		body: '每張卡片背後都是一則普通的 Markdown 筆記。Each card is an ordinary note.',
	},
	{
		file: '03 切換狀態 Switch status.md',
		area: BUILD,
		status: DOING,
		stars: '⭐⭐⭐',
		outline: ['Use the dropdown on the card to switch status', 'The card recolors instantly'],
		body: '看到卡片上的下拉選單了嗎?點它就能換狀態。Use the dropdown on this card to switch status.',
	},
	{
		file: '04 依狀態上色 Color by status.md',
		area: BUILD,
		status: DOING,
		stars: '⭐⭐',
		outline: ['Card color follows the status value', '🔴 To Do, 🟡 In Progress, 🟢 Done'],
		body: '卡片顏色跟著「狀態」走。A card is colored by its status value.',
	},
	{
		file: '05 欄寬與極簡 Width & minimal.md',
		area: LAUNCH,
		status: DONE,
		stars: '⭐',
		outline: ['Drag a column edge to resize it', 'The Minimal toggle hides labels'],
		body: '試試拖欄位右邊界,或按工具列上的「極簡」。Try resizing a column or the Minimal toggle.',
	},
	{
		file: '06 用自己的筆記 Your own notes.md',
		area: LAUNCH,
		status: DONE,
		stars: '⭐⭐',
		outline: ['Add a category and a status to your notes', 'Group by your category, color by status'],
		body: '準備好了嗎?換成你自己的筆記吧。Ready? Point it at your own notes next.',
	},
	{
		file: '07 看完就刪 Delete this demo.md',
		area: LAUNCH,
		status: DONE,
		stars: '⭐⭐⭐',
		outline: ['Command palette → "Remove demo board"', 'Your own notes are never touched'],
		body:
			'看完了嗎?打開指令面板,執行「移除範例看板」就能一鍵清掉整個範例。Done exploring? Run "Remove demo board" from the command palette to clean this whole demo up.',
	},
];

/** Build a note with frontmatter (demo flag + area + status + stars + outline) and a body. */
function noteContent(note: DemoNote): string {
	const outline = note.outline.map((line) => `  - ${JSON.stringify(line)}`).join('\n');
	return `---
hans_kanban_demo: true
area: ${JSON.stringify(note.area)}
status: ${JSON.stringify(note.status)}
stars: ${JSON.stringify(note.stars)}
outline:
${outline}
---

# ${note.file.replace(/\.md$/, '')}

${note.body}
`;
}

// Pre-wired board mirroring a real setup: columns grouped by `area`, each with
// its own backplate color (columnColors); cards colored by `status` with the
// on-card switcher; labels hidden (minimal mode); outline wrapped. A second
// masonry view over the same notes teaches the view switcher (top left) and
// shows the color-order + star sorting: switching views is config, not data.
const BASE_CONTENT = `filters:
  and:
    - note.hans_kanban_demo == true
properties:
  note.area:
    displayName: 分類 Area
  note.status:
    displayName: 狀態 Status
  note.stars:
    displayName: 重要度 Stars
  note.outline:
    displayName: 重點 Key points
views:
  - type: hans-kanban-view
    name: 範例看板 Demo
    order:
      - status
      - outline
    groupByProperty: note.area
    cardColorProperty: note.status
    cardColorOrder:
      - ${TODO}
      - ${DOING}
      - ${DONE}
    wrapPropertyValues: true
    minimalMode: true
    columnOrders:
      note.area:
        - ${PLAN}
        - ${BUILD}
        - ${LAUNCH}
    columnColors:
      note.area:
        ${PLAN}: red
        ${BUILD}: orange
        ${LAUNCH}: blue
  - type: hans-kanban-view
    name: 瀑布 Flow
    order:
      - stars
      - outline
    groupByProperty: note.area
    cardColorProperty: note.status
    cardColorOrder:
      - ${TODO}
      - ${DOING}
      - ${DONE}
    wrapPropertyValues: true
    minimalMode: true
    masonryMode: true
    masonryColumns: 3
    masonrySortProperty: note.stars
`;

/**
 * Create the demo folder, notes, and base, then open the board. If the board
 * already exists, just open it instead of duplicating anything.
 */
export async function createDemoBoard(app: App): Promise<void> {
	const basePath = normalizePath(DEMO_BASE);
	try {
		const existing = app.vault.getAbstractFileByPath(basePath);
		if (existing instanceof TFile) {
			await app.workspace.getLeaf(true).openFile(existing);
			new Notice(t('demo.exists'));
			return;
		}

		const folderPath = normalizePath(DEMO_FOLDER);
		if (!app.vault.getAbstractFileByPath(folderPath)) {
			await app.vault.createFolder(folderPath);
		}

		for (const note of DEMO_NOTES) {
			const path = normalizePath(`${DEMO_FOLDER}/${note.file}`);
			if (!app.vault.getAbstractFileByPath(path)) {
				await app.vault.create(path, noteContent(note));
			}
		}

		const baseFile = await app.vault.create(basePath, BASE_CONTENT);
		await app.workspace.getLeaf(true).openFile(baseFile);
		new Notice(t('demo.created'));
	} catch (error) {
		console.error('[hans-kanban] demo board creation failed', error);
		new Notice(t('demo.failed'));
	}
}

/** Demo notes carry this frontmatter line verbatim (see noteContent). */
const DEMO_FLAG_LINE = /^hans_kanban_demo: true$/m;

/**
 * One-click cleanup, the counterpart of createDemoBoard. Trashes (respecting
 * the user's "deleted files" setting) every flagged demo note and every .base
 * inside the demo folder, then the folder itself — but only if it is empty by
 * then. Anything the user added to the folder (no demo flag, subfolders) is
 * kept, and the Notice says so.
 */
export async function removeDemoBoard(app: App): Promise<void> {
	const folder = app.vault.getFolderByPath(normalizePath(DEMO_FOLDER));
	if (!(folder instanceof TFolder)) {
		new Notice(t('demo.removeMissing'));
		return;
	}
	try {
		let kept = 0;
		// Copy: trashing a child mutates folder.children under the loop.
		for (const child of [...folder.children]) {
			if (!(child instanceof TFile)) {
				kept++;
				continue;
			}
			const isDemo =
				child.extension === 'base' || (child.extension === 'md' && DEMO_FLAG_LINE.test(await app.vault.read(child)));
			if (isDemo) {
				await app.fileManager.trashFile(child);
			} else {
				kept++;
			}
		}
		if (kept === 0) {
			await app.fileManager.trashFile(folder);
			new Notice(t('demo.removed'));
		} else {
			new Notice(t('demo.removedPartial'));
		}
	} catch (error) {
		console.error('[hans-kanban] demo board removal failed', error);
		new Notice(t('demo.removeFailed'));
	}
}

/**
 * First-run welcome shown once after install. Offers to create the demo board;
 * declining is fine and the command stays available either way.
 */
export class DemoPromptModal extends Modal {
	private readonly onCreate: () => void;

	constructor(app: App, onCreate: () => void) {
		super(app);
		this.onCreate = onCreate;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: t('demo.promptTitle') });
		contentEl.createEl('p', { text: t('demo.promptBody') });

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		const skip = buttons.createEl('button', { text: t('demo.skip') });
		skip.addEventListener('click', () => this.close());
		const create = buttons.createEl('button', { text: t('demo.create'), cls: 'mod-cta' });
		create.addEventListener('click', () => {
			this.close();
			this.onCreate();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
