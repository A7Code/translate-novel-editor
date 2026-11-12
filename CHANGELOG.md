# Changelog

## [Unreleased]

- 修正：比對框改用自訂的 `CompareScrollSync`（依頂端行號對齊捲動），取代 VSCode 內建「鎖定捲動」；修復譯文換行時原文會被頂到檔案最後面的問題。
- 修正：作品總管中單擊章節項目會直接開啟比對編輯，不需再右鍵選擇指令；新增章節／匯入文字檔完成後也會自動進入比對編輯。移除不再需要的 `novelTranslate.openChapterTranslation` 指令。
- Phase 2：比對框。`novelTranslate.openCompareView` 改為真正邏輯：左右欄開啟原文（本次 session 唯讀）與譯文。
- Phase 1：作品管理。新增 `.novel-translate/project.json` 專案設定、成對原文/譯文純文字檔儲存、「作品總管」TreeView 讀取真實資料、建立作品／新增章節／匯入文字檔／重新整理等指令。
- 建立 Phase 0 套件骨架：TypeScript + esbuild 工具鏈、側邊欄容器與 TreeView、`novel-translation` 語言模式、偵錯設定。
