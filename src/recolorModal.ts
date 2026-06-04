import type { App } from 'obsidian';
import { Modal, Notice } from 'obsidian';
import { COLOR_PALETTE, EMOJI_CHOICES, EMOJI_COLOR_MAP } from './constants.ts';
import { t } from './i18n/index.ts';
import {
	applyDeleteOption,
	applyRecolor,
	applyRename,
	countValueUsage,
	getRegisteredColorOptions,
	stripLeadingColorEmoji,
} from './kanbanView.ts';

/**
 * Management panel behind the "manage status options" command: every
 * registered status value gets a row with its color swatch, usage count and
 * three actions — rename (inline text input), recolor (emoji grid) and delete
 * (unused values only). Fully plugin-owned UI, so it works without a board
 * open and regardless of which property editor the user normally goes
 * through. All mutations go through the applyValueRewrite family, which
 * rewrites notes, .base configs, the option cache and Metadata Menu together.
 */
export class RecolorModal extends Modal {
	private propertyName = '';
	private value = '';

	onOpen(): void {
		this.containerEl.addClass('obk-recolor-modal');
		this.renderListStep();
	}

	private renderListStep(): void {
		this.setTitle(t('recolor.pickValue'));
		this.contentEl.empty();
		const options = getRegisteredColorOptions();
		let total = 0;
		for (const [propertyName, values] of options) {
			const usage = countValueUsage(this.app, propertyName);
			for (const value of values) {
				total++;
				this.renderRow(propertyName, value, usage, options.size > 1);
			}
		}
		if (total === 0) {
			this.contentEl.createDiv({ cls: 'obk-recolor-empty', text: t('recolor.empty') });
		}
	}

	private renderRow(propertyName: string, value: string, usage: Map<string, number>, showProperty: boolean): void {
		const row = this.contentEl.createDiv({ cls: 'obk-recolor-row' });
		const lead = [...value][0] ?? '';
		const colorName = EMOJI_COLOR_MAP[lead];
		const swatch = row.createSpan({ cls: 'obk-recolor-swatch' });
		const paletteEntry = COLOR_PALETTE.find((c) => c.name === colorName);
		if (paletteEntry) swatch.style.background = paletteEntry.cssVar;
		row.createSpan({ cls: 'obk-recolor-label', text: value });
		if (showProperty) row.createSpan({ cls: 'obk-recolor-prop', text: propertyName });

		const count = usage.get(stripLeadingColorEmoji(value.trim())) ?? 0;
		row.createSpan({
			cls: count === 0 ? 'obk-recolor-count obk-recolor-count-zero' : 'obk-recolor-count',
			text: count === 0 ? t('recolor.unused') : `${count} ${t('recolor.inUse')}`,
		});

		const actions = row.createSpan({ cls: 'obk-recolor-actions' });
		const renameBtn = actions.createEl('button', { cls: 'obk-recolor-btn', text: '✏️' });
		renameBtn.title = t('recolor.rename');
		renameBtn.addEventListener('click', () => {
			this.renderRenameStep(propertyName, value);
		});
		const recolorBtn = actions.createEl('button', { cls: 'obk-recolor-btn', text: '🎨' });
		recolorBtn.title = t('recolor.recolor');
		recolorBtn.addEventListener('click', () => {
			this.propertyName = propertyName;
			this.value = value;
			this.renderEmojiStep();
		});
		const deleteBtn = actions.createEl('button', { cls: 'obk-recolor-btn', text: '🗑️' });
		deleteBtn.title = t('recolor.delete');
		deleteBtn.addEventListener('click', () => {
			void this.deleteOption(propertyName, value, count);
		});
	}

	private renderRenameStep(propertyName: string, value: string): void {
		this.setTitle(`${t('recolor.rename')}: ${stripLeadingColorEmoji(value)}`);
		this.contentEl.empty();
		const form = this.contentEl.createDiv({ cls: 'obk-recolor-rename' });
		const input = form.createEl('input', { cls: 'obk-recolor-input', type: 'text' });
		input.placeholder = t('recolor.renamePlaceholder');
		input.value = stripLeadingColorEmoji(value.trim());
		const confirm = form.createEl('button', { cls: 'obk-recolor-btn', text: t('recolor.confirm') });
		const cancel = form.createEl('button', { cls: 'obk-recolor-btn', text: t('recolor.cancel') });
		const submit = (): void => {
			const newBare = input.value.trim();
			if (!newBare || newBare === stripLeadingColorEmoji(value.trim())) {
				this.renderListStep();
				return;
			}
			void applyRename(this.app, propertyName, value, newBare).then((count) => {
				const lead = [...value.trim()][0] ?? '';
				const emoji = EMOJI_COLOR_MAP[lead] ? `${lead} ` : '';
				new Notice(`${count} ${t('recolor.done')} ${emoji}${newBare}`);
				this.renderListStep();
			});
		};
		confirm.addEventListener('click', submit);
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') submit();
		});
		cancel.addEventListener('click', () => {
			this.renderListStep();
		});
		input.focus();
		input.select();
	}

	private renderEmojiStep(): void {
		this.setTitle(`${t('recolor.pickEmoji')} ${stripLeadingColorEmoji(this.value)}`);
		this.contentEl.empty();
		const grid = this.contentEl.createDiv({ cls: 'obk-recolor-grid' });
		for (const choice of EMOJI_CHOICES) {
			const cell = grid.createDiv({ cls: 'obk-recolor-cell', text: choice.emoji });
			cell.title = choice.color;
			cell.addEventListener('click', () => {
				void this.applyEmoji(choice.emoji);
			});
		}
		const back = this.contentEl.createEl('button', { cls: 'obk-recolor-btn', text: t('recolor.back') });
		back.addEventListener('click', () => {
			this.renderListStep();
		});
	}

	private async applyEmoji(emoji: string): Promise<void> {
		const count = await applyRecolor(this.app, this.propertyName, this.value, emoji);
		const bare = stripLeadingColorEmoji(this.value);
		new Notice(`${count} ${t('recolor.done')} ${emoji} ${bare}`);
		this.renderListStep();
	}

	private async deleteOption(propertyName: string, value: string, count: number): Promise<void> {
		if (count > 0) {
			new Notice(t('recolor.deleteBlocked'));
			return;
		}
		await applyDeleteOption(this.app, propertyName, value);
		new Notice(`${t('recolor.deleted')} ${value}`);
		this.renderListStep();
	}
}

export function openRecolorModal(app: App): void {
	new RecolorModal(app).open();
}
