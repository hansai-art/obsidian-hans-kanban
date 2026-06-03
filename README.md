# Hans Kanban

繁體中文 ｜ [English below](#english)

Obsidian Bases 的看板（Kanban）自訂視圖：把筆記依任一屬性分欄，拖放管理進度。

> **Fork 說明**：Hans Kanban 是 [Kanban Bases View](https://github.com/xiwcx/obsidian-bases-kanban)（作者 I. Welch Canavan）的 fork，依 MIT 授權使用。在原版之上加了繁體中文介面、依狀態為卡片上色與卡上切換、可調欄寬、極簡模式與內建條列換行。原作者版權保留於 [LICENSE](LICENSE)。

## 這個 fork 新增的功能

- **繁體中文介面**：所有視圖文字繁中化（依 Obsidian 語系自動偵測，無對應時回退英文）
- **卡片依狀態上色**：依任一屬性值為卡片上色（開頭是顏色 emoji 如 🔴/🟢 會自動對應，否則用穩定色盤），卡片上附下拉選單可直接切換該值並即時變色
- **整欄套色**：欄位指定的顏色會延伸到外框與 body 淡色底，不只 header，整欄都反映該顏色
- **可調欄寬**：全域欄寬滑桿 + 每欄右緣拖曳把手（雙擊還原），依 base 記憶
- **極簡模式**：停靠在原生 Bases 工具列的切換鈕，隱藏卡片屬性標籤，畫面更乾淨
- **條列自動換行**：長條列屬性值原生換行，不需額外 CSS snippet

## 安裝（透過 BRAT）

本外掛目前以 GitHub Release 發布，用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安裝即可，並可隨新版自動更新：

1. 在 Obsidian 社群外掛安裝並啟用 **BRAT**
2. BRAT 指令：`Add a beta plugin for testing`
3. 貼上：`hansai-art/obsidian-hans-kanban`
4. 安裝後在「設定 → 第三方外掛」啟用 **Hans Kanban**

手動安裝：到 [Releases](https://github.com/hansai-art/obsidian-hans-kanban/releases) 下載 `main.js`、`manifest.json`、`styles.css`，放到 vault 的 `.obsidian/plugins/hans-kanban/`，重新載入並啟用。

## 使用

1. 開啟或建立一個 Base，新增一個視圖並選 **Hans Kanban**
2. 在 **Group by** 選要分欄的屬性（例如「狀態」），筆記會依該屬性值自動分欄
3. 拖放卡片即可更新該屬性值；沒有值的筆記會集中在「未分類」欄
4. 想讓卡片依狀態上色：在 **Card color** 選對應屬性；用 **Card color order** 指定完整選項與順序
5. 拖曳欄位右緣調整單欄寬度，或用欄寬滑桿一次調整全部
6. 點工具列「極簡」鈕隱藏卡片屬性標籤

---

## English

A kanban-style, drag-and-drop custom view for Obsidian Bases that organizes notes into columns by any property.

> **Fork notice.** Hans Kanban is a fork of [Kanban Bases View](https://github.com/xiwcx/obsidian-bases-kanban) by I. Welch Canavan, used under the MIT License. It adds a Traditional Chinese UI, status-driven card colors with an on-card switcher, adjustable column widths, a minimal (zen) mode, and native bullet wrapping on top of the original. The original copyright is retained in [LICENSE](LICENSE).

### Added in this fork

- **Traditional Chinese UI**: All view strings are localized (zh-TW) with English fallback, detected from Obsidian's language setting
- **Card color by status**: Tint cards by any property's value (a leading color emoji like 🔴/🟢 maps automatically, otherwise a stable palette), with an on-card dropdown to switch the value and recolor instantly
- **Column color throughout**: A column's assigned color carries past the header to its outline and a soft body wash, so the whole column reads as that color
- **Adjustable column width**: A global width slider plus a per-column drag handle (double-click to reset), persisted per base
- **Minimal (zen) mode**: A toggle docked in the native Bases toolbar that hides per-card property labels for a cleaner board
- **Native bullet wrapping**: Long bulleted property values wrap cleanly without a custom CSS snippet

### Installation (via BRAT)

This plugin is distributed via GitHub Releases. Install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat) to get automatic updates:

1. Install and enable **BRAT** from the community plugins
2. Run the BRAT command `Add a beta plugin for testing`
3. Paste `hansai-art/obsidian-hans-kanban`
4. Enable **Hans Kanban** under Settings → Community plugins

Manual install: download `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/hansai-art/obsidian-hans-kanban/releases) page into your vault's `.obsidian/plugins/hans-kanban/`, then reload and enable.

### Usage

1. Open or create a Base, add a view, and select **Hans Kanban**
2. Pick the column property under **Group by** (e.g. "Status"); notes are grouped into columns by that property's values
3. Drag cards between columns to update the value; notes without a value land in an "Uncategorized" column
4. To color cards by status, choose the property under **Card color**, and use **Card color order** to define the full set and order of values
5. Drag a column's right edge to resize it, or use the width slider to adjust them all at once
6. Click the "極簡" (Minimal) toggle in the toolbar to hide per-card property labels

## Development

```bash
npm install      # install dependencies
npm run build    # type-check + build to dist/
npm run dev       # watch and rebuild
npm test         # run the test suite
npm run lint     # eslint
```

The plugin uses the `.obk-` CSS class prefix (Obsidian Bases Kanban) for all view UI classes to avoid collisions with other plugins and themes.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

- Forked from [Kanban Bases View](https://github.com/xiwcx/obsidian-bases-kanban) by I. Welch Canavan, used under the MIT License.
- Built with [SortableJS](https://sortablejs.github.io/Sortable/) for drag-and-drop.
