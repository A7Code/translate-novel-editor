# 開發文件

本文件給要參與開發、除錯或打包此 VSCode 套件的人閱讀。使用者端的安裝與操作教學請見 [USER_GUIDE.md](USER_GUIDE.md)；完整功能開發路線圖請見 [PLAN.md](../PLAN.md)。

## 技術棧

- TypeScript
- esbuild（打包）
- VSCode Extension API（`engines.vscode` 需求版本見 `package.json`）

## 環境需求

- Node.js（建議與專案 `devDependencies` 中 `@types/node` 對應的 LTS 版本）
- VSCode（`^1.90.0` 以上，用於偵錯執行）

## 安裝依賴

```bash
npm install
```

## 啟動開發模式

本倉庫（`translate_novel_editor/`）巢狀在實際的 VSCode 工作區資料夾 `c:/A7WorkForm/translate_novel_editor/` 裡面一層。偵錯用的 `.vscode/launch.json`、`tasks.json` 放在**外層**工作區資料夾，不屬於本倉庫管理範圍；`launch.json` 的「執行擴充功能」設定會把 `extensionDevelopmentPath` 指到 `${workspaceFolder}/translate_novel_editor`。

因此要偵錯時，請在 VSCode 開啟外層資料夾 `c:/A7WorkForm/translate_novel_editor`（而不是直接開本倉庫），再按 `F5`（或在「執行與偵錯」面板選擇對應設定）啟動「Extension Development Host」。VSCode 會開啟一個新視窗，在該視窗的活動列可看到「小說翻譯」圖示，側邊欄會載入「作品總管」與「詞彙表」兩個 View。

修改原始碼後，若搭配外層工作區的「Watch (compile on save)」背景工作（對應本倉庫的 `npm run watch`）自動重新打包，在 Development Host 視窗按 `Ctrl+R`（重新載入視窗）即可套用變更，不需每次重新按 `F5`。

## 常用指令

```bash
npm run compile      # 使用 esbuild 打包一次
npm run watch        # 監看並自動重新打包
npm run check-types  # TypeScript 型別檢查（不產生輸出）
npm run lint         # ESLint 檢查 src/
npm run test         # 執行測試（vscode-test）
```

`pretest` 會在測試前自動執行 `compile` 與 `lint`。

## 專案結構

```
src/
  extension.ts                  # 套件進入點：註冊 TreeDataProvider 與指令
  types.ts                      # ProjectConfig / WorkConfig / ChapterConfig 型別定義
  services/
    projectStore.ts             # 讀寫 .novel-translate/project.json、建立成對原文/譯文純文字檔
  commands/
    workCommands.ts             # 建立作品、新增章節、匯入文字檔、開啟章節譯文的指令邏輯
  views/
    workTreeProvider.ts         # 「作品總管」View：讀取 ProjectStore 顯示作品 → 章節
    glossaryTreeProvider.ts     # 「詞彙表」View 的資料來源（目前回傳空陣列，Phase 3 才會實作）
resources/
  icon.svg                      # Activity Bar 圖示
```

`package.json` 的 `contributes` 區塊定義了：

- `viewsContainers.activitybar`：側邊欄容器「小說翻譯」
- `views.novelTranslate`：兩個 View（`novelTranslate.works`、`novelTranslate.glossary`）
- `viewsWelcome`：作品總管在無資料時顯示的提示文字
- `commands`：`novelTranslate.createWork`、`novelTranslate.addChapter`、`novelTranslate.importChapterFile`、`novelTranslate.openChapterTranslation`、`novelTranslate.refreshWorks`、`novelTranslate.openCompareView`
- `menus`：作品項目的右鍵選單（新增章節／匯入文字檔）、章節項目的右鍵選單（開啟比對）、View 標題列的建立作品／重新整理按鈕
- `languages` / `configurationDefaults`：自訂語言模式 `novel-translation`，並關閉其 `editor.wordBasedSuggestions`，為後續詞彙表自動完成功能鋪路

作品管理（Phase 1）已實作完成：`novelTranslate.createWork`、`addChapter`、`importChapterFile`、`openChapterTranslation` 都是真正的邏輯，資料持久化在工作區的 `.novel-translate/project.json`。`novelTranslate.openCompareView` 目前仍是 `showInformationMessage`（stub），對應 `PLAN.md` 的 Phase 2 尚未開工；多工作區資料夾僅取第一個（`workspaceFolders[0]`），這是目前已知的簡化限制。

## 打包發佈

```bash
npm run package-vsix
```

會呼叫 `vsce package` 並將產出的 `.vsix` 放到 `releases/` 目錄。

### 發佈前待辦

- `package.json` 的 `publisher` 欄位目前是 placeholder（`your-publisher-id`），正式發佈到 Marketplace 前需改成實際的 publisher id。
- 其餘打包發佈相關的收尾事項見 `PLAN.md` 的 Phase 6。

## 路線圖

完整的分階段開發計畫（Phase 0～6，含每階段的技術設計細節）記錄在 [PLAN.md](../PLAN.md)，之後接續開發時請以該文件為準，並隨進度更新。
