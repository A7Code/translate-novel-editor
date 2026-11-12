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
- 指令：新增作品（`novelTranslate.createWork`）、新增章節（`novelTranslate.addChapter`）、匯入現有文字檔為章節（`novelTranslate.importChapterFile`）、開啟章節譯文（`novelTranslate.openChapterTranslation`）、重新整理作品清單（`novelTranslate.refreshWorks`）
- 已知限制：僅支援單一工作區資料夾（取 `workspaceFolders[0]`）；尚未提供刪除/重新命名作品或章節的指令，留待後續視需要補上

## Phase 2 — 比對框（原文／譯文比對編輯）

- `novelTranslate.openCompareView` 指令已接上章節選單（Phase 1），目前仍是顯示「即將推出」的 stub；這裡要補上真正邏輯
- 於編輯器群組左右開啟原文（唯讀）與譯文（可編輯）
- 套用 VSCode 內建「鎖定捲動」(Locked Scrolling) 功能做捲動同步
- 若原文/譯文段落數不一致，於章節設定中記錄 paragraph mapping（預設 1:1）

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
