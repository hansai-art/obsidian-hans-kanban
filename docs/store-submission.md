# Obsidian 社群商店送審（已送出，2026-07-07）

> 狀態：**已送審**。community.obsidian.md 顯示「Your entry is live. An automated review is in progress.」（Version 1.3.1 / commit fbf1595 / Pending）。
> 管理頁：https://community.obsidian.md/account/plugins/hans-kanban
> 禮貌性知會 issue：https://github.com/xiwcx/obsidian-bases-kanban/issues/102
>
> **流程已改版（2026 現行）**：不再是 fork obsidian-releases 開 PR 改 community-plugins.json（該 repo PR 已關閉）。
> 現行 = community.obsidian.md 登入 Obsidian 帳號 + 連結 GitHub → Plugins → New plugin → 填 repo URL → 勾兩個同意（Developer Policies + 持續維護承諾）→ Submit。
> 之後審查回饋若要求修改：改 code 後 bump 版本發新 release，審查系統會抓最新版。
> 下方 PR 條目 / PR body 為舊流程遺留，僅留作 fork 差異化聲明與 bot 自查清單參考。

## community-plugins.json 條目

```json
{
	"id": "hans-kanban",
	"name": "Hans Kanban",
	"author": "Hans Lin",
	"description": "Kanban and masonry card views for Bases: whole-card coloring by property, on-card status switching, adjustable column widths, swimlanes, and a minimal mode. UI in English and Traditional Chinese. Fork of Kanban Bases View.",
	"repo": "hansai-art/obsidian-hans-kanban"
}
```

## PR 標題

```
Add plugin: Hans Kanban
```

## PR 說明（重點段落）

```markdown
# I am submitting a new Community Plugin

## Repo URL

https://github.com/hansai-art/obsidian-hans-kanban

## Release Checklist
- [x] I have tested the plugin on Windows / macOS (primary), and it declares `isDesktopOnly: false`
- [x] GitHub release `1.3.0` contains `main.js`, `manifest.json`, `styles.css`; tag matches `manifest.json` version
- [x] `README.md` describes the plugin's purpose and usage in English (Traditional Chinese section included)
- [x] MIT `LICENSE` present, original author's copyright retained

## Note on fork

This is a fork of [Kanban Bases View](https://github.com/xiwcx/obsidian-bases-kanban)
by I. Welch Canavan (MIT, already in the directory as `kanban-bases-view`),
published with the original author's copyright retained in LICENSE and an
attribution section in the README.

It is submitted as a separate plugin because it has grown into a
substantially different feature set:

- Whole-card coloring by property value with a managed option list
  (rename / recolor / delete, usage counts)
- On-card status dropdown that rewrites frontmatter and recolors instantly
- Swimlanes (two-axis grouping)
- Masonry card-wall mode with automatic color-order + property sorting
- Global and per-column width controls
- Minimal mode and a hide-empty-columns view option
- Rename sync (renamed files keep their card position)
- Localized UI: Traditional Chinese + English (auto-detected)
```

## 送審前自查（bot 會自動檢查的硬規則）

- [x] `id` 全小寫、無 "obsidian" 字樣、與現有外掛不重複（已比對 2026-07-07 的 community-plugins.json）
- [x] `name` 無 "Obsidian" / "plugin" 字樣
- [x] description ≤ 250 字元、以句號結尾、無 "Obsidian"/"plugin" 字樣
- [x] manifest.json 的 id / name / author / description 與送審 JSON 完全一致
- [x] Release tag 無 `v` 前綴（現行最新 `1.3.0`；發版流程 = 改 manifest/package/versions.json 版本號 → push main → ci.yml 自動 tag + release）
- [x] `versions.json` 含 `"1.1.0": "1.10.2"`

## 已知審查風險與應答準備

1. **與原版重複**：用上方 fork 段落回應；必要時可補「原作者未回應合併意願」或直接 @ 原作者（Hans 決定要不要先打招呼，禮貌上建議先開 issue 知會）。
2. **monkey patch**（`installPropertySuggesterPatch` / `installWriteTimeAutoColor`）：若審查者問起，說明其必要性（Bases 原生 suggester 不吃自訂固定選項清單；寫入時自動配色需要攔截 frontmatter 寫入），且 plugin unload 時有對應 `restore*` 還原。
3. **名稱**：若審查者建議更描述性的名字，備案：`Kanban for Bases (zh-TW)`。改名只動 manifest `name`，`id` 不變。
