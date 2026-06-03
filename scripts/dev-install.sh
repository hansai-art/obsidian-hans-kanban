#!/usr/bin/env bash
# Build hans-kanban and copy the artifacts into the Obsidian vault for testing.
set -euo pipefail

VAULT_PLUGIN="/Users/jugang11/Documents/Obsidian Vault/.obsidian/plugins/hans-kanban"

cd "$(dirname "$0")/.."

echo "▶ building..."
npm run build

mkdir -p "$VAULT_PLUGIN"
cp dist/main.js dist/manifest.json dist/styles.css "$VAULT_PLUGIN/"

echo "✅ 已安裝到：$VAULT_PLUGIN"
echo "   下一步：Obsidian → 設定 → 第三方外掛 啟用「Hans 看板」，再按 Cmd+R 重載。"
