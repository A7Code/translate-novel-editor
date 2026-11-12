# Changelog

## [Unreleased]

- Phase 3：詞彙表管理與自動完成。作品專屬詞彙表存於 `project.json` 的 `work.glossary`；「詞彙表」View 可新增/編輯/刪除詞條；開啟比對框時譯文檔案自動套用 `novel-translation` 語言模式，掛上 `GlossaryCompletionProvider` 讓詞彙表出現在自動完成清單；新增「切換詞彙表自動完成模式」指令。
- 新增：同步捲動可開關。設定 `novelTranslate.compareScrollSync.enabled`、指令「切換原文／譯文同步捲動」、比對視窗的狀態列按鈕、側邊欄新增的「設置」View 核取方塊，四個入口皆可切換。
- 修正：`CompareScrollSync` 改用序列化請求＋落點偏差學習，解決 `revealRange(AtTop)` 實際落點與要求行數有誤差、連續捲動時請求互相干擾導致卡死或行數偏移的問題；開啟比對視窗時會先做一次無感校正，不用使用者手動捲動暖身。
- 修正：比對框改用自訂的 `CompareScrollSync`（依頂端行號對齊捲動），取代 VSCode 內建「鎖定捲動」；修復譯文換行時原文會被頂到檔案最後面的問題。
- 修正：作品總管中單擊章節項目會直接開啟比對編輯，不需再右鍵選擇指令；新增章節／匯入文字檔完成後也會自動進入比對編輯。移除不再需要的 `novelTranslate.openChapterTranslation` 指令。
- Phase 2：比對框。`novelTranslate.openCompareView` 改為真正邏輯：左右欄開啟原文（本次 session 唯讀）與譯文。
- Phase 1：作品管理。新增 `.novel-translate/project.json` 專案設定、成對原文/譯文純文字檔儲存、「作品總管」TreeView 讀取真實資料、建立作品／新增章節／匯入文字檔／重新整理等指令。
- 建立 Phase 0 套件骨架：TypeScript + esbuild 工具鏈、側邊欄容器與 TreeView、`novel-translation` 語言模式、偵錯設定。
