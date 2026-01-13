import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Modal, Notice, setIcon, Menu, moment } from 'obsidian';

// --- Interfaces ---

interface Task {
	id: string;
	text: string;
	completed: boolean;
	dueDate?: string; // YYYY-MM-DD
	scratchpad?: string;
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
}

const DEFAULT_SETTINGS: SimpleTasksBlocksSettings = {
	categories: [],
	confirmTaskDeletion: false,
	dateFormat: 'Automatic',
	sharedFilePath: '',
	activeContext: 'local'
}

const VIEW_TYPE_TASKS = "simple-tasks-blocks-view";

const COLORS = {
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

		// Add Ribbon Icon
		this.addRibbonIcon('list-checks', 'Simple tasks blocks', () => {
			void this.activateView();
		});

		// Add Command
		this.addCommand({
			id: 'create-new-task-category',
			name: 'Create new task category',
			callback: () => {
				new AddCategoryModal(this.app, (name, firstTask, date) => {
					void this.addCategory(name, firstTask, date);
				}).open();
			}
		});

		// Add Settings Tab
		this.addSettingTab(new SimpleTasksBlocksSettingTab(this.app, this));

		// Setup Watcher
		this.setupSharedFileWatcher();
	}

	setupSharedFileWatcher() {
		if (this.settings.sharedFilePath) {
			try {
				const fs = require('fs');
				if (fs.existsSync(this.settings.sharedFilePath)) {
					// Use fs.watch (more efficient than watchFile polling) but careful with duplicates
					let fsWait: NodeJS.Timeout | null = null;
					
					fs.watch(this.settings.sharedFilePath, (eventType: string, filename: string) => {
						if (filename && eventType === 'change') {
							if (fsWait) return;
							
							fsWait = setTimeout(() => {
								fsWait = null;
								if (this.settings.activeContext === 'shared') {
									// Trigger animation before refresh
									const reloadBtn = document.querySelector('.stb-sync-icon');
									if (reloadBtn) {
										reloadBtn.addClass('is-spinning');
										setTimeout(() => reloadBtn.removeClass('is-spinning'), 800);
									}
									
									this.refreshViews(true); // true = indicate sync
								}
							}, 100); // Debounce 100ms
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
		this.setupSharedFileWatcher(); // Re-setup watcher if path changed
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
				new Notice("Error reading shared file.");
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
				
				// Read-Merge-Write Logic
				// 1. Read fresh data from disk
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
						// Update existing category
						const diskCat = mergedCategories[diskCatIndex];
						
						// Merge props
						diskCat.name = localCat.name;
						diskCat.color = localCat.color;
						diskCat.isCollapsed = localCat.isCollapsed;
						diskCat.lastSortOrder = localCat.lastSortOrder;
						
						// Merge tasks logic restored to previous working state but careful with deletes
						// If we want generic save to work, we need to know what changed.
						// Since we are reverting to "Direct Delete" inside deleteTask, 
						// this generic save can stay "smart" for ADDITIONS/UPDATES but might fail deletions if not careful.
						// However, the prompt specifically asked to handle delete logic inside deleteTask.
						// So I will simplify this merge to be robust for general updates, 
						// and let deleteTask handle its own persistence if needed, OR
						// I will fix deleteTask to NOT use this method if isShared is true.
						
						// Let's implement the smart union again which is good for updates/additions
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
						
						// Re-apply local sort order to mergedTasks
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
				
				// Re-apply local category order
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
				new Notice("Error saving to shared file.");
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
						new Notice("Completed tasks cleaned (Shared).");
					} else {
						new Notice("No completed tasks to clean.");
					}
				}
			} catch (e) {
				console.error("Error cleaning shared tasks:", e);
				new Notice("Error cleaning shared tasks.");
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
				new Notice("Completed tasks cleaned (Local).");
			} else {
				new Notice("No completed tasks to clean.");
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
				new Notice("Error deleting shared category.");
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
					// We keep the same text, completion status, due date, scratchpad
				};
				
				// Insert right after the original task
				category.tasks.splice(taskIndex + 1, 0, newTask);
				await this.saveCategories(categories);
			}
		}
	}

	async deleteTask(categoryId: string, taskId: string, isShared?: boolean) {
		const useShared = isShared !== undefined ? isShared : (this.settings.activeContext === 'shared');

		if (useShared && this.settings.sharedFilePath) {
			// Specific logic for Shared Delete to avoid "undelete" issues with generic merge
			try {
				const fs = require('fs');
				if (fs.existsSync(this.settings.sharedFilePath)) {
					// 1. Read fresh
					const content = fs.readFileSync(this.settings.sharedFilePath, 'utf8');
					const data = JSON.parse(content);
					const categories = data.categories || [];
					
					// 2. Modify (Delete)
					const category = categories.find((c: Category) => c.id === categoryId);
					if (category) {
						category.tasks = category.tasks.filter((t: any) => t.id !== taskId);
						
						// 3. Write immediately
						const newData = { categories: categories };
						fs.writeFileSync(this.settings.sharedFilePath, JSON.stringify(newData, null, 2));
						
						// 4. Refresh
						this.refreshViews();
					}
				}
			} catch (e) {
				console.error("Error deleting shared task:", e);
				new Notice("Error deleting shared task.");
			}
		} else {
			// Local logic
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
			.setName('Specify the file path for tasks shared between all vaults.')
			.setDesc('Select or create a JSON file for shared tasks.')
			.addText(text => text
				.setValue(this.plugin.settings.sharedFilePath || '')
				.setPlaceholder('No file selected')
				.setDisabled(true)
			)
			.addButton(btn => btn
				.setButtonText('Browse...')
				.setTooltip('Select existing file')
				.onClick(async () => {
					try {
						// Create invisible file input
						const input = document.createElement('input');
						input.type = 'file';
						input.accept = '.json';
						input.style.display = 'none';
						document.body.appendChild(input);

						input.onchange = async () => {
							if (input.files && input.files.length > 0) {
								const file = input.files[0];
								// @ts-ignore
								const filePath = file.path; // Electron exposes path property on File object

								if (filePath) {
									this.plugin.settings.sharedFilePath = filePath;
									await this.plugin.saveSettings();
									this.display(); // Refresh to show new path
									new Notice(`Selected shared file: ${filePath}`);
								}
							}
							document.body.removeChild(input);
						};

						// Trigger click
						input.click();

						// Cleanup if cancelled (timeout fallback)
						setTimeout(() => {
							if (document.body.contains(input)) {
								document.body.removeChild(input);
							}
						}, 30000); // 30s timeout

					} catch (e) {
						console.error(e);
						new Notice("Error opening file picker.");
					}
				}))
			.addButton(btn => btn
				.setButtonText('Create New')
				.setTooltip('Create new JSON file')
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
						new Notice("Error creating file. Try using the Setup Modal.");
						new SharedSetupModal(this.app, this.plugin).open();
					}
				}));

		new Setting(containerEl)
			.setName('Confirm task deletion')
			.setDesc('Ask for confirmation before deleting a task.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.confirmTaskDeletion)
				.onChange(async (value) => {
					this.plugin.settings.confirmTaskDeletion = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date format')
			.setDesc('Choose how dates are displayed.')
			.addDropdown(dropdown => dropdown
			.addOption('Automatic', 'Automatique (selon la langue de Obsidian)')
			.addOption('YYYY-MM-DD', 'Année-mois-jour (ex: 2026-01-02)')
			.addOption('DD-MM-YYYY', 'Jour-mois-année (ex: 02-01-2026)')	
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value as SimpleTasksBlocksSettings['dateFormat'];
					await this.plugin.saveSettings();
				}));
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
		return "Simple tasks blocks";
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

		// Header (Sticky)
		const header = container.createEl('div', { cls: 'stb-header' });
		const grid = header.createEl('div', { cls: 'stb-header-grid' });
		
		// Left: Context Switcher
		const leftPart = grid.createEl('div', { cls: 'stb-header-part-left' });
		const switcher = leftPart.createEl('div', { cls: 'stb-context-switcher' });

		// Button A: Local
		const localBtn = switcher.createEl('div', { cls: 'stb-context-btn' });
		localBtn.setAttribute('aria-label', 'Local tasks');
		setIcon(localBtn, 'database');
		// Text removed

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

		// Button B: Shared
		const sharedBtn = switcher.createEl('div', { cls: 'stb-context-btn' });
		sharedBtn.setAttribute('aria-label', 'Shared tasks');
		const sharedIcon = sharedBtn.createEl('span', { cls: 'stb-btn-icon' });
		setIcon(sharedIcon, 'share-2');
		// Text removed vu

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

		// Reload Button (Only visible if shared is active, or always? User said "Next to shared")
		// Let's put it next to the switcher or inside if we want it integrated.
		// User said "A côté de partager", implying next to the shared button.
		// Since we have a switcher group, adding it as a 3rd button in the group makes sense visually if it's related to the context.
		// But "Reload" only makes sense for Shared usually (to sync changes from others).
		// However, user specifically asked for "recharger sans enregistrer" equivalent.
		
		const reloadBtn = switcher.createEl('div', { cls: 'stb-context-btn stb-reload-btn stb-sync-icon' });
		reloadBtn.setAttribute('aria-label', 'Recharger');
		const reloadIcon = reloadBtn.createEl('span', { cls: 'stb-btn-icon' });
		setIcon(reloadIcon, 'refresh-cw');
		
		reloadBtn.addEventListener('click', () => {
			reloadBtn.addClass('is-spinning');
			setTimeout(() => {
				this.refresh();
				reloadBtn.removeClass('is-spinning');
			}, 800); // 800ms animation
			// Removed explicit Notice per user request for silent feedback
		});
		
		// --- ÉTIQUETTE DE SÉCURITÉ ---
        // On crée le texte à l'intérieur de leftPart, mais APRÈS le switcher
        leftPart.createEl('span', { 
            text: this.plugin.settings.activeContext === 'shared' ? 'Shared Tasks' : 'Local Tasks',
            cls: 'stb-context-label'
        });

		const centerPart = grid.createEl('div', { cls: 'stb-header-part-center' });
		const addCategoryBtn = centerPart.createEl('button', { text: '+ category', cls: 'mod-cta' });
		addCategoryBtn.addEventListener('click', () => {
			new AddCategoryModal(this.app, (name, firstTask, date) => {
				void this.plugin.addCategory(name, firstTask, date);
			}).open();
		});

		const rightPart = grid.createEl('div', { cls: 'stb-header-part-right' });
		
		const sortGlobalBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(sortGlobalBtn, 'arrow-down-a-z');
		sortGlobalBtn.setAttribute('aria-label', 'Sort all categories (A-Z)');
		sortGlobalBtn.addEventListener('click', () => {
			void this.sortAllCategoriesAlphabetically();
		});

		const toggleAllBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(toggleAllBtn, 'chevrons-up-down');
		toggleAllBtn.setAttribute('aria-label', 'Toggle collapse/expand for all categories');
		toggleAllBtn.addEventListener('click', () => {
			void this.toggleAllCategories();
		});

		const cleanBtn = rightPart.createEl('div', { cls: 'stb-header-icon clickable-icon' });
		setIcon(cleanBtn, 'eraser');
		cleanBtn.setAttribute('aria-label', 'Clean completed tasks');
		cleanBtn.addEventListener('click', () => {
			new ConfirmModal(this.app, "Delete ALL completed tasks from ALL categories?", () => {
				void this.plugin.cleanCompletedTasks();
			}).open();
		});


		// Categories List (Scrollable)
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
		// Removed Notice("Données synchronisées") for silent feedback
	}

	renderCategory(container: HTMLElement, category: Category, index: number) {
		const catBlock = container.createEl('div', { cls: 'stb-category-block' });
		if (category.color) {
			catBlock.setCssProps({ 'background-color': category.color });
		}

		// Drag & Drop Attributes
		catBlock.setAttribute('draggable', 'true');
		catBlock.addEventListener('dragstart', (e) => {
			this.draggedCategoryIndex = index;
			catBlock.addClass('stb-dragging');
			e.dataTransfer?.setData('text/plain', index.toString());
			
			// Drag effect
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});

		catBlock.addEventListener('dragend', () => {
			catBlock.removeClass('stb-dragging');
			this.draggedCategoryIndex = null;
			
			// Remove all drag-over classes
			const allBlocks = container.querySelectorAll('.stb-category-block');
			allBlocks.forEach(b => b.removeClass('stb-drag-over'));
		});

		catBlock.addEventListener('dragover', (e) => {
			e.preventDefault(); // Necessary to allow dropping
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

		// Context Menu for Color
		catBlock.addEventListener('contextmenu', (event: MouseEvent) => {
			event.preventDefault();
			const menu = new Menu();
			
			menu.addItem((item) => {
				item.setTitle("Change color")
					.setIcon("palette");
			});
			
			menu.addSeparator();

			Object.keys(COLORS).forEach((colorName) => {
				menu.addItem((item) => {
					item.setTitle(colorName)
						.setChecked(category.color === COLORS[colorName as keyof typeof COLORS])
						.onClick(() => {
							void this.plugin.updateCategoryColor(category.id, COLORS[colorName as keyof typeof COLORS]);
						});
				});
			});

			menu.showAtPosition({ x: event.clientX, y: event.clientY });
		});


		// Category Header
		const catHeader = catBlock.createEl('div', { cls: 'stb-category-header' });
		
		// Drag Handle
		const dragHandle = catHeader.createEl('div', { cls: 'stb-drag-handle clickable-icon' });
		setIcon(dragHandle, 'grip-vertical'); // 'grip-vertical' looks like 6 dots usually

		// 1. Chevron
		const chevron = catHeader.createEl('div', { cls: 'stb-cat-chevron clickable-icon' });
		setIcon(chevron, category.isCollapsed ? 'chevron-right' : 'chevron-down');
		chevron.addEventListener('click', (e) => {
			e.stopPropagation(); // prevent other clicks
			void this.plugin.updateCategoryCollapse(category.id, !category.isCollapsed);
		});

		// 2. Title (Editable)
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
	
		// 3. Add Task Button
		const addTaskHeaderBtn = catHeader.createEl('div', { cls: 'stb-cat-add-btn clickable-icon' });
		setIcon(addTaskHeaderBtn, 'plus');
		addTaskHeaderBtn.setAttribute('aria-label', 'Add task');

		// Spacer
		catHeader.createEl('div', { cls: 'stb-spacer' });

		// 4. Sort Button
		const sortBtn = catHeader.createEl('div', { cls: 'stb-cat-sort-btn clickable-icon' });
		setIcon(sortBtn, 'arrow-up-down');
		sortBtn.setAttribute('aria-label', 'Sort tasks by date');
		sortBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.sortCategoryTasks(category.id);
		});

		// 5. Delete Category Button
		const deleteCatBtn = catHeader.createEl('div', { cls: 'stb-delete-cat-btn clickable-icon' });
		setIcon(deleteCatBtn, 'trash');
		deleteCatBtn.setAttribute('aria-label', 'Delete category');
		deleteCatBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new ConfirmModal(this.app, `Are you sure you want to delete category "${category.name}"?`, () => {
				void this.deleteCategory(category.id);
			}).open();
		});

		// Tasks List (Body)
		if (!category.isCollapsed) {
			const tasksList = catBlock.createEl('div', { cls: 'stb-tasks-list' });
			category.tasks.forEach(task => {
				this.renderTask(tasksList, category, task);
			});

			// Inline Add Task Logic
			const inlineContainer = catBlock.createEl('div', { cls: 'stb-add-task-inline' });
			inlineContainer.hide(); // Hidden by default

			const showInput = () => {
				inlineContainer.show();
				inlineContainer.empty();
				
				const wrapper = inlineContainer.createEl('div', { cls: 'stb-inline-input-wrapper' });
				wrapper.style.position = 'relative'; // CRITIQUE pour le positionnement absolu du calendrier
				
				const input = wrapper.createEl('input', { type: 'text', placeholder: 'New task...' });
				input.focus();

				// Date Picker Icon
				const dateBtn = wrapper.createEl('div', { cls: 'stb-inline-date-btn clickable-icon' });
				setIcon(dateBtn, 'calendar');
				
				// Hidden Date Input
				const dateInput = wrapper.createEl('input', { type: 'date', cls: 'stb-hidden-date-input' });
				dateInput.hide(); // Ensure hidden initially

				dateBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					
					// Calculer position du bouton par rapport au wrapper
					const btnRect = dateBtn.getBoundingClientRect();
					const wrapperRect = wrapper.getBoundingClientRect();
					
					// Positionner l'input sous le bouton
					dateInput.style.position = 'absolute';
					dateInput.style.top = `${btnRect.bottom - wrapperRect.top + 4}px`;
					dateInput.style.left = `${btnRect.left - wrapperRect.left}px`;
					dateInput.style.zIndex = '1000';
					
					dateInput.show();
					
					// Ouvrir le picker natif
					if ('showPicker' in HTMLInputElement.prototype) {
						try {
							(dateInput as HTMLInputElement & { showPicker(): void }).showPicker();
						} catch {
							dateInput.focus();
						}
					} else {
						dateInput.focus();
					}
				});
				
				// Update icon style when date is selected
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
				
				// Only blur if we are not clicking the date stuff
				// This is tricky because blur happens before click.
				// We can use a small timeout or check relatedTarget
				input.addEventListener('blur', (e) => {
					// Check if focus moved to date input or button
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
        taskRow.style.position = 'relative';

        // ============================================================
        // 1. TOUT À GAUCHE : LE SCRATCHPAD (NOUVEL EMPLACEMENT)
        // ============================================================
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

        // 2. ENSUITE : La Checkbox
        const checkbox = taskRow.createEl('input', { type: 'checkbox' });
        checkbox.checked = task.completed;
        checkbox.addEventListener('change', () => {
            void this.toggleTask(category.id, task.id, checkbox.checked);
        });

        // 3. ENSUITE : Le Texte
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

        // 4. À DROITE : Le reste des actions (Calendrier, Date, X)
        const rightActions = taskRow.createEl('div', { cls: 'stb-task-right-actions' });

        // Badge de date
        if (task.dueDate) {
            const formattedDate = this.formatDate(task.dueDate);
            const dateBadge = rightActions.createEl('span', { cls: 'stb-date-badge', text: formattedDate });
            
            // Correction Minuit : window.moment()
            const todayStr = window.moment().format('YYYY-MM-DD');
            if (task.dueDate < todayStr) dateBadge.addClass('is-overdue');
            else if (task.dueDate === todayStr) dateBadge.addClass('is-today');
        }

		    // Bouton Calendrier
        	const dateEditBtn = rightActions.createEl('div', { cls: 'stb-task-date-btn clickable-icon' });
        	setIcon(dateEditBtn, 'calendar');

        // Bouton Supprimer
        const deleteBtn = rightActions.createEl('div', { cls: 'stb-delete-task-btn clickable-icon' });
        setIcon(deleteBtn, 'x');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.plugin.settings.confirmTaskDeletion) {
                new ConfirmModal(this.app, "Delete this task?", async () => {
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

        // 5. INPUT CACHÉ (Pour le calendrier)
        const dateEditInput = taskRow.createEl('input', { type: 'date', cls: 'stb-hidden-date-input' });
        if (task.dueDate) dateEditInput.value = task.dueDate;

        // On réutilise l'astuce du survol pour éviter le bug du haut à gauche
        const updateInputPosition = () => {
            const btnRect = dateEditBtn.getBoundingClientRect();
            const rowRect = taskRow.getBoundingClientRect();
            if (btnRect.width > 0) {
                dateEditInput.style.top = `${btnRect.bottom - rowRect.top + 4}px`;
                dateEditInput.style.left = `${btnRect.left - rowRect.left}px`;
            }
        };

        taskRow.addEventListener('mouseenter', updateInputPosition);
        
        // Context Menu for Duplicate
        taskRow.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
            const menu = new Menu();
            
            menu.addItem((item) => {
                item.setTitle("Duplicate Task")
                    .setIcon("copy")
                    .onClick(() => {
                        void this.plugin.duplicateTask(category.id, task.id);
                    });
            });

            menu.showAtPosition({ x: event.clientX, y: event.clientY });
        });

        dateEditBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            updateInputPosition();
            if ('showPicker' in HTMLInputElement.prototype) {
                try { (dateEditInput as any).showPicker(); } 
                catch { dateEditInput.focus(); }
            } else {
                dateEditInput.focus();
            }
        });

        dateEditInput.addEventListener('change', async () => {
            if (dateEditInput.value !== task.dueDate) {
                await this.plugin.updateTaskDate(category.id, task.id, dateEditInput.value);
                this.refresh();
            }
        });
    }

	// Fonction utilitaire pour l'édition de texte en ligne
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

    // Tri des tâches d'une catégorie par date
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

        // --- CORRECTION : Sauvegarde selon le contexte ---
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
		new Notice("All categories sorted alphabetically (A-Z)");
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
				task.completed = completed;
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
		contentEl.createEl("h2", { text: "Add new category" });

		const nameDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		nameDiv.createEl("label", { text: "Category name" });
		const nameInput = nameDiv.createEl("input", { type: "text" });

		const taskDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		taskDiv.createEl("label", { text: "First task name" });
		const taskInput = taskDiv.createEl("input", { type: "text" });

		const dateDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		dateDiv.createEl("label", { text: "Due date (optional)" });
		const dateInput = dateDiv.createEl("input", { type: "date" });

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		const submitBtn = buttonDiv.createEl("button", { text: "Create", cls: "mod-cta" });

		submitBtn.addEventListener("click", () => {
			const name = nameInput.value.trim();
			const task = taskInput.value.trim();
			const date = dateInput.value;
			
			if (!name || !task) {
				new Notice("Both fields are required.");
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
		contentEl.createEl("h3", { text: "Task scratchpad" });

		const textarea = contentEl.createEl("textarea", { 
			cls: 'stb-scratchpad-textarea',
			text: this.initialText 
		});
		textarea.placeholder = "Write your notes here...";
		
		// Auto-focus and place cursor at end
		textarea.focus();
		textarea.setSelectionRange(this.initialText.length, this.initialText.length);

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		const saveBtn = buttonDiv.createEl("button", { text: "Save", cls: "mod-cta" });
		const cancelBtn = buttonDiv.createEl("button", { text: "Cancel" });

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
		contentEl.createEl("h2", { text: "Setup Shared Mode" });

		const pathDiv = contentEl.createDiv({ cls: 'stb-modal-field' });
		pathDiv.createEl("label", { text: "Shared File Path" });
		
		const pathInput = pathDiv.createEl("input", { type: "text" });
		pathInput.value = this.plugin.settings.sharedFilePath || '';
		pathInput.disabled = true;
		pathInput.style.width = '100%';

		const buttonDiv = contentEl.createDiv({ cls: 'stb-modal-actions' });
		buttonDiv.style.marginTop = '10px';
		
		const browseBtn = buttonDiv.createEl("button", { text: "Browse...", cls: "mod-cta" });
		const createBtn = buttonDiv.createEl("button", { text: "Create New File" });
		const cancelBtn = buttonDiv.createEl("button", { text: "Cancel" });

		const handleFileSelection = async (filePath: string) => {
			pathInput.value = filePath;
			this.plugin.settings.sharedFilePath = filePath;
			await this.plugin.saveSettings();
			this.close();
			this.plugin.refreshViews();
			new Notice("Shared mode enabled with: " + filePath);
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
				new Notice("Native file picker not available. Falling back to manual input.");
				pathInput.disabled = false;
				pathInput.focus();
				
				// Change browse button to "Save" for manual input
				browseBtn.setText("Save Path");
				browseBtn.replaceWith(browseBtn.cloneNode(true)); // Remove listeners
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
				new Notice("Error creating file: " + e);
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
		const confirmBtn = buttonDiv.createEl("button", { text: "Confirm", cls: "mod-warning" });
		const cancelBtn = buttonDiv.createEl("button", { text: "Cancel" });

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