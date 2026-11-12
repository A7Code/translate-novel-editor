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

因此要偵錯時，請在 VSCode 開啟外層資料夾 `c:/A7WorkForm/translate_novel_editor`（而不是直接開本倉庫），再按 `F5`（或在「執行與偵錯」面板選擇對應設定）啟動「Extension Development Host」。VSCode 會開啟一個新視窗，在該視窗的活動列可看到「小說翻譯」圖示，側邊欄會載入「作品總管」「詞彙表」「設置」三個 View。

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
  extension.ts                  # 套件進入點：註冊 TreeDataProvider、指令與 CompletionItemProvider
  types.ts                      # ProjectConfig / WorkConfig / ChapterConfig / GlossaryEntry 型別定義
  constants.ts                  # TRANSLATION_LANGUAGE_ID 等共用常數
  services/
    projectStore.ts             # 讀寫 .novel-translate/project.json、建立成對原文/譯文純文字檔、詞彙表 CRUD
    compareScrollSync.ts        # 比對框雙欄的捲動同步（依行號對齊，取代內建鎖定捲動）
  commands/
    workCommands.ts             # 建立作品、新增章節、匯入文字檔的指令邏輯
    compareCommands.ts          # 開啟原文／譯文雙欄比對（唯讀＋行號同步捲動＋設定譯文語言模式）
    glossaryCommands.ts         # 新增/編輯/刪除詞條的指令邏輯
    languageModeCommands.ts     # 切換目前分頁語言模式（novel-translation ↔ plaintext）
  providers/
    glossaryCompletionProvider.ts  # novel-translation 語言的 CompletionItemProvider，來源是作品詞彙表
  views/
    workTreeProvider.ts         # 「作品總管」View：讀取 ProjectStore 顯示作品 → 章節
    glossaryTreeProvider.ts     # 「詞彙表」View：讀取 ProjectStore 顯示作品 → 詞條
    settingsTreeProvider.ts     # 「設置」View：目前只有一個同步捲動開關的核取方塊項目
resources/
  icon.svg                      # Activity Bar 圖示
```

`package.json` 的 `contributes` 區塊定義了：

- `viewsContainers.activitybar`：側邊欄容器「小說翻譯」
- `views.novelTranslate`：三個 View（`novelTranslate.works`、`novelTranslate.glossary`、`novelTranslate.settings`）
- `viewsWelcome`：作品總管在無資料時顯示的提示文字
- `commands`：`novelTranslate.createWork`、`addChapter`、`importChapterFile`、`refreshWorks`、`openCompareView`、`toggleScrollSync`、`refreshGlossary`、`addGlossaryEntry`、`editGlossaryEntry`、`deleteGlossaryEntry`、`toggleAutocompleteMode`
- `menus`：作品項目的右鍵選單（新增章節／匯入文字檔）、章節項目的右鍵選單（開啟比對，與單擊章節項目相同效果）、詞彙表作品項目的右鍵選單（新增詞條）、詞條項目的右鍵選單（編輯／刪除）、兩個 View 標題列各自的重新整理按鈕
- `languages` / `configurationDefaults`：自訂語言模式 `novel-translation`，並關閉其 `editor.wordBasedSuggestions`，讓詞彙表自動完成跟一般聯想雜訊分流
- `configuration`：`novelTranslate.compareScrollSync.enabled`（boolean，預設 `true`）——是否同步捲動比對畫面兩側編輯器

作品管理（Phase 1）、比對框（Phase 2）、詞彙表管理與自動完成（Phase 3）皆已實作完成：`novelTranslate.createWork`、`addChapter`、`importChapterFile`、`openCompareView`、`addGlossaryEntry`、`editGlossaryEntry`、`deleteGlossaryEntry` 都是真正的邏輯，資料持久化在工作區的 `.novel-translate/project.json`——詞彙表就存在每個 `WorkConfig.glossary` 裡，沒有另開 `glossary.json`。章節項目的 `TreeItem.command` 直接綁定 `openCompareView`（見 `workTreeProvider.ts` 的 `ChapterTreeItem`），所以單擊章節就會進入比對模式；`addChapter`／`importChapterFile` 完成後也會呼叫同一個函式自動開比對框。`openCompareView` 依賴內建指令 `workbench.action.files.setActiveEditorReadonlyInSession`（把原文設為本次 session 唯讀），並會把譯文檔案用 `vscode.languages.setTextDocumentLanguage` 設為 `novel-translation` 語言模式；捲動同步則是 `CompareScrollSync`（`src/services/compareScrollSync.ts`）自行監聽 `onDidChangeTextEditorVisibleRanges` 並用 `revealRange` 對齊行號，**不再使用** VSCode 內建的 `workbench.action.toggleLockedScrolling`（那個指令是用絕對像素差值同步，兩個檔案長度不同或編輯中捲動時容易把另一邊頂到檔案底部）。

`CompareScrollSync` 內部用「每個 uri 同時最多一筆待回應的 `revealRange` 請求＋排隊＋落點偏差學習」來處理 `revealRange(AtTop)` 實際落點與要求行數不保證精確對齊、連續捲動時請求互相干擾的問題；是否啟用由設定 `novelTranslate.compareScrollSync.enabled` 控制，可透過 `novelTranslate.toggleScrollSync` 指令、比對視窗可見時顯示的狀態列項目、或 `SettingsTreeProvider`（`src/views/settingsTreeProvider.ts`，掛在「設置」View、用 `TreeItem.checkboxState` + `TreeView.onDidChangeCheckboxState` 實作核取方塊）三種 UI 入口切換，彼此透過 `onDidChangeConfiguration` 保持同步。

`GlossaryCompletionProvider`（`src/providers/glossaryCompletionProvider.ts`）註冊在 `{ language: TRANSLATION_LANGUAGE_ID }`：拿到譯文文件後先用 `ProjectStore.findChapterByTranslationUri` 反查所屬作品，再把該作品的 `glossary` 整批轉成 `CompletionItem`（`label` 為譯名，`filterText` 同時含原文詞彙與譯名）。`novelTranslate.toggleAutocompleteMode`（`src/commands/languageModeCommands.ts`）則是在目前分頁的語言模式 `novel-translation` 與 `plaintext` 間切換，供需要臨時關閉詞彙表建議時使用。

多工作區資料夾僅取第一個（`workspaceFolders[0]`），這是目前已知的簡化限制。

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
