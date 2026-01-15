**Simple tasks blocks** is a standalone task manager for Obsidian that lives in your sidebar. It offers a unique dual-storage system (local vault or shared JSON file) for seamless cross-vault synchronization, featuring intuitive category blocks, recurring tasks, and full multilingual support.

## The power of two modes

The core strength of this plugin is its flexibility in how your data is stored:

* **Local mode**: Tasks are stored within your current vault settings. Perfect for private, vault-specific organization.
* **Shared mode (Cross-vault sync)**: Link the plugin to an external JSON file anywhere on your computer. This allows you to **synchronize the same task list across multiple Obsidian vaults** in real-time.

![](Medias/Local_and_shared_modes.gif)


## Key features

* **Standalone management**: Tasks are stored internally or in a shared file; they never clutter your Markdown notes.

![](Medias/Quick_add_modify_tasks.gif)

![](Medias/Delete_tasks.gif)

* **Categorized and movable blocks**: Group your tasks into clean, rounded blocks. Easily reorder them using the vertical drag handle.

![](Medias/Customize_categories.gif)

* **Optional due dates and Advanced recurrence**: Set up daily, weekly, monthly, or custom intervals with the ability to skip occurrences or set end dates.

![](Medias/Due_dates.gif)

![](Medias/Recurring_tasks.gif)

* **Task scratchpad**: Each task has its own dedicated note area for detailed information, accessible via a pop-up window.

![](Medias/Scratchpad.gif)

* **Smart sorting & Visual alerts**: Tasks are sorted chronologically. Overdue tasks and tasks due today are automatically highlighted.
* **Multilingual support**: Fully localized in English, French, Italian, Spanish, and German.
* **Highly customizable**:
    * Change block colors via a right-click menu.
    * Duplicate tasks within a block.
    * Configure date formats (DD-MM-YYYY or YYYY-MM-DD).
    * Adjust the number of future recurring dates displayed (up to 15).

## How to use

1. Open the **Simple tasks blocks** view from the ribbon icon (`list-checks`).
2. **Choose your mode**: Go to the settings icon in the view header to toggle between Local and Shared storage.
3. Click **+ category** to create your first block.
4. Add tasks and manage their dates or recurrence using the interactive icons if you need.

## How to Use: Shared Storage Setup

The Shared Mode allows you to synchronize your tasks across different Obsidian vaults in real-time using a single JSON file.

1. Toggle Mode in the Header: Open the plugin in the sidebar. You will find the Local / Shared switch directly in the plugin header (at the top of the view).
2. Activate Shared Mode: Click the toggle to switch from Local to Shared.
3. Select your JSON file:

    - A file selection window will open automatically.
    - Choose a location outside your vault if you want to sync with other vaults.
    - Name or select your sync file (e.g., tasks-sync.json).

4. Connect other vaults: Install the plugin in your other vaults.

5. Use the header toggle to switch to Shared Mode and select the exact same tasks-sync.json file.

Real-time Sync: Any change made in one vault will now instantly reflect in all connected vaults.

## Installation

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest **release**.
2. Create a folder named `simple-tasks-blocks` in your vault's `.obsidian/plugins/` directory.
3. Move the downloaded files into that folder.
4. Reload Obsidian and enable the plugin in the settings.

## License

This project is licensed under the MIT License.