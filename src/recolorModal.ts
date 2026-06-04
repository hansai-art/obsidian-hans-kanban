import type { App } from 'obsidian';
import { Modal, Notice } from 'obsidian';
import { COLOR_PALETTE, EMOJI_CHOICES, EMOJI_COLOR_MAP } from './constants.ts';
import { t } from './i18n/index.ts';
import { applyRecolor, getRegisteredColorOptions, stripLeadingColorEmoji } from './kanbanView.ts';

/**
 * Two-step picker behind the "change status color / icon" command:
 * step 1 lists every registered status value, step 2 offers the emoji grid
 * (grouped by palette color). Selecting a cell recolors the value everywhere
 * via applyRecolor. Fully plugin-owned UI, so it works without a board open
 * and regardless of which property editor the user normally goes through.
 */
export class RecolorModal extends Modal {
	private propertyName = '';
	private value = '';

	onOpen(): void {
		this.containerEl.addClass('obk-recolor-modal');
		this.renderValueStep();
	}

	private renderValueStep(): void {
		this.setTitle(t('recolor.pickValue'));
		this.contentEl.empty();
		const options = getRegisteredColorOptions();
		let total = 0;
		for (const [propertyName, values] of options) {
			for (const value of values) {
				total++;
				const row = this.contentEl.createDiv({ cls: 'obk-recolor-row' });
				const lead = [...value][0] ?? '';
				const colorName = EMOJI_COLOR_MAP[lead];
				const swatch = row.createSpan({ cls: 'obk-recolor-swatch' });
				const paletteEntry = COLOR_PALETTE.find((c) => c.name === colorName);
				if (paletteEntry) swatch.style.background = paletteEntry.cssVar;
				row.createSpan({ cls: 'obk-recolor-label', text: value });
				if (options.size > 1) row.createSpan({ cls: 'obk-recolor-prop', text: propertyName });
				row.addEventListener('click', () => {
					this.propertyName = propertyName;
					this.value = value;
					this.renderEmojiStep();
				});
			}
		}
		if (total === 0) {
			this.contentEl.createDiv({ cls: 'obk-recolor-empty', text: t('recolor.empty') });
		}
	}

	private renderEmojiStep(): void {
		this.setTitle(`${t('recolor.pickEmoji')} ${stripLeadingColorEmoji(this.value)}`);
		this.contentEl.empty();
		const grid = this.contentEl.createDiv({ cls: 'obk-recolor-grid' });
		for (const choice of EMOJI_CHOICES) {
			const cell = grid.createDiv({ cls: 'obk-recolor-cell', text: choice.emoji });
			cell.title = choice.color;
			cell.addEventListener('click', () => {
				void this.applyAndClose(choice.emoji);
			});
		}
	}

	private async applyAndClose(emoji: string): Promise<void> {
		const count = await applyRecolor(this.app, this.propertyName, this.value, emoji);
		const bare = stripLeadingColorEmoji(this.value);
		new Notice(`${count} ${t('recolor.done')} ${emoji} ${bare}`);
		this.close();
	}
}

export function openRecolorModal(app: App): void {
	new RecolorModal(app).open();
}
