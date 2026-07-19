// Obsidian attaches its DOM helpers to every window it owns, including pop-out
// windows, but only declares them as ambient globals plus `Node.createEl`. The
// per-window form is what `obsidianmd/prefer-create-el` asks plugins to use
// (`doc.win.createDiv()`), so declare it here until the published typings do.
//
// Unlike the `Node` versions, these create a DETACHED element in that window's
// document; the caller decides where it goes.
import 'obsidian';

declare global {
	interface Window {
		createEl<K extends keyof HTMLElementTagNameMap>(
			tag: K,
			o?: DomElementInfo | string,
			callback?: (el: HTMLElementTagNameMap[K]) => void,
		): HTMLElementTagNameMap[K];
		createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
		createSpan(o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
	}
}
