# 小說翻譯編輯器（novel-translate-editor）

協助小說翻譯工作的 VSCode 套件。核心功能（開發中，見 [PLAN.md](PLAN.md) 完整路線圖）：

- 作品（小說）管理
- 作品專屬詞彙表（名詞／片語）管理，並掛入 IDE 自動完成
- 原文／譯文比對框（雙欄編輯器＋捲動同步）
- 翻譯筆記（使用 VSCode 原生留言功能）

目前狀態：**Phase 0 — 基礎套件骨架**。側邊欄與指令已就位，實際業務邏輯尚未實作。

## 開發方式

```bash
npm install
```

按 `F5` 啟動「Extension Development Host」，即可在新視窗的活動列看到「小說翻譯」圖示，側邊欄有「作品總管」與「詞彙表」兩個 View。

其他指令：

```bash
npm run compile      # 使用 esbuild 打包一次
npm run watch        # 監看並自動重新打包
npm run check-types  # TypeScript 型別檢查
npm run lint         # ESLint 檢查
```

## 發佈前待辦

- `package.json` 的 `publisher` 欄位目前是 placeholder，正式發佈前需改成實際的 Marketplace publisher id。
