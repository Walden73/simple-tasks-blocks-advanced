import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Modal, Notice, setIcon, Menu, moment } from 'obsidian';
import { t } from './l10n';

// --- Interfaces ---

interface Task {
	id: string;
	text: string;
	completed: boolean;
	dueDate?: string; // YYYY-MM-DD
	scratchpad?: string;
	recurrenceType?: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom_days';
	recurrenceValue?: number;
	recurrenceUntil?: string;
	recurrenceExdates?: string[];
}

interface Category {
	id: string;
	name: string;
	tasks: Task[];
	isCollapsed?: boolean;
	color?: string;
	lastSortOrder?: 'asc' | 'desc';
}

interface SimpleTasksBlocksSettings {
	categories: Category[];
	confirmTaskDeletion: boolean;
	dateFormat: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'Automatic';
	sharedFilePath?: string;
	activeContext: 'local' | 'shared';
	futureTasksCount: number;
}

const DEFAULT_SETTINGS: SimpleTasksBlocksSettings = {
	categories: [],
	confirmTaskDeletion: false,
	dateFormat: 'Automatic',
	sharedFilePath: '',
	activeContext: 'local',
	futureTasksCount: 5
}

const VIEW_TYPE_TASKS = "simple-tasks-blocks-view";

const COLOR_VALUES = {
	'Default': '',
	'Red': 'rgba(233, 30, 99, 0.1)',
	'Green': 'rgba(76, 175, 80, 0.1)',
	'Blue': 'rgba(33, 150, 243, 0.1)',
	'Yellow': 'rgba(255, 235, 59, 0.1)',
	'Purple': 'rgba(156, 39, 176, 0.1)',
	'Grey': 'rgba(158, 158, 158, 0.1)'
};

// --- Main Plugin Class ---

export default class SimpleTasksBlocksPlugin extends Plugin {
	settings: SimpleTasksBlocksSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_TASKS,
			(leaf) => new TasksView(leaf, this)
		);

		this.addRibbonIcon('list-checks', 'Simple tasks blocks', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'create-new-task-category',
			name: 'Create new task category',
			callback: () => {
				new AddCategoryModal(this.app, (name, firstTask, date) => {
					void this.addCategory(name, firstTask, date);
				}).open();
			}
		});

		this.addSettingTab(new SimpleTasksBlocksSettingTab(this.app, this));
		this.setupSharedFileWatcher();
	}

	setupSharedFileWatcher() {
		if (this.settings.sharedFilePath) {
			try {
				const fs = require('fs');
				if (fs.existsSync(this.settings.sharedFilePath)) {
					let fsWait: NodeJS.Timeout | null = null;

					fs.watch(this.settings.sharedFilePath, (eventType: string, filename: string) => {
						if (filename && eventType === 'change') {
							if (fsWait) return;

							fsWait = setTimeout(() => {
								fsWait = null;
								if (this.settings.activeContext === 'shared') {
									const reloadBtn = document.querySelector('.stb-sync-icon');
									if (reloadBtn) {
										reloadBtn.addClass('is-spinning');
										setTimeout(() => reloadBtn.removeClass('is-spinning'), 800);
									}
									this.refreshViews(true);
								}
							}, 100);
						}
					});
				}
			} catch (e) {
				console.error("Watcher error:", e);
			}
		}
	}

	onunload() {
		if (this.settings.sharedFilePath) {
			try {
				const fs = require('fs');
				fs.unwatchFile(this.settings.sharedFilePath);
			} catch (e) {
				// Ignore
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.setupSharedFileWatcher();
		this.refreshViews();
	}

	refreshViews(isSync = false) {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS).forEach(leaf => {
			if (leaf.view instanceof TasksView) {
				leaf.view.refresh();
				if (isSync) {
					leaf.view.triggerSyncEffect();
				}
			}
		});
	}

	getCategories(isShared?: boolean): Category[] {
		const useShared = isShared !== undefined ? isShared : (this.settings.activeContext === 'shared');

		if (useShared && this.settings.sharedFilePath) {
			try {
				const fs = require('fs');
				if (fs.existsSync(this.settings.sharedFilePath)) {
					const content = fs.readFileSync(this.settings.sharedFilePath, 'utf8');
					const data = JSON.parse(content);
					return data.categories || [];
				}
			} catch (e) {
				console.error("Error reading shared file:", e);
						new Notice(t('ERR_READ_SHARED'));
					}
					return [];
				}
				return this.settings.categories;
	}

	async saveCategories(categories: Category[], isShared?: boolean) {
		const useShared = isShared !== undefined ? isShared : (this.settings.activeContext === 'shared');

		if (useShared && this.settings.sharedFilePath) {
			try {
				const fs = require('fs');

				let freshCategories: Category[] = [];
				if (fs.existsSync(this.settings.sharedFilePath)) {
					try {
						const content = fs.readFileSync(this.settings.sharedFilePath, 'utf8');
						const data = JSON.parse(content);
						freshCategories = data.categories || [];
					} catch (readError) {
						console.error("Error reading fresh data for merge:", readError);
					}
				}

				const mergedCategories = [...freshCategories];

				categories.forEach(localCat => {
					const diskCatIndex = mergedCategories.findIndex(dc => dc.id === localCat.id);
					if (diskCatIndex !== -1) {
						const diskCat = mergedCategories[diskCatIndex];
						diskCat.name = localCat.name;
						diskCat.color = localCat.color;
						diskCat.isCollapsed = localCat.isCollapsed;
						diskCat.lastSortOrder = localCat.lastSortOrder;

						const localTasksMap = new Map(localCat.tasks.map(t => [t.id, t]));
						const diskTasks = diskCat.tasks;

						const mergedTasks = diskTasks.map(dt => {
							if (localTasksMap.has(dt.id)) {
								return localTasksMap.get(dt.id)!;
							}
							return dt;
						});

						localCat.tasks.forEach(lt => {
							if (!diskTasks.find(dt => dt.id === lt.id)) {
								mergedTasks.push(lt);
							}
						});

						const localIdToIndex = new Map<string, number>();
						localCat.tasks.forEach((t, i) => localIdToIndex.set(t.id, i));

						mergedTasks.sort((a, b) => {
							const idxA = localIdToIndex.has(a.id) ? localIdToIndex.get(a.id)! : 999999999;
							const idxB = localIdToIndex.has(b.id) ? localIdToIndex.get(b.id)! : 999999999;
							return idxA - idxB;
						});

						diskCat.tasks = mergedTasks;
					} else {
						mergedCategories.push(localCat);
					}
				});

				const localCatOrder = new Map<string, number>();
				categories.forEach((c, i) => localCatOrder.set(c.id, i));

				mergedCategories.sort((a, b) => {
					const idxA = localCatOrder.has(a.id) ? localCatOrder.get(a.id)! : 999999999;
					const idxB = localCatOrder.has(b.id) ? localCatOrder.get(b.id)! : 999999999;
					return idxA - idxB;
				});

				const data = { categories: mergedCategories };
				fs.writeFileSync(this.settings.sharedFilePath, JSON.stringify(data, null, 2));
				this.refreshViews();

			} catch (e) {
				console.error("Error writing shared file:", e);
				new Notice(t('ERR_SAVE_SHARED'));
			}
		} else {
			this.settings.categories = categories;
			await this.saveSettings();
		}
	}

	async cleanCompletedTasks(isShared?: boolean) {
		const useShared = isShared !== undefined ? isShared : (this.settings.activeContext === 'shared');

		if (useShared && this.settings.sharedFilePath) {
			try {
				const fs = require('fs');
				if (fs.existsSync(this.settings.sharedFilePath)) {
					const content = fs.readFileSync(this.settings.sharedFilePath, 'utf8');
					const data = JSON.parse(content);
					const categories = data.categories || [];

					let changed = false;
					categories.forEach((c: any) => {
						const originalLength = c.tasks.length;
						c.tasks = c.tasks.filter((t: any) => !t.completed);
						if (c.tasks.length !== originalLength) changed = true;
					});

					if (changed) {
						const newData = { categories: categories };
						fs.writeFileSync(this.settings.sharedFilePath, JSON.stringify(newData, null, 2));
						this.refreshViews();
						new Notice(t('NOTICE_CLEANED_SHARED'));
					} else {
						new Notice(t('NOTICE_NO_CLEAN'));
					}
				}
			} catch (e) {
				console.error("Error cleaning shared tasks:", e);
				new Notice(t('ERR_CLEAN_SHARED'));
			}
		} else {
			const categories = this.settings.categories;
			let changed = false;
			categories.forEach(c => {
				const originalLength = c.tasks.length;
				c.tasks = c.tasks.filter(t => !t.completed);
				if (c.tasks.length !== originalLength) changed = true;
			});

			if (changed) {
				await this.saveSettings();
				new Notice(t('NOTICE_CLEANED_LOCAL'));
			} else {
				new Notice(t('NOTICE_NO_CLEAN'));
			}
		}
	}

	async updateTaskDate(categoryId: string, taskId: string, date: string) {
		const categories = this.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			const task = category.tasks.find(t => t.id === taskId);
			if (task) {
				task.dueDate = date;
				await this.saveCategories(categories);
			}
		}
	}

	async updateTaskScratchpad(categoryId: string, taskId: string, content: string) {
		const categories = this.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			const task = category.tasks.find(t => t.id === taskId);
			if (task) {
				task.scratchpad = content;
				await this.saveCategories(categories);
			}
		}
	}

	async updateCategoryCollapse(categoryId: string, isCollapsed: boolean) {
		const categories = this.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			category.isCollapsed = isCollapsed;
			await this.saveCategories(categories);
		}
	}

	async updateCategoryColor(categoryId: string, color: string) {
		const categories = this.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			category.color = color;
			await this.saveCategories(categories);
		}
	}

	async addCategory(name: string, firstTaskText: string, dueDate?: string) {
		const categories = this.getCategories();
		const newCategory: Category = {
			id: Date.now().toString(),
			name: name,
			tasks: [],
			isCollapsed: false,
			color: ''
		};

		if (firstTaskText) {
			newCategory.tasks.push({
				id: Date.now().toString() + '-task',
				text: firstTaskText,
				completed: false,
				dueDate: dueDate
			});
		}

		categories.push(newCategory);
		await this.saveCategories(categories);
	}

	async deleteCategory(categoryId: string, isShared?: boolean) {
		const useShared = isShared !== undefined ? isShared : (this.settings.activeContext === 'shared');

		if (useShared && this.settings.sharedFilePath) {
			try {
				const fs = require('fs');
				if (fs.existsSync(this.settings.sharedFilePath)) {
					const content = fs.readFileSync(this.settings.sharedFilePath, 'utf8');
					const data = JSON.parse(content);
					let categories = data.categories || [];

					const initialLength = categories.length;
					categories = categories.filter((c: any) => c.id !== categoryId);

					if (categories.length !== initialLength) {
						const newData = { categories: categories };
						fs.writeFileSync(this.settings.sharedFilePath, JSON.stringify(newData, null, 2));
						this.refreshViews();
					}
				}
			} catch (e) {
				console.error("Error deleting shared category:", e);
				new Notice(t('ERR_DEL_SHARED_CAT'));
			}
		} else {
			this.settings.categories = this.settings.categories.filter(c => c.id !== categoryId);
			await this.saveSettings();
		}
	}

	async duplicateTask(categoryId: string, taskId: string) {
		const categories = this.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			const taskIndex = category.tasks.findIndex(t => t.id === taskId);
			if (taskIndex !== -1) {
				const taskToDuplicate = category.tasks[taskIndex];
				const newTask: Task = {
					...taskToDuplicate,
					id: Date.now().toString() + '-copy',
				};

				category.tasks.splice(taskIndex + 1, 0, newTask);
				await this.saveCategories(categories);
			}
		}
	}

	async deleteTask(categoryId: string, taskId: string, isShared?: boolean) {
		const useShared = isShared !== undefined ? isShared : (this.settings.activeContext === 'shared');

		if (useShared && this.settings.sharedFilePath) {
			try {
				const fs = require('fs');
				if (fs.existsSync(this.settings.sharedFilePath)) {
					const content = fs.readFileSync(this.settings.sharedFilePath, 'utf8');
					const data = JSON.parse(content);
					const categories = data.categories || [];

					const category = categories.find((c: Category) => c.id === categoryId);
					if (category) {
						category.tasks = category.tasks.filter((t: any) => t.id !== taskId);
						const newData = { categories: categories };
						fs.writeFileSync(this.settings.sharedFilePath, JSON.stringify(newData, null, 2));
						this.refreshViews();
					}
				}
			} catch (e) {
				console.error("Error deleting shared task:", e);
				new Notice(t('ERR_DEL_SHARED_TASK'));
			}
		} else {
			const categories = this.settings.categories;
			const category = categories.find(c => c.id === categoryId);
			if (category) {
				category.tasks = category.tasks.filter(t => t.id !== taskId);
				await this.saveSettings();
			}
		}
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASKS);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
		}
		await workspace.revealLeaf(leaf);
	}
}

// --- Settings Tab ---

class SimpleTasksBlocksSettingTab extends PluginSettingTab {
	plugin: SimpleTasksBlocksPlugin;

	constructor(app: App, plugin: SimpleTasksBlocksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t('SETTING_PATH_NAME'))
			.setDesc(t('SETTING_PATH_DESC'))
			.addText(text => text
				.setValue(this.plugin.settings.sharedFilePath || '')
				.setPlaceholder(t('SETTING_PATH_PLACEHOLDER'))
				.setDisabled(true)
			)
			.addButton(btn => btn
				.setButtonText(t('BTN_BROWSE'))
				.setTooltip(t('TIP_SELECT_FILE'))
				.onClick(async () => {
					try {
						const input = document.createElement('input');
						input.type = 'file';
						input.accept = '.json';
						input.style.display = 'none';
						document.body.appendChild(input);

						input.onchange = async () => {
							if (input.files && input.files.length > 0) {
								const file = input.files[0];
								// @ts-ignore
								const filePath = file.path;

								if (filePath) {
									this.plugin.settings.sharedFilePath = filePath;
									await this.plugin.saveSettings();
									this.display();
									new Notice(t('NOTICE_SHARED_ENABLED', filePath));
								}
							}
							document.body.removeChild(input);
						};

						input.click();

						setTimeout(() => {
							if (document.body.contains(input)) {
								document.body.removeChild(input);
							}
						}, 30000);

					} catch (e) {
						console.error(e);
						new Notice(t('ERR_FILE_PICKER'));
					}
				}))
			.addButton(btn => btn
				.setButtonText(t('BTN_CREATE_NEW'))
				.setTooltip(t('TIP_CREATE_FILE'))
				.onClick(async () => {
					try {
						let remote;
						try {
							remote = require('@electron/remote');
						} catch {
							const electron = require('electron');
							// @ts-ignore
							remote = electron.remote;
						}

						if (!remote) throw new Error("Electron remote not available");

						const dialog = remote.dialog;
						const result = await dialog.showSaveDialog({
							filters: [{ name: 'Fichiers de tâches (JSON)', extensions: ['json'] }]
						});

						if (!result.canceled && result.filePath) {
							const fs = require('fs');
							fs.writeFileSync(result.filePath, JSON.stringify({ categories: [] }, null, 2));
							this.plugin.settings.sharedFilePath = result.filePath;
							await this.plugin.saveSettings();
							this.display();
						}
					} catch (e) {
						console.error(e);
						new Notice(t('ERR_CREATE_FILE_MODAL'));
						new SharedSetupModal(this.app, this.plugin).open();
					}
				}));

		new Setting(containerEl)
			.setName(t('SETTING_CONFIRM_DEL'))
			.setDesc(t('SETTING_CONFIRM_DEL_DESC'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.confirmTaskDeletion)
				.onChange(async (value) => {
					this.plugin.settings.confirmTaskDeletion = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('SETTING_DATE_FORMAT'))
			.setDesc(t('SETTING_DATE_FORMAT_DESC'))
			.addDropdown(dropdown => dropdown
				.addOption('Automatic', t('SETTING_DATE_AUTO'))
			.addOption('YYYY-MM-DD', t('FMT_YEAR_MONTH_DAY'))
			.addOption('DD-MM-YYYY', t('FMT_DAY_MONTH_YEAR'))
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value as SimpleTasksBlocksSettings['dateFormat'];
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('SETTING_FUTURE_COUNT'))
			.setDesc(t('SETTING_FUTURE_COUNT_DESC'))	
			.addDropdown(dropdown => {
				for (let i = 1; i <= 10; i++) {
					dropdown.addOption(i.toString(), i.toString());
				}
				dropdown
					.setValue(this.plugin.settings.futureTasksCount.toString())
					.onChange(async (value) => {
						this.plugin.settings.futureTasksCount = parseInt(value);
						await this.plugin.saveSettings();
					});
			});
	}
}

// --- View ---

class TasksView extends ItemView {
	plugin: SimpleTasksBlocksPlugin;
	draggedCategoryIndex: number | null = null;
	icon = "list-checks";

	constructor(leaf: WorkspaceLeaf, plugin: SimpleTasksBlocksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_TASKS;
	}

	getDisplayText() {
		return t('VIEW_DISPLAY_TEXT');
	}

	onOpen() {
		this.refresh();
		return Promise.resolve();
	}

	async onClose() {
	}

	refresh() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('stb-container');

		const header = container.createEl('div', { cls: 'stb-header' });
		const grid = header.createEl('div', { cls: 'stb-header-grid' });
		
		const leftPart = grid.createEl('div', { cls: 'stb-header-part-left' });
		const switcher = leftPart.createEl('div', { cls: 'stb-context-switcher' });

		const localBtn = switcher.createEl('div', { cls: 'stb-context-btn' });
		localBtn.setAttribute('aria-label', t('LABEL_LOCAL'));
		setIcon(localBtn, 'database');

		if (this.plugin.settings.activeContext === 'local') {
			localBtn.addClass('is-active');
		}

		localBtn.addEventListener('click', async () => {
			if (this.plugin.settings.activeContext !== 'local') {
				this.plugin.settings.activeContext = 'local';
				await this.plugin.saveSettings();
				this.refresh();
			}
		});

		const sharedBtn = switcher.createEl('div', { cls: 'stb-context-btn' });
		sharedBtn.setAttribute('aria-label', t('LABEL_SHARED'));
		const sharedIcon = sharedBtn.createEl('span', { cls: 'stb-btn-icon' });
		setIcon(sharedIcon, 'share-2');

		if (this.plugin.settings.activeContext === 'shared') {
			sharedBtn.addClass('is-active');
		}

		sharedBtn.addEventListener('click', async () => {
			if (this.plugin.settings.activeContext !== 'shared') {
				if (!this.plugin.settings.sharedFilePath) {
					new SharedSetupModal(this.app, this.plugin).open();
					return;
				}
				this.plugin.settings.activeContext = 'shared';
				await this.plugin.saveSettings();
				this.refresh();
			}
		});

		const reloadBtn = switcher.createEl('div', { cls: 'stb-context-btn stb-reload-btn stb-sync-icon' });
		reloadBtn.setAttribute('aria-label', 'Reload');
		const reloadIcon = reloadBtn.createEl('span', { cls: 'stb-btn-icon' });
		setIcon(reloadIcon, 'refresh-cw');
		
		reloadBtn.addEventListener('click', () => {
			reloadBtn.addClass('is-spinning');
			setTimeout(() => {
				this.refresh();
				reloadBtn.removeClass('is-spinning');
			}, 800);
		});
		
		leftPart.createEl('span', { 
			text: this.plugin.settings.activeContext === 'shared' ? t('LABEL_SHARED') : t('LABEL_LOCAL'),
			cls: 'stb-context-label'
		});

		const centerPart = grid.createEl('div', { cls: 'stb-header-part-center' });
		// Button moved to right part

		const rightPart = grid.createEl('div', { cls: 'stb-header-part-right' });
		
		const addCategoryBtn = rightPart.createEl('button', { text: t('BTN_ADD_CAT'), cls: 'mod-cta' });
		addCategoryBtn.addEventListener('click', () => {
			new AddCategoryModal(this.app, (name, firstTask, date) => {
				void this.plugin.addCategory(name, firstTask, date);
			}).open();
		});

		const sortGlobalBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(sortGlobalBtn, 'arrow-down-a-z');
		sortGlobalBtn.setAttribute('aria-label', t('TIP_SORT_AZ'));
		sortGlobalBtn.addEventListener('click', () => {
			void this.sortAllCategoriesAlphabetically();
		});

		const toggleAllBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(toggleAllBtn, 'chevrons-up-down');
		toggleAllBtn.setAttribute('aria-label', t('TIP_TOGGLE_ALL'));
		toggleAllBtn.addEventListener('click', () => {
			void this.toggleAllCategories();
		});

		const cleanBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(cleanBtn, 'eraser');
		cleanBtn.setAttribute('aria-label', t('TIP_CLEAN_DONE'));
		cleanBtn.addEventListener('click', () => {
			new ConfirmModal(this.app, t('CONFIRM_CLEAN_ALL'), () => {
				void this.plugin.cleanCompletedTasks();
			}).open();
		});

		const categoriesContainer = container.createEl('div', { cls: 'stb-categories-list' });
		const categories = this.plugin.getCategories();
		categories.forEach((category, index) => {
			this.renderCategory(categoriesContainer, category, index);
		});
	}

	triggerSyncEffect() {
		const reloadBtn = this.containerEl.querySelector('.stb-reload-btn');
		if (reloadBtn) {
			reloadBtn.addClass('is-syncing');
			setTimeout(() => reloadBtn.removeClass('is-syncing'), 2000);
		}
	}

	renderCategory(container: HTMLElement, category: Category, index: number) {
		const catBlock = container.createEl('div', { cls: 'stb-category-block' });
		if (category.color) {
			catBlock.setCssProps({ 'background-color': category.color });
		}

		catBlock.setAttribute('draggable', 'true');
		catBlock.addEventListener('dragstart', (e) => {
			this.draggedCategoryIndex = index;
			catBlock.addClass('stb-dragging');
			e.dataTransfer?.setData('text/plain', index.toString());
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});

		catBlock.addEventListener('dragend', () => {
			catBlock.removeClass('stb-dragging');
			this.draggedCategoryIndex = null;
			const allBlocks = container.querySelectorAll('.stb-category-block');
			allBlocks.forEach(b => b.removeClass('stb-drag-over'));
		});

		catBlock.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (this.draggedCategoryIndex === null || this.draggedCategoryIndex === index) return;
			catBlock.addClass('stb-drag-over');
		});

		catBlock.addEventListener('dragleave', () => {
			catBlock.removeClass('stb-drag-over');
		});

		catBlock.addEventListener('drop', (e) => {
			e.preventDefault();
			catBlock.removeClass('stb-drag-over');
			if (this.draggedCategoryIndex !== null && this.draggedCategoryIndex !== index) {
				void this.reorderCategories(this.draggedCategoryIndex, index);
			}
		});

		catBlock.addEventListener('contextmenu', (event: MouseEvent) => {
			event.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle(t('MENU_CHANGE_COLOR')).setIcon("palette");
			});
			menu.addSeparator();
			Object.keys(COLOR_VALUES).forEach((colorName) => {
				const displayColorName = t(`COLOR_${colorName.toUpperCase()}` as any);
				menu.addItem((item) => {
					item.setTitle(displayColorName)
						.setChecked(category.color === COLOR_VALUES[colorName as keyof typeof COLOR_VALUES])
						.onClick(() => {
							void this.plugin.updateCategoryColor(category.id, COLOR_VALUES[colorName as keyof typeof COLOR_VALUES]);
						});
				});
			});
			menu.showAtPosition({ x: event.clientX, y: event.clientY });
		});

		const catHeader = catBlock.createEl('div', { cls: 'stb-category-header' });
		
		const dragHandle = catHeader.createEl('div', { cls: 'stb-drag-handle clickable-icon' });
		setIcon(dragHandle, 'grip-vertical');

		const chevron = catHeader.createEl('div', { cls: 'stb-cat-chevron clickable-icon' });
		setIcon(chevron, category.isCollapsed ? 'chevron-right' : 'chevron-down');
		chevron.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.plugin.updateCategoryCollapse(category.id, !category.isCollapsed);
		});

		const title = catHeader.createEl('h3', { text: category.name });
		title.addEventListener('click', (e) => {
			e.stopPropagation();
			this.makeEditable(title, async (newText) => {
				if (newText && newText !== category.name) {
					category.name = newText;
					await this.plugin.saveSettings();
				}
			});
		});
	
		const addTaskHeaderBtn = catHeader.createEl('div', { cls: 'stb-cat-add-btn clickable-icon' });
		setIcon(addTaskHeaderBtn, 'plus');
		addTaskHeaderBtn.setAttribute('aria-label', t('TIP_ADD_TASK'));

		catHeader.createEl('div', { cls: 'stb-spacer' });

		const sortBtn = catHeader.createEl('div', { cls: 'stb-cat-sort-btn clickable-icon' });
		setIcon(sortBtn, 'arrow-up-down');
		sortBtn.setAttribute('aria-label', t('TIP_SORT_DATE'));
		sortBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.sortCategoryTasks(category.id);
		});

		const deleteCatBtn = catHeader.createEl('div', { cls: 'stb-delete-cat-btn clickable-icon' });
		setIcon(deleteCatBtn, 'trash');
		deleteCatBtn.setAttribute('aria-label', t('TIP_DELETE_CAT'));
		deleteCatBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new ConfirmModal(this.app, t('CONFIRM_DELETE_CAT', category.name), () => {
				void this.deleteCategory(category.id);
			}).open();
		});

		if (!category.isCollapsed) {
			const tasksList = catBlock.createEl('div', { cls: 'stb-tasks-list' });
			category.tasks.forEach(task => {
				this.renderTask(tasksList, category, task);
			});

			const inlineContainer = catBlock.createEl('div', { cls: 'stb-add-task-inline' });
			inlineContainer.hide();

			const showInput = () => {
				inlineContainer.show();
				inlineContainer.empty();
				
				const wrapper = inlineContainer.createEl('div', { cls: 'stb-inline-input-wrapper' });
				wrapper.style.position = 'relative';
				
				const input = wrapper.createEl('input', { type: 'text', placeholder: t('INPUT_NEW_TASK') });
				input.focus();

				const dateBtn = wrapper.createEl('div', { cls: 'stb-inline-date-btn clickable-icon' });
				setIcon(dateBtn, 'calendar');
				
				const dateInput = wrapper.createEl('input', { type: 'date', cls: 'stb-hidden-date-input' });
				dateInput.hide();

				dateBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					const btnRect = dateBtn.getBoundingClientRect();
					const wrapperRect = wrapper.getBoundingClientRect();
					dateInput.style.position = 'absolute';
					dateInput.style.top = `${btnRect.bottom - wrapperRect.top + 4}px`;
					dateInput.style.left = `${btnRect.left - wrapperRect.left}px`;
					dateInput.style.zIndex = '1000';
					dateInput.show();
					if ('showPicker' in HTMLInputElement.prototype) {
						try { (dateInput as HTMLInputElement & { showPicker(): void }).showPicker(); } catch { dateInput.focus(); }
					} else { dateInput.focus(); }
				});
				
				dateInput.addEventListener('change', () => {
					if (dateInput.value) {
						dateBtn.addClass('has-date');
						dateBtn.setAttribute('title', dateInput.value);
					} else {
						dateBtn.removeClass('has-date');
						dateBtn.removeAttribute('title');
					}
				});

				const submit = async () => {
					const text = input.value.trim();
					if (text) {
						await this.addTask(category.id, text, dateInput.value || undefined);
					}
					inlineContainer.empty();
					inlineContainer.hide();
				};

				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') void submit();
					if (e.key === 'Escape') {
						inlineContainer.empty();
						inlineContainer.hide();
					}
				});
				
				input.addEventListener('blur', (e) => {
					if (e.relatedTarget === dateInput || e.relatedTarget === dateBtn || wrapper.contains(e.relatedTarget as Node)) {
						return; 
					}
				});
			};

			addTaskHeaderBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				showInput();
			});
		}
	}

	formatDate(dateStr: string): string {
		if (!dateStr) return '';
		const format = this.plugin.settings.dateFormat;
		let useFr = false;

		if (format === 'Automatic') {
			const locale = moment.locale();
			if (locale.startsWith('fr')) useFr = true;
		} else if (format === 'DD-MM-YYYY') {
			useFr = true;
		}

		if (useFr) {
			const [y, m, d] = dateStr.split('-');
			return `${d}-${m}-${y}`;
		}
		return dateStr;
	}

    renderTask(container: HTMLElement, category: Category, task: Task) {
        const taskRow = container.createEl('div', { cls: 'stb-task-row' });

        const scratchpadBtn = taskRow.createEl('div', { cls: 'stb-scratchpad-btn clickable-icon' });
        setIcon(scratchpadBtn, 'sticky-note');
        if (task.scratchpad) scratchpadBtn.addClass('has-content');
        
        scratchpadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            new ScratchpadModal(this.app, task.scratchpad || '', (newText) => {
                if (newText !== task.scratchpad) {
                    void this.plugin.updateTaskScratchpad(category.id, task.id, newText);
                }
            }).open();
        });

        const checkbox = taskRow.createEl('input', { type: 'checkbox' });
        checkbox.checked = task.completed;
        checkbox.addEventListener('change', () => {
            void this.toggleTask(category.id, task.id, checkbox.checked);
        });

        const taskText = taskRow.createEl('span', { cls: 'stb-task-text', text: task.text });
        if (task.completed) taskText.addClass('is-completed');
        taskText.addEventListener('click', (e) => {
            e.stopPropagation();
            this.makeEditable(taskText, async (newText) => {
                if (newText && newText !== task.text) {
                    task.text = newText;
                    await this.plugin.saveSettings();
                }
            });
        });

        const rightActions = taskRow.createEl('div', { cls: 'stb-task-right-actions' });

        if (task.dueDate) {
            if (task.recurrenceType && task.recurrenceType !== 'none') {
                const recurIcon = rightActions.createEl('div', { cls: 'stb-recurrence-icon clickable-icon' });
                setIcon(recurIcon, 'calendar-cog');
                
                recurIcon.style.color = 'var(--text-accent)';
                recurIcon.style.marginRight = '4px';
                recurIcon.style.display = 'inline-flex';
                recurIcon.style.alignItems = 'center';

                recurIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    new FutureOccurrencesModal(this.app, task, this.plugin.settings.futureTasksCount, async (updatedTask) => {
                        Object.assign(task, updatedTask);
                        const categories = this.plugin.getCategories();
                        const currentCat = categories.find(c => c.id === category.id);
                        if (currentCat) {
                            const currentTask = currentCat.tasks.find(t => t.id === task.id);
                            if (currentTask) {
                                Object.assign(currentTask, updatedTask);
                                await this.plugin.saveCategories(categories);
                            }
                        } else {
                            await this.plugin.saveCategories(categories); 
                        }
                        this.refresh();
                    }).open();
                });
            }

            const formattedDate = this.formatDate(task.dueDate);
            const dateBadge = rightActions.createEl('span', { cls: 'stb-date-badge', text: formattedDate });
            
            const todayStr = window.moment().format('YYYY-MM-DD');
            if (task.dueDate < todayStr) dateBadge.addClass('is-overdue');
            else if (task.dueDate === todayStr) dateBadge.addClass('is-today');
        }

        const dateEditBtn = rightActions.createEl('div', { cls: 'stb-task-date-btn clickable-icon' });
        setIcon(dateEditBtn, 'calendar');

        const deleteBtn = rightActions.createEl('div', { cls: 'stb-delete-task-btn clickable-icon' });
        setIcon(deleteBtn, 'x');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.plugin.settings.confirmTaskDeletion) {
                new ConfirmModal(this.app, t('CONFIRM_DELETE_TASK'), async () => {
                    await this.plugin.deleteTask(category.id, task.id, this.plugin.settings.activeContext === 'shared');
                    this.refresh();
                }).open();
            } else {
                void (async () => {
                    await this.plugin.deleteTask(category.id, task.id, this.plugin.settings.activeContext === 'shared');
                    this.refresh();
                })();
            }
        });

        taskRow.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
            const menu = new Menu();
            menu.addItem((item) => {
                item.setTitle(t('TIP_DUPLICATE')).setIcon("copy").onClick(() => {
                    void this.plugin.duplicateTask(category.id, task.id);
                });
            });
            menu.showAtPosition({ x: event.clientX, y: event.clientY });
        });

        dateEditBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            new TaskDateModal(this.app, task, async (updatedData) => {
                Object.assign(task, updatedData);
                const categories = this.plugin.getCategories();
                const currentCat = categories.find(c => c.id === category.id);
                if (currentCat) {
                    const currentTask = currentCat.tasks.find(t => t.id === task.id);
                    if (currentTask) {
                        currentTask.dueDate = task.dueDate;
                        currentTask.recurrenceType = task.recurrenceType;
                        currentTask.recurrenceValue = task.recurrenceValue;
                        currentTask.recurrenceUntil = task.recurrenceUntil;
                        currentTask.recurrenceExdates = task.recurrenceExdates;
                        await this.plugin.saveCategories(categories);
                    }
                }
                this.refresh();
            }).open();
        });
    }

    makeEditable(element: HTMLElement, onSave: (text: string) => Promise<void>) {
        const currentText = element.innerText;
        element.empty();
        const input = element.createEl('input', { 
            type: 'text', 
            value: currentText, 
            cls: 'stb-inline-input' 
        });
        
        input.focus();
        input.addEventListener('click', (e) => e.stopPropagation());

        const save = async () => {
            const newText = input.value.trim();
            if (!newText || newText === currentText) {
                element.empty();
                element.innerText = currentText;
                return;
            }
            await onSave(newText);
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') this.refresh();
        });

        input.addEventListener('blur', () => void save());
    }

    async sortCategoryTasks(categoryId: string) {
        const categories = this.plugin.getCategories();
        const category = categories.find(c => c.id === categoryId);
        if (!category) return;

        const currentOrder = category.lastSortOrder || 'desc';
        const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
        const todayStr = window.moment().format('YYYY-MM-DD');

        category.tasks.sort((a, b) => {
            const dateA = a.dueDate || todayStr;
            const dateB = b.dueDate || todayStr;
            if (dateA === dateB) return 0;
            return newOrder === 'asc' ? (dateA < dateB ? -1 : 1) : (dateA > dateB ? -1 : 1);
        });

        category.lastSortOrder = newOrder;
        const isShared = this.plugin.settings.activeContext === 'shared';
        await this.plugin.saveCategories(categories, isShared);
        
        this.refresh();
        new Notice(`Sorted tasks ${newOrder === 'asc' ? 'ascending' : 'descending'}`);
    }

	async sortAllCategoriesAlphabetically() {
		const categories = this.plugin.getCategories();
		categories.sort((a, b) => a.name.localeCompare(b.name));
		await this.plugin.saveCategories(categories);
		this.refresh();
		new Notice(t('NOTICE_SORTED_GLOBAL'));
	}

	async reorderCategories(fromIndex: number, toIndex: number) {
		const categories = this.plugin.getCategories();
		const [moved] = categories.splice(fromIndex, 1);
		categories.splice(toIndex, 0, moved);
		await this.plugin.saveCategories(categories);
	}

	async addCategory(name: string, firstTaskText: string) {
		await this.plugin.addCategory(name, firstTaskText);
	}

	async deleteCategory(id: string) {
		await this.plugin.deleteCategory(id);
	}

	async addTask(categoryId: string, text: string, dueDate?: string) {
		const categories = this.plugin.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			category.tasks.push({
				id: Date.now().toString(),
				text: text,
				completed: false,
				dueDate: dueDate
			});
			await this.plugin.saveCategories(categories);
		}
	}

	async toggleTask(categoryId: string, taskId: string, completed: boolean) {
		const categories = this.plugin.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			const task = category.tasks.find(t => t.id === taskId);
			if (task) {
				if (completed && task.recurrenceType && task.recurrenceType !== 'none') {
					let nextDate = window.moment(task.dueDate || undefined);
					if (!task.dueDate) nextDate = window.moment();
					const value = task.recurrenceValue || 1;

					switch (task.recurrenceType) {
						case 'daily': nextDate.add(1, 'days'); break;
						case 'weekly': nextDate.add(1, 'weeks'); break;
						case 'monthly': nextDate.add(1, 'months'); break;
						case 'custom_days': nextDate.add(value, 'days'); break;
					}

					const nextDateStr = nextDate.format('YYYY-MM-DD');
					let loopGuard = 0;
					while (task.recurrenceExdates && task.recurrenceExdates.includes(nextDate.format('YYYY-MM-DD')) && loopGuard < 100) {
						switch (task.recurrenceType) {
							case 'daily': nextDate.add(1, 'days'); break;
							case 'weekly': nextDate.add(1, 'weeks'); break;
							case 'monthly': nextDate.add(1, 'months'); break;
							case 'custom_days': nextDate.add(value, 'days'); break;
						}
						loopGuard++;
					}
					
					const finalNextDateStr = nextDate.format('YYYY-MM-DD');
					let shouldRecur = true;
					if (task.recurrenceUntil) {
						if (nextDate.isAfter(moment(task.recurrenceUntil))) shouldRecur = false;
					}

					if (shouldRecur) {
						task.completed = false;
						task.dueDate = finalNextDateStr;
						new Notice(t('NOTICE_NEXT_OCCURRENCE', task.dueDate));
					} else {
						task.completed = true;
						new Notice(t('NOTICE_RECURRENCE_ENDED'));
					}
				} else {
					task.completed = completed;
				}
				
				await this.plugin.saveCategories(categories);
			}
		}
	}

	async deleteTask(categoryId: string, taskId: string) {
		const categories = this.plugin.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			category.tasks = category.tasks.filter(t => t.id !== taskId);
			await this.plugin.saveCategories(categories);
		}
	}

	async toggleAllCategories() {
		const categories = this.plugin.getCategories();
		const anyOpen = categories.some(c => !c.isCollapsed);
		categories.forEach(c => {
			c.isCollapsed = anyOpen; 
		});
		await this.plugin.saveCategories(categories);
	}

	async updateCategoryColor(categoryId: string, color: string) {
		const categories = this.plugin.getCategories();
		const category = categories.find(c => c.id === categoryId);
		if (category) {
			category.color = color;
			await this.plugin.saveCategories(categories);
		}
	}
}

// --- Modals ---

class AddCategoryModal extends Modal {
	onSubmit: (name: string, firstTask: string, date?: string) => void;

	constructor(app: App, onSubmit: (name: string, firstTask: string, date?: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t('MODAL_ADD_CAT_TITLE') });

		const nameDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		nameDiv.createEl("label", { text: t('FIELD_CAT_NAME') });
		const nameInput = nameDiv.createEl("input", { type: "text" });

		const taskDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		taskDiv.createEl("label", { text: t('FIELD_FIRST_TASK') });
		const taskInput = taskDiv.createEl("input", { type: "text" });

		const dateDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		dateDiv.createEl("label", { text: t('FIELD_DATE_OPTIONAL') });
		const dateInput = dateDiv.createEl("input", { type: "date" });

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		const submitBtn = buttonDiv.createEl("button", { text: t('BTN_CREATE'), cls: "mod-cta" });

		submitBtn.addEventListener("click", () => {
			const name = nameInput.value.trim();
			const task = taskInput.value.trim();
			const date = dateInput.value;
			
			if (!name || !task) {
				new Notice(t('ERR_REQUIRED'));
				return;
			}

			this.onSubmit(name, task, date || undefined);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class FutureOccurrencesModal extends Modal {
	task: Task;
	count: number;
	onSave: (updatedTask: Partial<Task>) => void;

	constructor(app: App, task: Task, count: number, onSave: (updatedTask: Partial<Task>) => void) {
		super(app);
		this.task = task;
		this.count = 15; // Force limit to 15 as requested
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t('MODAL_FUTURE_TITLE') });
		
		const listContainer = contentEl.createDiv({ cls: 'stb-future-list' });
		
		let nextDate = window.moment(this.task.dueDate || undefined);
		if (!this.task.dueDate) nextDate = window.moment();
		
		const value = this.task.recurrenceValue || 1;
		const exdates = this.task.recurrenceExdates || [];
		
		let found = 0;
		let safety = 0;
		const maxDisplay = 15;
		
		while (found < maxDisplay && safety < 1000) {
			switch (this.task.recurrenceType) {
				case 'daily': nextDate.add(1, 'days'); break;
				case 'weekly': nextDate.add(1, 'weeks'); break;
				case 'monthly': nextDate.add(1, 'months'); break;
				case 'custom_days': nextDate.add(value, 'days'); break;
			}
			
			const dateStr = nextDate.format('YYYY-MM-DD');
			
			if (this.task.recurrenceUntil && nextDate.isAfter(moment(this.task.recurrenceUntil))) {
				break;
			}
			
			if (exdates.includes(dateStr)) {
				safety++;
				continue;
			}
			
			found++;
			safety++;
			
			const row = listContainer.createDiv({ cls: 'stb-future-item' });
			row.style.display = 'flex';
			row.style.justifyContent = 'space-between';
			row.style.alignItems = 'center';
			row.style.padding = '8px 0';
			row.style.borderBottom = '1px solid var(--background-modifier-border)';
			
			const dateText = nextDate.format('dddd LL');
			const capitalizedDateText = dateText.charAt(0).toUpperCase() + dateText.slice(1);
			row.createSpan({ text: capitalizedDateText });
			
			const deleteBtn = row.createDiv({ cls: 'clickable-icon' });
			setIcon(deleteBtn, 'trash');
			deleteBtn.setAttribute('aria-label', t('TIP_SKIP_TASK'));
			deleteBtn.addEventListener('click', () => {
				new ConfirmModal(this.app, t('CONFIRM_SKIP_DATE', dateStr), () => {
					const newExdates = [...(this.task.recurrenceExdates || []), dateStr];
					this.onSave({ recurrenceExdates: newExdates });
					new Notice(t('NOTICE_SKIPPED'));
					this.close();
				}).open();
			});
		}
		
		if (found === 0) {
			listContainer.createDiv({ text: t('MSG_NO_FUTURE') });
		}

		const footer = contentEl.createDiv({ cls: 'stb-future-footer' });
		footer.style.marginTop = '15px';
		footer.style.fontStyle = 'italic';
		footer.style.color = 'var(--text-muted)';
		footer.style.marginBottom = '20px';

		if (found === maxDisplay) {
			if (this.task.recurrenceUntil) {
				let remaining = 0;
				let countSafety = 0;
				const countDate = nextDate.clone();

				while (countSafety < 5000) {
					switch (this.task.recurrenceType) {
						case 'daily': countDate.add(1, 'days'); break;
						case 'weekly': countDate.add(1, 'weeks'); break;
						case 'monthly': countDate.add(1, 'months'); break;
						case 'custom_days': countDate.add(value, 'days'); break;
					}

					if (countDate.isAfter(moment(this.task.recurrenceUntil))) break;
					if (!exdates.includes(countDate.format('YYYY-MM-DD'))) remaining++;
					countSafety++;
				}

				if (remaining > 0) {
					footer.setText(t('MSG_AND_MORE', remaining.toString(), this.task.recurrenceUntil));
				}

			} else {
				let typeText = t('UNIT_DAYS');
				let displayValue = 1;

				switch(this.task.recurrenceType) {
					case 'daily': typeText = t('UNIT_DAYS'); break;
					case 'weekly': typeText = t('UNIT_WEEKS'); break;
					case 'monthly': typeText = t('UNIT_MONTHS'); break;
					case 'custom_days': 
						typeText = t('UNIT_DAYS'); 
						displayValue = value;
						break;
				}
				
				footer.setText(t('MSG_REPEATED_EVERY', displayValue.toString(), typeText));
			}
		}

		const stopBtnContainer = contentEl.createDiv({ cls: 'stb-stop-recurrence-container' });
		stopBtnContainer.style.display = 'flex';
		stopBtnContainer.style.justifyContent = 'center';
		stopBtnContainer.style.marginTop = '10px';

		const stopBtn = stopBtnContainer.createEl('button', { text: t('BTN_STOP_RECURRENCE'), cls: "mod-warning" });
		stopBtn.style.width = '100%';

		stopBtn.addEventListener('click', () => {
			new ConfirmModal(this.app, t('CONFIRM_STOP_RECURRENCE'), () => {
				this.onSave({
					recurrenceType: 'none',
					recurrenceValue: undefined,
					recurrenceUntil: undefined,
					recurrenceExdates: []
				});
				new Notice(t('NOTICE_STOPPED'));
				this.close();
			}).open();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class TaskDateModal extends Modal {
	task: Task;
	onSave: (updatedData: Partial<Task>) => void;
	tempDate: string;
	tempRecurType: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom_days';
	tempRecurValue: number;
	tempRecurUntil: string;
	tempUntilMode: 'never' | 'until';

	constructor(app: App, task: Task, onSave: (updatedData: Partial<Task>) => void) {
		super(app);
		this.task = task;
		this.onSave = onSave;
		this.tempDate = task.dueDate || '';
		this.tempRecurType = task.recurrenceType || 'none';
		this.tempRecurValue = task.recurrenceValue || 1;
		this.tempRecurUntil = task.recurrenceUntil || '';
		this.tempUntilMode = this.tempRecurUntil ? 'until' : 'never';
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t('MODAL_EDIT_DATE_TITLE') });

		new Setting(contentEl)
			.setName(t('FIELD_DUE_DATE'))
			.addText(text => text
				.setValue(this.tempDate)
				.setPlaceholder('YYYY-MM-DD')
				.onChange(value => {
					this.tempDate = value;
				})
				.inputEl.type = 'date'
			);

		new Setting(contentEl)
			.setName(t('FIELD_RECURRENCE'))
			.addDropdown(dropdown => dropdown
				.addOption('none', t('REC_NONE'))
				.addOption('daily', t('REC_DAILY'))
				.addOption('weekly', t('REC_WEEKLY'))
				.addOption('monthly', t('REC_MONTHLY'))
				.addOption('custom_days', t('REC_CUSTOM'))
				.setValue(this.tempRecurType)
				.onChange(value => {
					this.tempRecurType = value as any;
					this.displayCustomValueField(valueField, value);
				})
			);

		const valueField = new Setting(contentEl)
			.setName(t('FIELD_INTERVAL'))
			.addText(text => text
				.setValue(this.tempRecurValue.toString())
				.onChange(value => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.tempRecurValue = num;
					}
				})
				.inputEl.type = 'number'
			);

		this.displayCustomValueField(valueField, this.tempRecurType);

		contentEl.createEl("h3", { text: t('FIELD_END_RECURRENCE'), cls: "stb-modal-h3" });
		
		const untilSetting = new Setting(contentEl)
			.setName(t('FIELD_STOP_REPEATING'))
			.addDropdown(dropdown => dropdown
				.addOption('never', t('VAL_NEVER'))
				.addOption('until', t('VAL_UNTIL'))
				.setValue(this.tempUntilMode)
				.onChange(value => {
					this.tempUntilMode = value as 'never' | 'until';
					this.displayUntilField(untilDateField, value);
				})
			);

		const untilDateField = new Setting(contentEl)
			.setName(t('MODAL_END_DATE'))
			.addText(text => text
				.setValue(this.tempRecurUntil)
				.setPlaceholder('YYYY-MM-DD')
				.onChange(value => {
					this.tempRecurUntil = value;
				})
				.inputEl.type = 'date'
			);
		
		this.displayUntilField(untilDateField, this.tempUntilMode);

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		buttonDiv.style.marginTop = '20px';
		
		const saveBtn = new Setting(buttonDiv)
			.addButton(btn => btn
				.setButtonText(t('BTN_SAVE'))
				.setCta()
				.onClick(() => {
					if (this.tempUntilMode === 'until') {
						if (!this.tempDate) {
							new Notice(t('ERR_START_DATE_REQ'));
							return;
						}
						if (this.tempRecurType === 'none') {
							new Notice(t('ERR_FREQ_REQ'));
							return;
						}
						if (!this.tempRecurUntil) {
							new Notice(t('ERR_END_DATE_REQ'));
							return;
						}
					}

					const finalUntil = this.tempUntilMode === 'until' ? this.tempRecurUntil : undefined;

					this.onSave({
						dueDate: this.tempDate,
						recurrenceType: this.tempRecurType,
						recurrenceValue: this.tempRecurValue,
						recurrenceUntil: finalUntil
					});
					this.close();
				})
			);
			
		saveBtn.settingEl.style.border = 'none';
		saveBtn.settingEl.style.justifyContent = 'flex-end';
	}

	displayCustomValueField(setting: Setting, type: string) {
		if (type === 'custom_days') {
			setting.settingEl.show();
		} else {
			setting.settingEl.hide();
		}
	}

	displayUntilField(setting: Setting, mode: string) {
		if (mode === 'until') {
			setting.settingEl.show();
		} else {
			setting.settingEl.hide();
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ScratchpadModal extends Modal {
	initialText: string;
	onSave: (text: string) => void;

	constructor(app: App, initialText: string, onSave: (text: string) => void) {
		super(app);
		this.initialText = initialText;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('stb-scratchpad-modal');
		contentEl.createEl("h3", { text: t('MODAL_SCRATCHPAD_TITLE') });

		const textarea = contentEl.createEl("textarea", { 
			cls: 'stb-scratchpad-textarea',
			text: this.initialText 
		});
		textarea.placeholder = t('FIELD_SCRATCHPAD_PLACEHOLDER');
		
		textarea.focus();
		textarea.setSelectionRange(this.initialText.length, this.initialText.length);

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		const saveBtn = buttonDiv.createEl("button", { text: t('BTN_SAVE'), cls: "mod-cta" });
		const cancelBtn = buttonDiv.createEl("button", { text: t('BTN_CANCEL') });

		saveBtn.addEventListener("click", () => {
			this.onSave(textarea.value);
			this.close();
		});

		cancelBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SharedSetupModal extends Modal {
	plugin: SimpleTasksBlocksPlugin;

	constructor(app: App, plugin: SimpleTasksBlocksPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t('MODAL_SHARED_SETUP_TITLE') });

		const pathDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		pathDiv.createEl("label", { text: t('FIELD_SHARED_PATH') });
		
		const pathInput = pathDiv.createEl("input", { type: "text" });
		pathInput.value = this.plugin.settings.sharedFilePath || '';
		pathInput.disabled = true;
		pathInput.style.width = '100%';

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		buttonDiv.style.marginTop = '10px';
		
		const browseBtn = buttonDiv.createEl("button", { text: t('BTN_BROWSE'), cls: "mod-cta" });
		const createBtn = buttonDiv.createEl("button", { text: t('BTN_CREATE_NEW') });
		const cancelBtn = buttonDiv.createEl("button", { text: t('BTN_CANCEL') });

		const handleFileSelection = async (filePath: string) => {
			pathInput.value = filePath;
			this.plugin.settings.sharedFilePath = filePath;
			await this.plugin.saveSettings();
			this.close();
			this.plugin.refreshViews();
			new Notice(t('NOTICE_SHARED_ENABLED', filePath));
		};

		browseBtn.addEventListener("click", async () => {
			try {
				let remote;
				try {
					remote = require('@electron/remote');
				} catch {
					const electron = require('electron');
					// @ts-ignore
					remote = electron.remote;
				}
				
				if (!remote) {
					throw new Error("Electron remote not available");
				}
				
				const dialog = remote.dialog;
				const result = await dialog.showOpenDialog({
					properties: ['openFile'],
					filters: [{ name: 'Fichiers de tâches (JSON)', extensions: ['json'] }]
				});

				if (!result.canceled && result.filePaths.length > 0) {
					await handleFileSelection(result.filePaths[0]);
				}

			} catch (e) {
				console.error(e);
				new Notice(t('ERR_PICKER'));
				pathInput.disabled = false;
				pathInput.focus();
				
				browseBtn.setText(t('BTN_SAVE_PATH'));
				browseBtn.replaceWith(browseBtn.cloneNode(true));
				const newSaveBtn = buttonDiv.querySelector("button.mod-cta") as HTMLButtonElement;
				
				newSaveBtn.addEventListener("click", async () => {
					if (pathInput.value) {
						await handleFileSelection(pathInput.value);
					}
				});
			}
		});

		createBtn.addEventListener("click", async () => {
			try {
				let remote;
				try {
					remote = require('@electron/remote');
				} catch {
					const electron = require('electron');
					// @ts-ignore
					remote = electron.remote;
				}

				if (!remote) {
					throw new Error("Electron remote not available");
				}

				const dialog = remote.dialog;
				const result = await dialog.showSaveDialog({
					filters: [{ name: 'Fichiers de tâches (JSON)', extensions: ['json'] }]
				});

				if (!result.canceled && result.filePath) {
					const fs = require('fs');
					fs.writeFileSync(result.filePath, JSON.stringify({ categories: [] }, null, 2));
					await handleFileSelection(result.filePath);
				}
			} catch (e) {
				console.error(e);
				new Notice(t('ERR_CREATE_FILE', String(e)));
			}
		});

		cancelBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ConfirmModal extends Modal {
	message: string;
	onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.message });

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		const confirmBtn = buttonDiv.createEl("button", { text: t('CONFIRM_GENERIC'), cls: "mod-warning" });
		const cancelBtn = buttonDiv.createEl("button", { text: t('BTN_CANCEL') });

		confirmBtn.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});

		cancelBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}