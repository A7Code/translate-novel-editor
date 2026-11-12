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

## Phase 3 — 名詞／片語（詞彙表）管理（已完成）

- 詞彙表改為**作品專屬**，直接存在 `.novel-translate/project.json` 內每個作品的 `glossary: GlossaryEntry[]`（`{ id, term, translation, category?, note? }`），不另開 `glossary.json`——理由是詞彙表跟章節一樣屬於單一作品的 metadata，沿用既有的 `ProjectStore` 讀寫邏輯最簡單；舊版 `project.json`（沒有 `glossary` 欄位）載入時會自動補 `[]`，相容既有資料
- `ProjectStore` 新增 `addGlossaryEntry` / `updateGlossaryEntry` / `deleteGlossaryEntry` / `findGlossaryEntryByTerm`（依詞彙比對既有詞條）/ `findWorkIdForDocumentUri`（原文或譯文的 Uri 都能反查回所屬作品，供自動完成與指令判斷情境用）
- 「詞彙表」TreeView（`src/views/glossaryTreeProvider.ts`）改為讀取實際資料，顯示作品 → 詞條，與「作品總管」的作品 → 章節結構對稱；指令：新增詞條（`novelTranslate.addGlossaryEntry`）、編輯詞條（`novelTranslate.editGlossaryEntry`，單擊詞條項目即觸發）、刪除詞條（`novelTranslate.deleteGlossaryEntry`，會跳確認對話框）、重新整理（`novelTranslate.refreshGlossary`）
- 新增/編輯/刪除詞條也支援直接從命令面板呼叫（不經由側邊欄項目）：會依目前作用中編輯器所屬的作品自動判斷情境（只有一個作品時直接用那個；否則嘗試從目前分頁反查，查不到才跳 QuickPick 選作品）；若編輯器裡有反白選取文字，會先查詢該詞彙是否已存在——存在就切到修改模式、不存在就以選取文字預填詞彙進入新增模式；修改/刪除在沒有反白時則跳出詞條清單讓使用者挑選（`src/commands/glossaryCommands.ts`）
- 開啟比對框時，**原文與譯文**檔案都會被 `vscode.languages.setTextDocumentLanguage` 設為 `novel-translation` 語言模式（`src/commands/compareCommands.ts`），是否套用由設定 `novelTranslate.glossaryAutocomplete.enabled`（預設 `true`）控制；切換此設定時會立即把目前所有已開啟、屬於某章節的分頁同步套用新的語言模式（`syncGlossaryAutocompleteLanguageMode`），不用等重新開比對框才生效
- `GlossaryCompletionProvider`（`src/providers/glossaryCompletionProvider.ts`）註冊在 `novel-translation` 語言：依文件 Uri 反查所屬作品，把該作品詞彙表的**每一條都做成兩個建議項目**（原文詞彙、譯名各一個，彼此的 `filterText` 都同時包含兩者，`detail` 顯示對應的另一邊），讓原文、譯文兩欄都能用原文或譯名篩選到建議
- 指令「切換詞彙表自動完成模式」（`novelTranslate.toggleAutocompleteMode`，`src/commands/languageModeCommands.ts`）：在目前分頁的語言模式 `novel-translation` 與 `plaintext` 之間切換，給需要臨時關閉詞彙表建議（例如想用其他語言相關的擴充功能）的情境用
- 側邊欄「設置」View（`src/views/settingsTreeProvider.ts`）新增「詞彙表自動完成模式」核取方塊，與設定值雙向同步
- 已知限制：
  - 自動完成的篩選完全交給 VSCode 內建 fuzzy matching，沒有針對 CJK 斷詞做特別處理，中文輸入時的篩選體驗可能不如預期精準
  - 目前 `editor.quickSuggestions` 維持預設值（只關閉 `wordBasedSuggestions`），未來若發現自動彈出的時機不理想可再調整
  - 詞彙表目前沒有匯入/匯出或跨作品共用的功能
  - `findGlossaryEntryByTerm` 是單一作品內依詞彙完全比對（忽略大小寫），沒有模糊比對

## Phase 4 — 翻譯筆記（註解）（已完成）

- `NovelCommentController`（`src/services/novelCommentController.ts`）用 `vscode.comments.createCommentController` 實作留言討論串，掛在原文與譯文檔案上都可以留言
- `commentingRangeProvider` 依 `ProjectStore.findChapterForDocumentUri` 判斷目前文件是否屬於某個章節，是才顯示「+」留言按鈕（無關的檔案不會出現）
- 留言資料持久化在 `.novel-translate/comments/<workId>/<chapterId>.json`（`CommentThreadData[]`，每筆含 `relativePath` 標記是原文還是譯文側、`startLine`/`endLine`、`resolved`、`comments: CommentData[]`）；開啟一個檔案時會把屬於它的討論串從檔案還原成真正的 `vscode.CommentThread`，任何新增留言／切換狀態／刪除討論串都會把該章節目前所有存活的討論串重新整批寫回同一個檔案
- 待確認／已解決直接對應 VSCode 原生的 `CommentThreadState.Unresolved` / `Resolved`，透過討論串標題列的「切換已解決／待確認」指令切換（`novelTranslate.toggleCommentResolved`）；另外提供「刪除討論串」(`novelTranslate.deleteCommentThread`)
- 已知限制：
  - 留言的行號定位（`startLine`/`endLine`）不會隨文件編輯自動校正——在錯誤位置上方插入/刪除行之後，舊留言可能會對不準原本的段落
  - 不支援編輯已送出的留言內容，只能刪除整個討論串重新留言
  - 作者名稱固定取作業系統使用者名稱，沒有多人協作/身分切換的概念

## Phase 5 — EPUB 匯入／匯出（獨立模組）

- 匯入：解壓 epub（zip）→ 依 OPF spine 讀取章節 XHTML → 用 HTML parser 抽出段落文字為 `originals/*.txt`，並保留每段對應的原始標籤結構映射檔
- 匯出：讀取 `translations/*.txt` → 依映射檔把翻譯文字放回原 XHTML 結構的對應節點 → 重新封裝為 epub
- 技術備註：EPUB 解析本身不難，難點在忠實還原排版格式（粗斜體、注腳、圖片、CSS、章節順序），因此刻意與核心純文字編輯流程解耦，風險隔離在此模組內

## Phase 6 — 打包發佈

- `vsce package`、正式 icon、README/CHANGELOG 完整化
- 填入正式 `publisher` 並視需要調整 `name`/`displayName`
