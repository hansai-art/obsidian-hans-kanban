import type { App } from 'obsidian';
import { Modal, TextComponent } from 'obsidian';
import { CSS_CLASSES } from './constants.ts';
import { t } from './i18n/index.ts';

export interface QuickAddModalOptions {
	columnValue: string;
	swimlaneValue: string | null;
	onSubmit: (title: string) => Promise<void> | void;
}

export class QuickAddModal extends Modal {
	private input: TextComponent | null = null;
	private submitting = false;

	constructor(
		app: App,
		private readonly options: QuickAddModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { columnValue, swimlaneValue } = this.options;
		this.setTitle(
			swimlaneValue
				? `${t('quickAdd.addCardTo')} ${swimlaneValue} / ${columnValue}`
				: `${t('quickAdd.addCardTo')} ${columnValue}`,
		);

		const formEl = this.contentEl.createEl('form', { cls: CSS_CLASSES.QUICK_ADD_FORM });
		this.input = new TextComponent(formEl);
		this.input.setPlaceholder(t('quickAdd.titlePlaceholder'));
		this.input.inputEl.classList.add(CSS_CLASSES.QUICK_ADD_INPUT);

		const actionsEl = formEl.createDiv({ cls: CSS_CLASSES.QUICK_ADD_ACTIONS });
		const cancelBtn = actionsEl.createEl('button', {
			text: t('quickAdd.cancel'),
			attr: { type: 'button' },
		});
		const submitBtn = actionsEl.createEl('button', {
			text: t('quickAdd.add'),
			cls: 'mod-cta',
			attr: { type: 'submit' },
		});

		cancelBtn.addEventListener('click', () => this.close());
		formEl.addEventListener('submit', (evt) => {
			evt.preventDefault();
			void this.submit(submitBtn);
		});

		window.requestAnimationFrame(() => this.input?.inputEl.focus());
	}

	onClose(): void {
		this.contentEl.empty();
		this.input = null;
		this.submitting = false;
	}

	private async submit(submitBtn: HTMLButtonElement): Promise<void> {
		if (this.submitting) return;

		const title = this.input?.getValue().trim() ?? '';
		if (!title) {
			this.input?.inputEl.focus();
			return;
		}

		this.submitting = true;
		submitBtn.disabled = true;
		try {
			await this.options.onSubmit(title);
			this.close();
		} catch (error) {
			this.submitting = false;
			submitBtn.disabled = false;
			throw error;
		}
	}
}
