# Changelog

## [Unreleased]

- Phase 5：EPUB 匯入／匯出。新增「匯入 EPUB」建立新作品（自動依 spine 拆出章節、保留整個 EPUB 內容樹）；從 EPUB 匯入的作品可以「匯出為 EPUB」，把目前的譯文回填進原始排版後重新打包。新增執行期相依 `jszip`、`cheerio`。
- Phase 4：翻譯筆記。用 VSCode 原生 Comments API 在原文／譯文檔案上留言討論串，資料持久化在 `.novel-translate/comments/<workId>/<chapterId>.json`；可切換「待確認／已解決」狀態、刪除整個討論串。
- 新增：「詞彙表自動完成模式」設定 `novelTranslate.glossaryAutocomplete.enabled`（預設開啟），控制開啟比對畫面時是否自動套用詞彙表自動完成語言模式；側邊欄「設置」View 新增對應的核取方塊，可直接勾選/取消勾選。
- 修正：上述核取方塊原本只影響「之後新開啟」的比對畫面，對目前已開啟的分頁沒有任何作用，看起來像設定沒生效。現在切換核取方塊會立即把所有已開啟、屬於某個章節的原文／譯文分頁同步套用或移除 `novel-translation` 語言模式；套件啟動時也會依目前設定值做一次校正。
- 修正：詞彙表自動完成原本只掛在譯文欄位、且只能補出譯名。現在原文欄位（解除唯讀後）也會套用 `novel-translation` 語言模式並掛上同一個 `GlossaryCompletionProvider`；不論在原文或譯文欄位打字，只要符合某個詞條的原文或譯名，自動完成清單都會同時列出該詞條的「原文」與「譯名」兩個候選項。
- Phase 3：詞彙表管理與自動完成。作品專屬詞彙表存於 `project.json` 的 `work.glossary`；「詞彙表」View 可新增/編輯/刪除詞條；開啟比對框時譯文檔案自動套用 `novel-translation` 語言模式，掛上 `GlossaryCompletionProvider` 讓詞彙表出現在自動完成清單；新增「切換詞彙表自動完成模式」指令。
- 新增：同步捲動可開關。設定 `novelTranslate.compareScrollSync.enabled`、指令「切換原文／譯文同步捲動」、比對視窗的狀態列按鈕、側邊欄新增的「設置」View 核取方塊，四個入口皆可切換。
- 修正：`CompareScrollSync` 改用序列化請求＋落點偏差學習，解決 `revealRange(AtTop)` 實際落點與要求行數有誤差、連續捲動時請求互相干擾導致卡死或行數偏移的問題；開啟比對視窗時會先做一次無感校正，不用使用者手動捲動暖身。
- 修正：比對框改用自訂的 `CompareScrollSync`（依頂端行號對齊捲動），取代 VSCode 內建「鎖定捲動」；修復譯文換行時原文會被頂到檔案最後面的問題。
- 修正：作品總管中單擊章節項目會直接開啟比對編輯，不需再右鍵選擇指令；新增章節／匯入文字檔完成後也會自動進入比對編輯。移除不再需要的 `novelTranslate.openChapterTranslation` 指令。
- Phase 2：比對框。`novelTranslate.openCompareView` 改為真正邏輯：左右欄開啟原文（本次 session 唯讀）與譯文。
- Phase 1：作品管理。新增 `.novel-translate/project.json` 專案設定、成對原文/譯文純文字檔儲存、「作品總管」TreeView 讀取真實資料、建立作品／新增章節／匯入文字檔／重新整理等指令。
- 建立 Phase 0 套件骨架：TypeScript + esbuild 工具鏈、側邊欄容器與 TreeView、`novel-translation` 語言模式、偵錯設定。
