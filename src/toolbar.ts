import { setIcon } from 'obsidian';
import { CSS_CLASSES } from './constants.ts';

/** One toggle button rendered inside the shared toolbar group. */
export interface ToolbarToggleSpec {
	/** Stable obk- class on the button root (theming + stray cleanup). */
	cssClass: string;
	/** Class on the icon span (so refresh() can swap the icon in place). */
	iconClass: string;
	/** Class applied to the button while the toggle is active. */
	activeClass: string;
	label: () => string;
	text: () => string;
	icon: (active: boolean) => string;
	isActive: () => boolean;
	onToggle: () => void;
}

/**
 * Injects the view's toggle buttons (minimal / masonry) into Obsidian's native
 * Bases toolbar as ONE group element, so all buttons are placed, re-injected
 * and torn down together.
 *
 * Obsidian owns and periodically rebuilds .bases-toolbar (tab switch, view
 * reload, config changes); a rebuild silently drops injected children. One
 * MutationObserver on the toolbar's header re-injects the group the moment
 * that happens, and one retry loop covers the startup window where the
 * toolbar does not exist yet. If the toolbar can never be found (API/DOM
 * change), the group falls back to floating in the board's top-right corner.
 *
 * Each button mirrors the native toolbar-button DOM — a .text-icon-button
 * inside a .bases-toolbar-item — so it reads as part of the native row.
 */
export class ToolbarToggleGroup {
	private groupEl: HTMLElement | null = null;
	private buttons = new Map<ToolbarToggleSpec, HTMLElement>();
	private observer: MutationObserver | null = null;
	private retryScheduled = false;
	private destroyed = false;

	constructor(
		private containerEl: HTMLElement,
		private specs: ToolbarToggleSpec[],
	) {}

	/** The native Bases toolbar container, scoped to this view's leaf. */
	private findToolbar(): HTMLElement | null {
		const scope = this.containerEl.closest('.workspace-leaf') ?? this.containerEl.closest('.workspace-leaf-content');
		return scope?.querySelector<HTMLElement>('.bases-toolbar') ?? null;
	}

	/** Place (or re-place) the group and sync button states. Idempotent. */
	ensure(): void {
		if (this.destroyed) return;
		const toolbar = this.findToolbar();
		const home = toolbar ?? this.containerEl;
		const scope =
			this.containerEl.closest('.workspace-leaf') ?? this.containerEl.closest('.workspace-leaf-content') ?? home;

		// Remove strays from earlier renders (e.g. a floating fallback that
		// became obsolete once the native toolbar appeared).
		scope.querySelectorAll(`.${CSS_CLASSES.TOOLBAR_TOGGLES}`).forEach((el) => {
			if (el !== this.groupEl) el.remove();
		});

		const placed = this.groupEl?.isConnected ?? false;
		const inToolbar = !!(toolbar && this.groupEl && toolbar.contains(this.groupEl));
		if (!placed || (toolbar && !inToolbar)) {
			this.groupEl?.remove();
			this.groupEl = this.build(toolbar);
		}
		this.refresh();
		this.watch();
		if (!toolbar) this.scheduleRetry();
	}

	/** Sync every button's active class, icon and aria-pressed to its state. */
	refresh(): void {
		for (const [spec, btn] of this.buttons) {
			const active = spec.isActive();
			btn.classList.toggle(spec.activeClass, active);
			const iconEl = btn.querySelector<HTMLElement>(`.${spec.iconClass}`);
			if (iconEl) setIcon(iconEl, spec.icon(active));
			btn.setAttribute('aria-pressed', String(active));
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.observer?.disconnect();
		this.observer = null;
		this.groupEl?.remove();
		this.groupEl = null;
		this.buttons.clear();
	}

	private build(toolbar: HTMLElement | null): HTMLElement {
		const inToolbar = toolbar !== null;
		const parent = toolbar ?? this.containerEl;
		const cls = inToolbar
			? `bases-toolbar-item ${CSS_CLASSES.TOOLBAR_TOGGLES}`
			: `${CSS_CLASSES.TOOLBAR_TOGGLES} ${CSS_CLASSES.TOOLBAR_TOGGLES_FLOATING}`;
		const groupEl = parent.createDiv({ cls });
		this.buttons.clear();
		for (const spec of this.specs) {
			const btn = groupEl.createDiv({
				cls: `text-icon-button ${spec.cssClass}`,
				attr: { tabindex: 0, role: 'button' },
			});
			btn.setAttribute('aria-label', spec.label());
			const iconEl = btn.createSpan({ cls: spec.iconClass });
			setIcon(iconEl, spec.icon(spec.isActive()));
			btn.createSpan({ text: spec.text() });
			const toggle = () => {
				spec.onToggle();
				this.refresh();
			};
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				toggle();
			});
			btn.addEventListener('keydown', (e) => {
				if (e.key !== 'Enter' && e.key !== ' ') return;
				e.preventDefault();
				toggle();
			});
			this.buttons.set(spec, btn);
		}
		return groupEl;
	}

	/** Re-inject when Obsidian rebuilds the toolbar out from under us. */
	private watch(): void {
		if (this.observer) return;
		const header =
			this.findToolbar()?.parentElement ??
			this.containerEl.closest('.workspace-leaf-content')?.querySelector('.bases-header');
		if (!header) return;
		this.observer = new MutationObserver(() => {
			const toolbar = this.findToolbar();
			// The contains() check also stops our own insert (which mutates the
			// header) from triggering an infinite loop.
			if (toolbar && (!this.groupEl || !toolbar.contains(this.groupEl))) this.ensure();
		});
		this.observer.observe(header, { childList: true, subtree: true });
	}

	/** Startup window: the toolbar may not exist yet when the view renders. */
	private scheduleRetry(): void {
		if (this.retryScheduled) return;
		this.retryScheduled = true;
		let tries = 0;
		const retry = () => {
			if (this.destroyed) {
				this.retryScheduled = false;
				return;
			}
			if (this.findToolbar()) {
				this.retryScheduled = false;
				this.ensure();
			} else if (++tries < 12) {
				window.setTimeout(retry, 150);
			} else {
				this.retryScheduled = false;
			}
		};
		window.setTimeout(retry, 150);
	}
}
