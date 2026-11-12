# 功能路線圖

這份文件記錄小說翻譯 VSCode 套件的完整開發階段，供後續延續開發時參照目前進度與尚未實作的部分。

## Phase 0 — 專案初始化（已完成）

- TypeScript + esbuild 套件骨架
- Activity Bar 側邊欄容器「小說翻譯」，內含兩個空的 TreeView：作品總管、詞彙表
- 自訂語言模式 `novel-translation`，並透過 `configurationDefaults` 關閉該語言的 `editor.wordBasedSuggestions`，為自動完成隔離鋪路
- `novelTranslate.createWork`、`novelTranslate.openCompareView` 指令（目前為顯示「即將推出」訊息的 stub）
- F5 偵錯啟動設定

## Phase 1 — 作品管理（已完成）

- `.novel-translate/project.json` 專案設定格式：作品清單、每個作品的章節清單、原文/譯文路徑對應、來源與目標語言（`src/types.ts`、`src/services/projectStore.ts`）
- 作品／章節採成對純文字檔儲存：`originals/<workId>/chXX.txt` 對 `translations/<workId>/chXX.txt`
- 「作品總管」TreeView 改為讀取實際專案資料，顯示作品 → 章節（`src/views/workTreeProvider.ts`）
- 指令：新增作品（`novelTranslate.createWork`）、新增章節（`novelTranslate.addChapter`）、匯入現有文字檔為章節（`novelTranslate.importChapterFile`）、重新整理作品清單（`novelTranslate.refreshWorks`）
- 作品總管中點擊章節項目會直接呼叫 `novelTranslate.openCompareView` 進入比對模式（見 Phase 2），不需要另外右鍵選擇指令；新增章節／匯入文字檔完成後也會自動開啟比對框
- 已知限制：僅支援單一工作區資料夾（取 `workspaceFolders[0]`）；尚未提供刪除/重新命名作品或章節的指令，留待後續視需要補上

## Phase 2 — 比對框（原文／譯文比對編輯）（已完成）

- `novelTranslate.openCompareView`（`src/commands/compareCommands.ts`）：點擊章節項目、右鍵選單、或命令面板（會先用 QuickPick 選作品→章節）都能開啟比對
- 於編輯器群組左右開啟原文（`ViewColumn.One`）與譯文（`ViewColumn.Two`）；原文透過內建指令 `workbench.action.files.setActiveEditorReadonlyInSession` 設為本次 session 唯讀，不異動實際檔案權限
- 捲動同步改用自訂實作 `CompareScrollSync`（`src/services/compareScrollSync.ts`），監聽 `onDidChangeTextEditorVisibleRanges`，把來源編輯器目前最上面那一行的行號直接套用到另一側（`revealRange` + `AtTop`），讓兩欄的頂端行號盡可能一致
  - **修正歷史**：最初採用 VSCode 內建「鎖定捲動」(`workbench.action.toggleLockedScrolling`)，但它是用絕對像素差值同步、不理解兩個檔案的行對應關係；原文/譯文長度不同或編輯造成捲動時，差值疊加很容易把另一邊頂到檔案底部（使用者回報「譯文換行，原文就跳到最後面」）。改成自己依「行號」同步後解決此問題，故已移除 `toggleLockedScrolling` 的呼叫
  - **再修正**：`revealRange(AtTop)` 的實際落點不保證精確對齊要求的行數，連續捲動時重疊的請求還會互相干擾造成誤判、甚至卡死。改為每個檔案同時只送出一筆待回應的 `revealRange` 請求（多餘需求先排隊），並持續學習「要求行數／實際落點」的偏差值來校正下一次請求；開啟比對視窗時也會先做一次無感的校正探測，不用使用者先手動捲動暖身
- 同步捲動可開關：設定 `novelTranslate.compareScrollSync.enabled`（預設 `true`），可透過指令「小說翻譯：切換原文／譯文同步捲動」(`novelTranslate.toggleScrollSync`)、比對視窗可見時出現的狀態列按鈕、或側邊欄「設置」View 裡的核取方塊切換（`src/views/settingsTreeProvider.ts`）
- 已知限制：尚未處理原文/譯文段落數不一致時的語意對齊（paragraph mapping）——目前單純比對兩個檔案「行號相同」的那一行，如果原文/譯文沒有維持相同行數結構，對應的內容可能不是同一段落

## Phase 3 — 名詞／片語（詞彙表）管理

- 設計 `.novel-translate/glossary.json` 格式：`{ term, translation, category, note }[]`
- 「詞彙表」TreeView 改為讀取實際詞彙資料；提供新增/編輯/刪除詞條（QuickInput 表單）
- `novel-translation` 語言的 `CompletionItemProvider`：真正讀取詞彙表，依游標前文比對原文詞彙給出譯名建議
- 指令「切換翻譯自動完成模式」：在一般語言與 `novel-translation` 之間切換目前檔案的語言模式
- 視需要重新評估 `editor.quickSuggestions` 的預設值（目前只關閉 `wordBasedSuggestions`）

## Phase 4 — 翻譯筆記（註解）

- 使用 `vscode.comments.createCommentController` 實作留言討論串
- 留言資料持久化：`.novel-translate/comments/<chapter-id>.json`
- 支援標記「待確認」、「已解決」狀態

## Phase 5 — EPUB 匯入／匯出（獨立模組）

- 匯入：解壓 epub（zip）→ 依 OPF spine 讀取章節 XHTML → 用 HTML parser 抽出段落文字為 `originals/*.txt`，並保留每段對應的原始標籤結構映射檔
- 匯出：讀取 `translations/*.txt` → 依映射檔把翻譯文字放回原 XHTML 結構的對應節點 → 重新封裝為 epub
- 技術備註：EPUB 解析本身不難，難點在忠實還原排版格式（粗斜體、注腳、圖片、CSS、章節順序），因此刻意與核心純文字編輯流程解耦，風險隔離在此模組內

## Phase 6 — 打包發佈

- `vsce package`、正式 icon、README/CHANGELOG 完整化
- 填入正式 `publisher` 並視需要調整 `name`/`displayName`
