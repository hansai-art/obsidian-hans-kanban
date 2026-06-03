# Hans 看板 (hans-kanban) 設計文件

日期：2026-06-03
狀態：設計定案，分階段實作中

## 1. 目標

以 MIT 授權的 `xiwcx/obsidian-bases-kanban`（Kanban Bases View）為基底，fork 出一個自用、之後可發佈的客製版 Obsidian 外掛，主要加上：

1. 繁體中文 UI
2. 卡片依任意欄位值整卡上色
3. 卡片上內建下拉，直接切換狀態（如 phase），切換後顏色即時變更
4. 欄寬全域 slider 設定
5. 每欄獨立寬度（欄邊拖拉）
6. list / 多行欄位原生條列換行（不靠 CSS snippet）
7. 卡片版型自訂（顯示哪些欄位、順序、字級）

驅動需求來自知識衛星課程製作看板（49 份講義，依章節分欄、phase 五階段）。

## 2. 授權與身分

- Fork 來源：`xiwcx/obsidian-bases-kanban`，MIT，Copyright (c) 2026 I. Welch Canavan
- 義務：保留原 LICENSE 與版權聲明；README 註明 fork 來源與改動
- 新身分（避免與原版並存衝突）：
  - plugin id：`hans-kanban`
  - 顯示名稱：`Hans 看板`
  - Bases view type：`hans-kanban-view`（原為 `kanban-view`）
  - hover source id：`hans-kanban`
- 遷移：現有 `.base` 的 `type: kanban-view` 改為 `type: hans-kanban-view`；停用原版外掛

## 3. 技術現況（上游架構）

- 語言 TypeScript，build：`tsc -noEmit` + esbuild → `dist/{main.js,manifest.json,styles.css}`
- 入口 `src/main.ts`：`registerBasesView(KANBAN_VIEW_TYPE, {...})`
- 主要檔：
  - `src/kanbanView.ts`：view 類別、`getViewOptions`（設定項）、config 讀寫（存於 `.base` 的 BasesViewConfig）
  - `src/components/card.ts`：卡片渲染（功能主要落點）
  - `src/components/column.ts` / `row.ts`：欄 / 泳道
  - `src/constants.ts`：id、CSS class、COLOR_PALETTE（Obsidian `--color-*` 變數）
- 設定持久化：per-base（寫進 `.base` 檔），非 plugin data.json
- 拖拉用 sortablejs

## 4. 功能設計

### 4.1 i18n（P1）
- 新增 `src/i18n/index.ts` + `zh-TW.ts` / `en.ts` 字典與 `t(key)`
- 偵測 Obsidian 語系（`window.localStorage.getItem('language')`），預設 `zh-TW`
- 所有 `getViewOptions` 的 displayName、按鈕、選單、Notice 走 `t()`

### 4.2 卡片依欄位上色 + 卡片內下拉切換（P2，核心）
- 新 view 設定：
  - `colorByProperty`：driver 欄位（property id，如 `note.phase`）
  - `valueColors`：`{ [value: string]: ColorName }` 值→顏色，存 view config
  - `inlineSelectProperty`：卡片上可下拉切換的欄位（通常同 `colorByProperty`）
  - `inlineSelectValues`：該欄位允許值清單（若空，從 `valueColors` keys 推）
- 卡片渲染：
  - 整卡背景 = `color-mix(in srgb, var(--color-X) 15%, var(--background-secondary))`（淡染，文字仍可讀），左側或邊框可選加重
  - 卡片頂部 region 放一個 `<select>`（class `obk-card-inline-select`）顯示目前值；`change` → `app.fileManager.processFrontMatter(file, fm => fm[prop]=value)` 寫回 → 重繪該卡顏色
  - 寫回後依賴既有 onDataUpdated 流程刷新；只重繪受影響卡片
- 設定面板：`valueColors` 用「值 + 色票」逐列編輯（沿用既有 column color popover 元件）

### 4.3 寬度（P3）
- 全域：`columnWidth`（number px，預設 280），設定面板 slider（200–480）；套用為 board CSS 變數 `--obk-column-width`
- 每欄：`columnWidths`：`{ [columnValue: string]: number }`；欄右緣加拖拉手柄（class `obk-column-resize-handle`），拖動即時寫 config；雙擊清除回全域值
- CSS：`.obk-column { flex: 0 0 var(--obk-col-w, var(--obk-column-width)); }`，每欄 inline style 設 `--obk-col-w`

### 4.4 list 原生條列換行（P4）
- 偵測值為陣列或含換行字串時，外掛自建 DOM：每項一個 `.obk-card-list-item`（`display:block`），前綴 bullet
- 不再依賴 Bases `renderTo` 的空白併行；移除對 CSS snippet 的依賴

### 4.5 卡片版型自訂（P4）
- `cardProperties`：有序的顯示欄位清單（取代僅用 `order`）
- `cardFontScale`：字級倍率（如 0.9 / 1.0 / 1.1）
- 設定面板可勾選 / 排序顯示欄位

### 4.6 階段色點（P4，B）
- 有整卡上色後，色點變選用：`showValueDot`（bool）在 inline select 前加一個對應顏色圓點

## 5. 開發 / Build 分工

- repo：`~/src/hans-kanban/`（git，已 clone 上游）
- 沙箱限制：`npm install` / build 會執行第三方腳本，AI 沙箱會擋 → **由 Hans 在終端機跑**
- 流程：
  1. AI 寫 / 改 TS 與設定檔
  2. Hans 跑 `npm install`（首次）、`npm run build`
  3. `scripts/dev-install.sh` 把 `dist/*` 複製進 vault `.obsidian/plugins/hans-kanban/`
  4. Obsidian `Cmd+R`，Hans 驗收
- 每階段一次 build + 驗收

## 6. 分階段與驗收

| 階段 | 內容 | 驗收 |
|---|---|---|
| P0 | fork、改身分、dev-install 腳本、原樣跑通 | 看板能開、與原版行為一致 |
| P1 | 繁中 i18n | 設定面板全中文 |
| P2 | 卡片依欄位上色 + 卡片內下拉切換 + 即時變色 | 卡片點下拉換 phase、顏色即時變 |
| P3 | 全域 slider + 每欄拖拉寬度 | 拉一下變寬；單欄可各自設 |
| P4 | list 原生條列 + 版型自訂 + 色點 | 不靠 CSS snippet 就換行；可選顯示欄位 |

## 7. 非目標（YAGNI）

- 不做官方社群上架審核（之後再升級）
- 不重寫 Bases 整合 / 拖拉引擎（沿用上游）
- 不支援多 vault 同步設定（per-base 已足夠）
