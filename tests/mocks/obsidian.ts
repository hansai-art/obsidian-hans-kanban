// Mock obsidian module for testing
// This provides the minimal interface needed for tests

export type BasesPropertyId = string;
export type BasesAllOptions = any;

// Real classes: TAbstractFile → TFile / TFolder. Classes (not interfaces) so
// production `instanceof TFile` checks work under test; object literals cast
// `as TFile` remain valid structurally. Fields are assigned via Object.assign
// in helpers, so they are declared with defaults here.
export class TAbstractFile {
	path = '';
	name = '';
	vault: any = null;
	parent: any = null;
}

export class TFile extends TAbstractFile {
	basename = '';
	extension = '';
	stat: {
		size: number;
		ctime: number;
		mtime: number;
	} = { size: 0, ctime: 0, mtime: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return false;
	}
}

export interface BasesEntry {
	file: TFile;
	getValue(propertyId: BasesPropertyId): any;
	getProperty(propertyId: BasesPropertyId): any;
}

export interface QueryController {
	data: {
		data: BasesEntry[];
	};
	allProperties: BasesPropertyId[];
	config: {
		getAsPropertyId(key: string): BasesPropertyId | null;
		getOrder(): BasesPropertyId[];
		getSort?(): unknown;
		getDisplayName(propertyId: BasesPropertyId): string;
		get?(key: string): unknown;
		set?(key: string, value: unknown): void;
	};
	app?: App;
}

export interface App {
	workspace: {
		openLinkText(path: string, source: string, newLeaf: boolean, openViewState?: { active?: boolean }): void;
		getLeaf(newLeaf?: 'tab' | 'split' | 'window' | boolean): {
			openFile(file: TFile, openViewState?: { active?: boolean }): Promise<void>;
		};
		getMostRecentLeaf(): unknown;
		setActiveLeaf(leaf: unknown, params?: { focus?: boolean }): void;
		trigger(name: string, ...data: unknown[]): void;
		getActiveFile(): TFile | null;
	};
	fileManager: {
		processFrontMatter(file: TFile, fn: (frontmatter: any) => void | Promise<void>): Promise<void>;
		renameFile(file: TFile, newPath: string): Promise<void>;
		trashFile?(file: TAbstractFile): Promise<void>;
	};
	vault: {
		getMarkdownFiles(): TFile[];
		getFolderByPath(path: string): TFolder | { path: string; name: string } | null;
		getRoot?(): TFolder;
		getAbstractFileByPath(path: string): TFile | null;
		getResourcePath(file: { path: string }): string;
		read?(file: TFile): Promise<string>;
		on?(name: string, callback: (...args: any[]) => void): unknown;
		offref?(ref: unknown): void;
		/** Test-only escape hatch for firing vault events. */
		emit?(name: string, ...args: any[]): void;
	};
	renderContext: RenderContext;
}

// Real class: RenderContext implements HoverParent. Plugins don't construct it;
// they consume the singleton at App.renderContext. The mock is just an opaque
// token threaded through Value.renderTo() for parity with the production API.
export class RenderContext {
	hoverPopover: unknown = null;
}

export abstract class BasesView {
	app?: App;
	data?: {
		data: BasesEntry[];
	};
	allProperties?: BasesPropertyId[];
	config?: {
		getAsPropertyId(key: string): BasesPropertyId | null;
		getOrder(): BasesPropertyId[];
		getSort?(): unknown;
		getDisplayName(propertyId: BasesPropertyId): string;
		get?(key: string): unknown;
		set?(key: string, value: unknown): void;
	};
	createFileForViewCalls: Array<{ baseFileName: string; frontmatter: Record<string, unknown> }> = [];

	constructor(controller: QueryController) {
		this.app = controller.app;
		this.data = controller.data;
		this.allProperties = controller.allProperties;
		this.config = controller.config;
	}

	abstract onDataUpdated(): void;
	onClose?(): void;

	async createFileForView(
		baseFileName: string,
		frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
	): Promise<void> {
		const frontmatter: Record<string, unknown> = {};
		frontmatterProcessor?.(frontmatter);
		this.createFileForViewCalls.push({ baseFileName, frontmatter });
	}
}

export class Plugin {
	app: App;
	manifest: any;

	constructor(app: App, manifest: any) {
		this.app = app;
		this.manifest = manifest;
	}

	async onload(): Promise<void> {}
	onunload(): void {}

	addCommand(command: any): any {
		return command;
	}

	async loadData(): Promise<unknown> {
		return null;
	}

	async saveData(_data: unknown): Promise<void> {
		// Mock implementation
	}

	registerBasesView?(viewType: string, options: any): void {
		// Mock implementation
	}

	registerHoverLinkSource?(id: string, info: any): void {
		// Mock implementation
	}

	addSettingTab(_tab: unknown): void {
		// Mock implementation
	}
}

/** Declarative settings definitions (Obsidian 1.13+). Shape-checked in tests. */
export type SettingDefinitionItem = any;

export class PluginSettingTab {
	app: App;
	containerEl: HTMLElement;

	constructor(app: App, _plugin: unknown) {
		this.app = app;
		this.containerEl = document.createElement('div');
	}

	display(): void {}
	hide(): void {}
}

export class Setting {
	settingEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.settingEl = document.createElement('div');
		containerEl.appendChild(this.settingEl);
	}

	setName(_name: string): this {
		return this;
	}

	setDesc(_desc: string): this {
		return this;
	}

	addText(cb: (text: TextComponent) => unknown): this {
		cb(new TextComponent(this.settingEl));
		return this;
	}
}

export function setIcon(parent: HTMLElement, iconId: string): void {
	while (parent.firstChild) parent.removeChild(parent.firstChild);
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('data-icon', iconId);
	parent.appendChild(svg);
}

// Value type hierarchy mocks
//
// Source: https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
// All classes @since 1.10.0. Check that file for drift when upgrading obsidian devDependency.
//
// Hierarchy reproduced here:
//   Value
//     NotNullValue
//       PrimitiveValue<T>
//         StringValue  → HTMLValue, LinkValue, TagValue, UrlValue, IconValue, ImageValue
//         NumberValue
//         BooleanValue
//       ListValue
//     NullValue

export abstract class Value {
	abstract toString(): string;
	abstract isTruthy(): boolean;
	equals(_other: this): boolean {
		return false;
	}
	looseEquals(_other: Value): boolean {
		return false;
	}
	// Real signature: renderTo(el: HTMLElement, ctx: RenderContext): void
	// Default mock implementation falls back to text; subclasses override.
	renderTo(el: HTMLElement, _ctx: RenderContext): void {
		el.appendChild(document.createTextNode(this.toString()));
	}
}

export abstract class NotNullValue extends Value {}

export class NullValue extends Value {
	toString() {
		return '';
	}
	isTruthy() {
		return false;
	}
}

export abstract class PrimitiveValue<T> extends NotNullValue {
	constructor(protected value: T) {
		super();
	}
	toString() {
		return String(this.value);
	}
	isTruthy() {
		return !!this.value;
	}
}

// Real class: StringValue extends PrimitiveValue<string>.
// renderTo() mirrors what Obsidian's built-in renderer does for plain string
// properties: bracketed wikilinks become internal-link anchors, everything else
// renders as text. This keeps the wikilink-in-frontmatter behavior the kanban
// has always had once we route all Value subclasses through renderTo.
export class StringValue extends PrimitiveValue<string> {
	renderTo(el: HTMLElement, _ctx: RenderContext): void {
		const raw = this.value;
		const wikiMatch = raw.match(/^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/);
		if (wikiMatch) {
			const target = wikiMatch[1];
			const a = document.createElement('a');
			a.className = 'internal-link';
			a.setAttribute('data-href', target);
			a.setAttribute('href', target);
			a.textContent = wikiMatch[2] ?? target;
			el.appendChild(a);
			return;
		}
		el.appendChild(document.createTextNode(raw));
	}
}

// Wraps an HTML string produced by the html("") formula function.
// Real class: HTMLValue extends StringValue — toString() returns the raw HTML string.
// renderTo() parses the HTML into DOM (in production, Obsidian sanitizes via
// DOMPurify; this mock uses innerHTML directly — safe since tests own all input).
export class HTMLValue extends StringValue {
	renderTo(el: HTMLElement, _ctx: RenderContext): void {
		const div = document.createElement('div');
		div.innerHTML = this.value;
		while (div.firstChild) el.appendChild(div.firstChild);
	}
}

// Wraps a wikilink string such as "[[Note Name]]".
// Real class: LinkValue extends StringValue — includes static parseFromString().
// The production class also carries the display text passed to link(url, display)
// but exposes no public accessor for it; renderTo() is the only way to surface it.
// The mock takes display as a second constructor arg so tests can assert the rendered
// label without reaching into private state.
export class LinkValue extends StringValue {
	private display: string | null;
	constructor(value: string, display: string | null = null) {
		super(value);
		this.display = display;
	}
	renderTo(el: HTMLElement, _ctx: RenderContext): void {
		const raw = this.value;
		const wikiMatch = raw.match(/^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/);
		const a = document.createElement('a');
		if (wikiMatch) {
			const target = wikiMatch[1];
			const aliasLabel = wikiMatch[2] ?? null;
			a.className = 'internal-link';
			a.setAttribute('data-href', target);
			a.setAttribute('href', target);
			a.textContent = this.display ?? aliasLabel ?? target;
		} else {
			a.setAttribute('href', raw);
			a.textContent = this.display ?? raw;
		}
		el.appendChild(a);
	}
}

export class TagValue extends StringValue {}
export class UrlValue extends StringValue {}
export class IconValue extends StringValue {}
export class ImageValue extends StringValue {}

export class NumberValue extends PrimitiveValue<number> {}
export class BooleanValue extends PrimitiveValue<boolean> {}

// Real class: DateValue extends NotNullValue — toString() returns ISO string.
export class DateValue extends NotNullValue {
	constructor(private date: Date) {
		super();
	}
	toString() {
		return this.date.toISOString().split('T')[0];
	}
	isTruthy() {
		return true;
	}
}

// Real class: ListValue extends NotNullValue
// API surface used: length(), get(index) → Value, toString() → comma-separated string
export class ListValue extends NotNullValue {
	private items: Value[];
	constructor(items: Value[]) {
		super();
		this.items = items;
	}
	toString() {
		return this.items.map((i) => i.toString()).join(', ');
	}
	isTruthy() {
		return this.items.length > 0;
	}
	length() {
		return this.items.length;
	}
	get(index: number): Value {
		return this.items[index] ?? new NullValue();
	}
}

export class Keymap {
	static isModEvent(evt?: { ctrlKey?: boolean; metaKey?: boolean } | null): boolean {
		return !!(evt?.ctrlKey || evt?.metaKey);
	}
}

export class Modal {
	app: App;
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	scope = {};

	constructor(app: App) {
		this.app = app;
		this.containerEl = document.createElement('div');
		this.containerEl.className = 'modal-container';
		this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
		this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
		this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
	}

	open(): void {
		document.body.appendChild(this.containerEl);
		void this.onOpen();
	}

	close(): void {
		this.onClose();
		this.containerEl.remove();
	}

	onOpen(): Promise<void> | void {}

	onClose(): void {}

	setTitle(title: string): this {
		this.titleEl.textContent = title;
		return this;
	}

	setContent(content: string | DocumentFragment): this {
		this.contentEl.empty();
		if (typeof content === 'string') {
			this.contentEl.textContent = content;
		} else {
			this.contentEl.appendChild(content);
		}
		return this;
	}
}

export class TextComponent {
	inputEl: HTMLInputElement;

	constructor(containerEl: HTMLElement) {
		this.inputEl = document.createElement('input');
		this.inputEl.type = 'text';
		containerEl.appendChild(this.inputEl);
	}

	getValue(): string {
		return this.inputEl.value;
	}

	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}
}

export class Notice {
	static notices: Array<string | DocumentFragment> = [];

	constructor(
		public message: string | DocumentFragment,
		_duration?: number,
	) {
		Notice.notices.push(message);
	}

	setMessage(message: string | DocumentFragment): this {
		this.message = message;
		Notice.notices.push(message);
		return this;
	}

	hide(): void {}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function parsePropertyId(propertyId: BasesPropertyId): { name: string; type: string } {
	const parts = propertyId.split('.');
	if (parts.length > 1) {
		return {
			name: parts.slice(1).join('.'),
			type: parts[0],
		};
	}
	return {
		name: propertyId,
		type: 'note',
	};
}

export class FuzzySuggestModal<T> {
	app: unknown;
	placeholder = '';
	opened = false;
	constructor(app: unknown) {
		this.app = app;
	}
	setPlaceholder(text: string): void {
		this.placeholder = text;
	}
	open(): void {
		this.opened = true;
	}
	close(): void {
		this.opened = false;
	}
}

export class Menu {
	items: { title: string; click: (() => void) | null }[] = [];
	shown = false;
	addItem(cb: (item: unknown) => unknown): this {
		const entry: { title: string; click: (() => void) | null } = { title: '', click: null };
		const item = {
			setTitle: (title: string) => {
				entry.title = title;
				return item;
			},
			onClick: (fn: () => void) => {
				entry.click = fn;
				return item;
			},
		};
		cb(item);
		this.items.push(entry);
		return this;
	}
	showAtMouseEvent(_e: unknown): this {
		this.shown = true;
		return this;
	}
}

// Test stand-in: production code uses Obsidian's real YAML parser; tests feed
// JSON (valid YAML subset) through vault.read, so JSON.parse is sufficient.
export function parseYaml(yaml: string): unknown {
	return JSON.parse(yaml);
}
