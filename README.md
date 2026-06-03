# Hans Kanban

繁體中文 ｜ [English below](#english)

把 Obsidian 的筆記變成一塊「看板」：像便利貼一樣分欄排列，拖一拖就能更新進度。適合管理影片製作、待辦事項、寫作進度、任何「有不同階段」的工作。

> **這是 fork 版本**：Hans Kanban 改自 [Kanban Bases View](https://github.com/xiwcx/obsidian-bases-kanban)（作者 I. Welch Canavan，MIT 授權），加上繁體中文介面、卡片依狀態上色與切換、可調欄寬、極簡模式等功能。原作者版權保留於 [LICENSE](LICENSE)。

---

## 新手教學：從零開始（跟著做就會）

完全沒用過也沒關係，照下面四步走一遍就上手了。

### 第 1 步：先裝一個叫 BRAT 的小工具

這個外掛還沒上架官方商店，要透過 **BRAT** 來安裝（BRAT 是社群常用的安裝小幫手，一次裝好以後就能自動更新）。

1. 打開 Obsidian → 左下角齒輪 **設定**
2. 點 **第三方外掛**（Community plugins）→ **瀏覽**（Browse）
3. 搜尋 **BRAT** → 安裝 → 啟用

### 第 2 步：用 BRAT 安裝 Hans Kanban

1. 按 `Cmd/Ctrl + P` 打開指令面板
2. 輸入並選擇：**BRAT: Add a beta plugin for testing**
3. 在欄位貼上這一行網址：
   ```
   hansai-art/obsidian-hans-kanban
   ```
4. 按確定，BRAT 會自動下載安裝
5. 回到 **設定 → 第三方外掛**，把 **Hans Kanban** 打開（啟用）

✅ 裝好了。接下來做你的第一塊看板。

### 第 3 步：準備幾則「有狀態」的筆記

看板要能分欄，每則筆記得有一個欄位告訴它「現在在哪一欄」。最簡單的做法是在筆記最上面加一段「屬性」。

新建一則筆記，最上面貼這幾行（兩條 `---` 中間就是屬性區）：

```
---
狀態: 待辦
---
```

下面再寫筆記內容就好。多做幾則，把 `狀態` 填成不同值，例如 `待辦`、`進行中`、`完成`。

> 小提醒：`狀態` 是欄位名稱，你也可以叫它 `階段`、`status` 都行，等一下分欄會用到它。

### 第 4 步：建立看板，看著筆記自動分欄

1. 新建一個 **Base**：指令面板輸入 **Create new base**，或在資料夾按右鍵新增
2. 在 Base 右上角加一個**視圖**，視圖類型選 **Hans Kanban**
3. 在視圖設定的 **Group by（依此分欄）** 選你剛剛的 `狀態`
4. 畫面就會出現「待辦 / 進行中 / 完成」三欄，你的筆記各就各位

🎉 完成！現在把卡片從「待辦」拖到「進行中」，那則筆記的 `狀態` 就自動改好了。

---

## 上手後的貼心功能

- **幫卡片上顏色**：在視圖設定的 **Card color** 選 `狀態`，每一欄的卡片就會有對應顏色。若值的開頭放一個顏色圓點 emoji（例如 `🔴 待辦`、`🟢 完成`），會自動配上紅、綠等顏色。
- **直接在卡片上換狀態**：卡片上有個小下拉選單，點一下就能換階段，顏色立刻跟著變，不用拖。
- **整欄換色**：點欄位標題旁的小圓點可以指定該欄顏色，整欄（外框＋底色）都會跟著變。
- **調整欄寬**：用滑桿一次調整全部欄寬，或拖某一欄的右邊界單獨調整（雙擊還原）。
- **極簡模式**：工具列上的「極簡」鈕，一鍵把卡片上的屬性標籤藏起來，畫面更清爽。

---

## English

Turn your Obsidian notes into a kanban board: cards in columns you can drag between to update progress. Great for tracking video production, to-dos, writing, or anything with stages.

> **This is a fork** of [Kanban Bases View](https://github.com/xiwcx/obsidian-bases-kanban) by I. Welch Canavan (MIT), adding a Traditional Chinese UI, status-based card colors and switching, adjustable column widths, and a minimal mode. Original copyright is kept in [LICENSE](LICENSE).

### Quick start (beginner friendly)

**1. Install BRAT** (a small helper that installs and auto-updates plugins not yet in the store):
Settings → Community plugins → Browse → search **BRAT** → Install → Enable.

**2. Install Hans Kanban via BRAT:**
Command palette (`Cmd/Ctrl + P`) → **BRAT: Add a beta plugin for testing** → paste `hansai-art/obsidian-hans-kanban` → confirm. Then enable **Hans Kanban** in Settings → Community plugins.

**3. Give a few notes a status property.** Add this to the top of a note (the part between the two `---` lines):

```
---
status: To Do
---
```

Make a few notes with values like `To Do`, `Doing`, `Done`.

**4. Build the board:** Create a Base → add a view → pick **Hans Kanban** as the type → set **Group by** to `status`. Columns appear automatically. Drag a card to another column and its `status` updates.

### Nice extras

- **Card color**: set **Card color** to your status property; a leading color emoji (🔴/🟢) maps to that color automatically, otherwise a stable palette is used.
- **On-card switch**: a dropdown on each card switches the value and recolors instantly.
- **Whole-column color**: pick a color from the dot next to a column title; the outline and body tint to match.
- **Column width**: a global slider, plus a per-column drag handle (double-click to reset).
- **Minimal mode**: a toolbar toggle hides per-card property labels for a cleaner board.

## Development

```bash
npm install      # install dependencies
npm run build    # type-check + build to dist/
npm run dev      # watch and rebuild
npm test         # run the test suite
npm run lint     # eslint
```

The plugin uses the `.obk-` CSS class prefix to avoid collisions with other plugins and themes.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

- Forked from [Kanban Bases View](https://github.com/xiwcx/obsidian-bases-kanban) by I. Welch Canavan (MIT).
- Built with [SortableJS](https://sortablejs.github.io/Sortable/) for drag-and-drop.
