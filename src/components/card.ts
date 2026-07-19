import type { App, BasesEntry, BasesPropertyId } from 'obsidian';
import { Keymap, NullValue } from 'obsidian';
import type { TFile } from 'obsidian';
import { CSS_CLASSES, DATA_ATTRIBUTES } from '../constants.ts';
import { t } from '../i18n/index.ts';

export interface CardRenderCtx {
	app: App;
	doc: Document;
	groupByPropertyId: BasesPropertyId | null;
	cardTitlePropertyId: BasesPropertyId | null;
	imagePropertyId: BasesPropertyId | null;
	imageFit: string;
	imageAspectRatio: number;
	wrapValues: boolean;
	order: BasesPropertyId[];
	getDisplayName: (id: BasesPropertyId) => string;
	/** Property that drives the card accent color + inline status switcher. */
	cardColorPropertyId: BasesPropertyId | null;
	/** Distinct values of cardColorPropertyId across all entries (switcher options). */
	cardColorValues: string[];
	/** Resolve a status value to a CSS color (e.g. var(--color-red)), or null. */
	resolveColor: (value: string) => string | null;
}

export interface CardCallbacks {
	onHoverPreview: (linktext: string, sourcePath: string, event: MouseEvent, targetEl: HTMLElement) => void;
	onSetActiveCard: (path: string | null) => void;
	onOpenInBackgroundTab: (file: TFile) => void;
	/** Write a property value to the entry's frontmatter (inline status switch). */
	onSetCardProperty: (entry: BasesEntry, propertyId: BasesPropertyId, value: string) => void;
	/** Open the card-color picker for a card-color value, anchored at the dot. */
	onPickCardColor: (anchorEl: HTMLElement, value: string) => void;
}

export function computeCardFingerprint(entry: BasesEntry, ctx: CardRenderCtx): string {
	const parts: string[] = [];
	for (const propId of ctx.order) {
		if (propId === ctx.groupByPropertyId) continue;
		const val = entry.getValue(propId);
		parts.push(val === null ? '' : val.toString());
	}
	if (ctx.cardTitlePropertyId) {
		const val = entry.getValue(ctx.cardTitlePropertyId);
		parts.push(val === null ? '' : val.toString());
	}
	if (ctx.imagePropertyId) {
		const val = entry.getValue(ctx.imagePropertyId);
		parts.push(val === null ? '' : val.toString());
	}
	// Include the resolved accent color so a custom-color change repaints the card
	// on the next render (the value text alone may be unchanged).
	const colorRaw = cardColorValue(entry, ctx);
	parts.push(colorRaw ? (ctx.resolveColor(colorRaw) ?? '') : '');
	return parts.join('\x00');
}

export function renderCardTitle(titleEl: HTMLElement, entry: BasesEntry, ctx: CardRenderCtx): void {
	if (!ctx.cardTitlePropertyId) {
		titleEl.textContent = entry.file.basename;
		return;
	}
	const titleValue = entry.getValue(ctx.cardTitlePropertyId);
	if (!titleValue || titleValue instanceof NullValue) {
		titleEl.textContent = entry.file.basename;
		return;
	}
	titleValue.renderTo(titleEl, ctx.app.renderContext);
}

export function renderCardCover(
	coverEl: HTMLElement,
	entry: BasesEntry,
	filePath: string,
	ctx: CardRenderCtx,
): boolean {
	if (!ctx.imagePropertyId) return false;
	const value = entry.getValue(ctx.imagePropertyId);
	if (!value || value instanceof NullValue) return false;
	const raw = value.toString().trim();
	if (!raw) return false;

	if (/^https?:\/\//i.test(raw)) {
		coverEl.createEl('img', { attr: { src: raw, alt: '' } });
		return true;
	}

	let linkText = raw.replace(/^!\s*/, '');
	const wikiMatch = linkText.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
	if (wikiMatch) linkText = wikiMatch[1];
	linkText = linkText.trim();
	if (!linkText) return false;

	const app = ctx.app;
	if (!app) return false;
	const file = app.metadataCache.getFirstLinkpathDest(linkText, filePath);
	if (!file) return false;

	coverEl.createEl('img', {
		attr: { src: app.vault.getResourcePath(file), alt: '' },
	});
	return true;
}

function cardColorValue(entry: BasesEntry, ctx: CardRenderCtx): string | null {
	if (!ctx.cardColorPropertyId) return null;
	const value = entry.getValue(ctx.cardColorPropertyId);
	if (!value || value instanceof NullValue) return null;
	const raw = value.toString().trim();
	return raw || null;
}

function applyCardAccent(cardEl: HTMLElement, entry: BasesEntry, ctx: CardRenderCtx): void {
	const raw = cardColorValue(entry, ctx);
	if (!raw) return;
	const cssColor = ctx.resolveColor(raw);
	if (!cssColor) return;
	cardEl.classList.add(CSS_CLASSES.CARD_COLORED);
	cardEl.style.setProperty('--obk-card-accent', cssColor);
}

function renderStatusSelect(
	propertyEl: HTMLElement,
	entry: BasesEntry,
	propertyId: BasesPropertyId,
	ctx: CardRenderCtx,
	cb: CardCallbacks,
): void {
	const current = cardColorValue(entry, ctx) ?? '';

	// Clickable color dot: shows the current value's (auto or custom) color and
	// opens the card-color picker so any value can be recolored without emoji.
	if (current) {
		const dot = propertyEl.createDiv({ cls: CSS_CLASSES.CARD_COLOR_DOT });
		const cssColor = ctx.resolveColor(current);
		if (cssColor) dot.style.background = cssColor;
		else dot.classList.add(CSS_CLASSES.COLUMN_COLOR_NONE);
		dot.setAttribute('aria-label', t('label.pickColor'));
		dot.setAttribute('title', t('label.pickColor'));
		const stop = (e: Event) => e.stopPropagation();
		dot.addEventListener('mousedown', stop);
		dot.addEventListener('auxclick', stop);
		dot.addEventListener('click', (e) => {
			e.stopPropagation();
			cb.onPickCardColor(dot, current);
		});
	}

	const select = propertyEl.createEl('select', { cls: CSS_CLASSES.CARD_STATUS_SELECT });

	const values = ctx.cardColorValues.slice();
	if (current && !values.includes(current)) values.unshift(current);
	for (const value of values) {
		const opt = select.createEl('option', { text: value, value });
		if (value === current) opt.selected = true;
	}

	// Keep the select from opening the note or starting a Sortable drag.
	const swallow = (e: Event) => e.stopPropagation();
	select.addEventListener('click', swallow);
	select.addEventListener('mousedown', swallow);
	select.addEventListener('auxclick', swallow);
	select.addEventListener('change', () => {
		const next = select.value;
		if (next === current) return;
		cb.onSetCardProperty(entry, propertyId, next);
	});
}

export function createCard(entry: BasesEntry, ctx: CardRenderCtx, cb: CardCallbacks): HTMLElement {
	const cardEl = ctx.doc.win.createDiv();
	cardEl.className = CSS_CLASSES.CARD;
	const filePath = entry.file.path;
	cardEl.setAttribute(DATA_ATTRIBUTES.ENTRY_PATH, filePath);
	applyCardAccent(cardEl, entry, ctx);

	if (ctx.imagePropertyId) {
		const coverEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_COVER });
		coverEl.classList.add(
			ctx.imageFit === 'contain' ? CSS_CLASSES.CARD_COVER_FIT_CONTAIN : CSS_CLASSES.CARD_COVER_FIT_COVER,
		);
		coverEl.style.aspectRatio = `1 / ${ctx.imageAspectRatio}`;
		const rendered = renderCardCover(coverEl, entry, filePath, ctx);
		if (!rendered) coverEl.remove();
	}

	const titleEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_TITLE });
	renderCardTitle(titleEl, entry, ctx);

	for (const propertyId of ctx.order) {
		if (propertyId === ctx.groupByPropertyId) continue;

		// The card-color property renders as an inline status switcher, not text.
		if (ctx.cardColorPropertyId && propertyId === ctx.cardColorPropertyId) {
			const label = ctx.getDisplayName(propertyId);
			const statusEl = cardEl.createDiv({ cls: `${CSS_CLASSES.CARD_PROPERTY} ${CSS_CLASSES.CARD_STATUS}` });
			statusEl.setAttribute('data-label', propertyId);
			statusEl.createSpan({ text: label, cls: CSS_CLASSES.CARD_PROPERTY_LABEL });
			renderStatusSelect(statusEl, entry, propertyId, ctx, cb);
			continue;
		}

		const value = entry.getValue(propertyId);
		if (!value || value instanceof NullValue) continue;
		if (!value.toString().trim()) continue;
		const label = ctx.getDisplayName(propertyId);
		const propertyEl = cardEl.createDiv({ cls: CSS_CLASSES.CARD_PROPERTY });
		propertyEl.setAttribute('data-label', propertyId);
		if (ctx.wrapValues) {
			propertyEl.classList.add(CSS_CLASSES.CARD_PROPERTY_WRAP);
		}
		propertyEl.createSpan({ text: label, cls: CSS_CLASSES.CARD_PROPERTY_LABEL });
		const valueEl = propertyEl.createSpan({ cls: CSS_CLASSES.CARD_PROPERTY_VALUE });
		value.renderTo(valueEl, ctx.app.renderContext);
	}

	// JS-managed hover: mouseenter/mouseleave instead of CSS :hover so the
	// class is never applied when an element slides under a stationary cursor
	// after a drag reorders the DOM.
	cardEl.addEventListener('mouseenter', () => cardEl.classList.add(CSS_CLASSES.CARD_HOVER));
	cardEl.addEventListener('mouseleave', () => cardEl.classList.remove(CSS_CLASSES.CARD_HOVER));
	cardEl.addEventListener('mouseover', (e) => {
		if (e.target instanceof Element && e.target.closest('a')) return;
		if (e.relatedTarget instanceof Element && cardEl.contains(e.relatedTarget)) return;
		cb.onHoverPreview(filePath, '', e, cardEl);
	});

	const clickHandler = (e: MouseEvent) => {
		if (e.target instanceof Element && e.target.closest('a')) return;
		if (e.type === 'auxclick' && e.button !== 1) return;
		cb.onSetActiveCard(filePath);
		if (!ctx.app?.workspace) return;
		if (e.button === 1) {
			cb.onOpenInBackgroundTab(entry.file);
			return;
		}
		void ctx.app.workspace.openLinkText(filePath, '', Keymap.isModEvent(e));
	};
	cardEl.addEventListener('click', clickHandler);
	cardEl.addEventListener('auxclick', clickHandler);

	// Prevent middle-click autoscroll inside cards.
	cardEl.addEventListener('mousedown', (e) => {
		if (e.button !== 1) return;
		if (e.target instanceof Element && e.target.closest('a')) return;
		e.preventDefault();
	});

	return cardEl;
}
