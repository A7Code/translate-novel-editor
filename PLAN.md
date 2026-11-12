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

## Phase 5 — EPUB 匯入／匯出（獨立模組）（已完成）

- 新增執行期相依套件 `jszip`（zip 讀寫）與 `cheerio`（HTML/XML 剖析，皆為純 JS、無原生相依，esbuild 可直接打包進 `dist/extension.js`）
- `src/services/epubService.ts`：核心剖析/重建邏輯，不依賴 `vscode` API，純函式方便獨立測試
  - `parseEpub(bytes)`：解壓 zip → 讀 `META-INF/container.xml` 找出 OPF 路徑 → 剖析 OPF 的 `manifest`/`spine`（依 `spine` 順序、過濾出 HTML 類型的 manifest 項目）→ 每個章節 XHTML 用 `extractParagraphTexts` 抽出段落純文字；順便取出 `dc:title`/`dc:creator`/`dc:language` metadata 供建立作品時預填
  - `extractParagraphTexts(html)`：用 `p, h1-h6, blockquote, li` 選取器依文件順序抓出有文字內容的節點，單一函式同時被「匯入時抽取」與「匯出時重新定位相同節點」共用，確保兩次跑出來的節點順序一致
  - `applyTranslationToChapterHtml(html, translationText)`：把譯文純文字逐行塞回對應索引的段落節點（只替換文字內容，不重建行內標籤如粗斜體/連結/注腳——這塊排版還原刻意不做，見下方已知限制）；譯文行數不足的段落保留原文，可支援部分翻譯就先匯出
  - `buildEpubZip(baseFiles, overrides)`：以原始 zip 的全部檔案為底，只替換 `overrides` 指定的章節 XHTML 路徑，其餘檔案（CSS／圖片／字型／NCX／OPF…）原樣保留；`mimetype` 強制排最前面且不壓縮，符合 EPUB OCF 規格
  - 已用一組獨立的 smoke test（建構一個最小假 EPUB → 匯入 → 部分翻譯回填 → 重新打包 → 檢查各檔案）驗證過剖析/回填/重新打包的往返正確性
- 資料模型：`WorkConfig.epubSource?: { packageDir, opfPath }` 記錄解壓後的 EPUB 內容存放位置（`.novel-translate/epub/<workId>/package/`，原樣保留**所有**原始檔案，不只章節 XHTML）；`ChapterConfig.epubContentPath?` 記錄該章節在 `packageDir` 底下對應哪個 XHTML 檔案。`ProjectStore` 新增 `setEpubSource`／`writeEpubPackageFiles`／`listEpubPackageFiles`（遞迴走訪 `packageDir`）
- 指令「小說翻譯：匯入 EPUB」(`novelTranslate.importEpub`，作品總管 View 標題列)：挑選 `.epub` 檔 → 解析 → 依解析出的書名/作者/語言預填輸入框讓使用者確認/修改 → 建立新作品 → 每個 spine 章節建一個 `ChapterConfig`（原文內容＝段落文字逐行）→ 把整個 EPUB 內容樹寫進 `packageDir`
- 指令「小說翻譯：匯出為 EPUB」(`novelTranslate.exportEpub`，只出現在有 `epubSource` 的作品項目右鍵選單；`WorkTreeItem.contextValue` 依是否有 `epubSource` 分成 `novelTranslateWork` / `novelTranslateWork-epub` 兩種，既有的新增章節／匯入文字檔選單改用 `viewItem =~ /^novelTranslateWork/` 正規表達式讓兩種作品都能用)：挑選輸出路徑 → 讀出 `packageDir` 全部檔案 → 對每個有 `epubContentPath` 的章節讀取其 `translations/*.txt` 並用 `applyTranslationToChapterHtml` 回填 → `buildEpubZip` 重新打包 → 寫出 `.epub`，並提供「在檔案總管中顯示」的捷徑
- 已知限制：
  - **不還原行內排版**：段落內的粗體/斜體/連結/注腳標記等行內標籤，匯入抽取成純文字時就已經遺失；匯出時用 `.text()` 整段覆寫，即使保留了該段落的結構（標籤本身還在），行內標籤的巢狀內容也會被整段文字取代——這是本 Phase 一開始就刻意接受的技術取捨（見 Phase 5 標題旁的設計理由），不是遺漏
  - 段落抽取只認 `p / h1-h6 / blockquote / li`，`div`、表格（`table`/`td`）、圖說文字等不會被當成段落抽出，也不會被翻譯
  - 匯出時用 cheerio 的 XML 模式序列化，非 ASCII 字元（含所有中文）會輸出成 `&#xXXXX;` 數字字元參照——這是合法的 XML，電子書閱讀器都能正確解析顯示，只是直接打開原始檔案看會看不到中文字，並讓檔案略為肥大
  - 只支援常見的 EPUB2/EPUB3 結構（`container.xml` → 單一 OPF → `manifest`/`spine`）；特殊、不規範或有 DRM 保護的 EPUB 可能解析失敗
  - 匯出只能針對「從 EPUB 匯入」的作品；純文字建立的作品沒有排版樣板可還原，不提供匯出成 EPUB 的功能
  - 不支援把後續用「新增章節」手動加的額外章節一併排進匯出的 spine（這些章節沒有 `epubContentPath`，匯出時會被忽略）

## Phase 6 — 打包發佈（已完成）

- 新增正式方型圖示 `resources/icon.png`（128×128，書本雙頁對照意象，橘色原文頁／藍色譯文頁）供 `package.json` 的 `icon` 欄位與 Marketplace 商店頁面使用；因為環境內沒有任何 SVG→PNG 的轉檔工具（無 sharp、無 ImageMagick、無 rsvg-convert，ffmpeg 雖有 `svg_pipe` demuxer 但沒編譯 SVG decoder），改用純 Node.js 腳本手刻光柵化＋PNG 編碼：用簡單幾何測試（圓角矩形／矩形 contains）在 4x4 超取樣網格上逐像素判斷顏色，再做 box filter 降採樣做反鋸齒，最後用 `zlib.deflateSync` 壓縮掃描線、手動組 PNG 的 `IHDR`/`IDAT`/`IEND` chunk（`zlib.crc32` 算每個 chunk 的 CRC，Node 21+ 內建）；原本做活動列圖示用的 24x24 線稿 `resources/icon.svg` 維持不變，兩個圖示用途不同（一個是側邊欄小圖示、一個是商店用的方形圖示），不合併
- `package.json` 補上 `icon`（`resources/icon.png`）、`repository`（指向既有的 GitHub remote `A7Code/translate-novel-editor`）、`license: "MIT"`；`publisher` 從 placeholder `your-publisher-id` 改成 `a7code`；`version` 由 `0.0.1` 提升到 `0.1.0`（代表 Phase 0～5 全部完成的首個功能完整版本）
- 新增 `LICENSE`（MIT，著作權人 A7Code）
- 保留 `"private": true`——目前只規劃產出 `.vsix` 供個人安裝，不上傳 Marketplace；這個欄位會讓 `vsce publish` 直接拒絕執行，避免日後手滑誤發佈到公開商店。真要發佈時需先到 Marketplace 註冊 `a7code` 這個 publisher 帳號、移除此欄位
- `README.md` 更新過時的「目前狀態：Phase 0」說明（已反映 Phase 0～5 全部完成），新增授權區塊連回 `LICENSE`；`CHANGELOG.md` 把累積的 `[Unreleased]` 項目收斂成正式的 `[0.1.0] - 2026-11-12` 版本
- 用 `npx vsce package -o releases/` 實際跑過打包，確認輸出的 `.vsix` 內容正確（含 `dist/extension.js`、`package.json`、`readme.md`、`changelog.md`、`docs/`、`resources/icon.svg`），且 `repository`/`LICENSE`/icon 齊備後不再出現先前的 missing-repository、missing-license 警告
- 已知限制：
  - `publisher: "a7code"` 只是為了讓 `package.json` 不再是 placeholder、且打包/日後若要發佈時語意正確，並未實際在 Marketplace 註冊此帳號——目前就只是本機打包用的識別碼，不影響 `.vsix` 的產生或本機安裝
  - `resources/icon.png` 是用手刻光柵化／PNG 編碼器產生，不是向量圖庫或設計軟體輸出，若未來想要更精緻的視覺（漸層、陰影等）建議改用真正的設計工具重新產出
