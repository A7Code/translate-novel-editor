# Changelog

## [Unreleased]

- 修正：`project.json` 損毀時不再被空資料覆蓋。套件會停止寫入，並可用「小說翻譯：從備份還原專案」還原；啟動時自動備份，保留最近 10 份。
- 修正：專案與註解改為原子寫入並依序排隊，降低當機或連續操作造成檔案損毀的風險。
- 修正：關閉原文或譯文其中一側後留言，不會再讓另一側的註解從檔案消失。
- 修正：新匯入的 EPUB 不再重複抽取巢狀段落，振假名也不再混入原文。
- 新增：「小說翻譯：升級 EPUB 章節」，將舊章節轉為新格式，升級前自動備份，並同步調整譯文與註解行號。
- 新增：翻譯進度。作品管理頁面、作品總管和狀態列會顯示每章與整部作品的完成度，未存檔的輸入也會即時反映；作品管理頁面可篩選章節，並用「繼續翻譯」開啟第一個未完成章節。
- 新增：「小說翻譯：跳到下一個未翻譯行」（`Ctrl+Alt+U`），原文和譯文會同步定位；「繼續翻譯」也會直接跳到該章第一個未翻譯行。
- 開發：`npm test` 改為執行不依賴 VS Code 的純邏輯測試。

## [0.1.0] - 2026-11-12

首個功能完整版本，涵蓋 Phase 0～5 全部功能（作品管理、原文／譯文比對、詞彙表自動完成、翻譯筆記、EPUB 匯入／匯出）。

- 新增：側邊欄「設置」View 可設定新增作品的預設原文／譯文語言（`novelTranslate.defaultLanguage.source`、`novelTranslate.defaultLanguage.target`），留空則不啟用；建立作品與匯入 EPUB 時會預先填入，EPUB 已標示原文語言時優先採用 EPUB 的值。
- 新增：比對畫面左右版面可切換。設定 `novelTranslate.compareView.translationOnLeft`（預設開啟，翻譯在左、原文在右）、指令「切換比對畫面版面（翻譯在左／原文在左）」（命令面板 Ctrl+Shift+P 可直接呼叫）、側邊欄「設置」View 新增對應核取方塊，三個入口皆可切換；設定值會套用到下一次開啟的比對畫面。
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
