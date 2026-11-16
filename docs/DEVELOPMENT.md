# 開發文件

本文件給要參與開發、除錯或打包此 VSCode 套件的人閱讀。使用者端的安裝與操作教學請見 [USER_GUIDE.md](USER_GUIDE.md)；完整功能開發路線圖請見 [PLAN.md](../PLAN.md)。

## 技術棧

- TypeScript
- esbuild（打包）
- VSCode Extension API（`engines.vscode` 需求版本見 `package.json`）
- `jszip`（讀寫 EPUB 的 zip 容器）、`cheerio`（剖析/重新序列化 EPUB 內的 XHTML／OPF／container.xml）——兩者都是純 JS、無原生相依，列在 `dependencies`（不是 `devDependencies`），esbuild 會直接打包進 `dist/extension.js`

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
    compareView/
      compareView.ts            # 比對功能核心：只管開兩個視窗（吃左右配置設定、原文設唯讀），對外廣播 onDidSetPair/onDidFocusEditor/onDidBlurEditor/onDidMoveIndex/onDidScroll/onDidChangeVisibility 事件，本身不做任何同步邏輯
      extensions/
        cursorSyncExtension.ts          # 游標行同步：訂閱 onDidMoveIndex/onDidSetPair/onDidChangeVisibility
        scrollSyncExtension.ts          # 捲動同步：訂閱 onDidScroll/onDidSetPair，偏差學習＋狀態列開關
        glossaryLanguageModeExtension.ts  # 開啟比對畫面時套用 novel-translation 語言模式：訂閱 onDidSetPair
    commentStore.ts             # 讀寫 .novel-translate/comments/<workId>/<chapterId>.json
    novelCommentController.ts   # 包裝 vscode.CommentController，管理翻譯筆記討論串的建立/還原/持久化
    epubService.ts              # EPUB 剖析/段落抽取/翻譯回填/重新打包的核心邏輯，不依賴 vscode API
  commands/
    workCommands.ts             # 建立作品、新增章節、匯入文字檔的指令邏輯
    compareCommands.ts          # 指令層：解析使用者要開哪個章節，呼叫 CompareView.open() 開啟雙欄比對；比對本身（左右配置、唯讀、同步、語言模式）都交給 CompareView 與其擴充功能
    glossaryCommands.ts         # 新增/編輯/刪除詞條的指令邏輯
    languageModeCommands.ts     # 切換目前分頁語言模式（novel-translation ↔ plaintext）
    epubCommands.ts             # 匯入 EPUB 建立新作品、匯出 EPUB 作品回填譯文並重新打包
  providers/
    glossaryCompletionProvider.ts  # novel-translation 語言的 CompletionItemProvider，依文件 URI 對應到任一作品章節（原文或譯文皆可），每個詞條同時給出原文／譯名兩個候選項
  views/
    workTreeProvider.ts         # 「作品總管」View：讀取 ProjectStore 顯示作品 → 章節
    glossaryTreeProvider.ts     # 「詞彙表」View：讀取 ProjectStore 顯示作品 → 詞條
    settingsTreeProvider.ts     # 「設置」View：捲動同步、游標同步、詞彙表自動完成、同音建議、翻譯顯示在左側，共五個核取方塊項目
resources/
  icon.svg                      # Activity Bar 圖示
```

`package.json` 的 `contributes` 區塊定義了：

- `viewsContainers.activitybar`：側邊欄容器「小說翻譯」
- `views.novelTranslate`：三個 View（`novelTranslate.works`、`novelTranslate.glossary`、`novelTranslate.settings`）
- `viewsWelcome`：作品總管在無資料時顯示的提示文字
- `commands`：`novelTranslate.createWork`、`addChapter`、`importChapterFile`、`refreshWorks`、`openCompareView`、`toggleScrollSync`、`refreshGlossary`、`addGlossaryEntry`、`editGlossaryEntry`、`deleteGlossaryEntry`、`toggleAutocompleteMode`、`submitComment`、`toggleCommentResolved`、`deleteCommentThread`、`importEpub`、`exportEpub`
- `menus`：作品項目的右鍵選單（新增章節／匯入文字檔，`when` 用 `viewItem =~ /^novelTranslateWork/` 同時吃一般作品與 EPUB 作品兩種 contextValue）、EPUB 作品項目額外的右鍵選單（匯出為 EPUB，`viewItem == novelTranslateWork-epub` 精確比對）、章節項目的右鍵選單（開啟比對，與單擊章節項目相同效果）、詞彙表作品項目的右鍵選單（新增詞條）、詞條項目的右鍵選單（編輯／刪除）、作品總管 View 標題列的匯入 EPUB 按鈕、兩個 View 標題列各自的重新整理按鈕、`comments/commentThread/context`（送出留言的 inline 按鈕）、`comments/commentThread/title`（切換已解決／刪除討論串）
- `languages` / `configurationDefaults`：自訂語言模式 `novel-translation`，並關閉其 `editor.wordBasedSuggestions`，讓詞彙表自動完成跟一般聯想雜訊分流
- `configuration`：`novelTranslate.compareScrollSync.enabled`（boolean，預設 `true`）——是否同步捲動比對畫面兩側編輯器；`novelTranslate.compareCursorSync.enabled`（boolean，預設 `true`）——是否把焦點編輯器的游標行同步到另一側；`novelTranslate.compareView.translationOnLeft`（boolean，預設 `true`）——比對畫面翻譯稿是否顯示在左側；`novelTranslate.glossaryAutocomplete.enabled`（boolean，預設 `true`）——開啟比對畫面時是否自動把原文／譯文都設為 `novel-translation` 語言模式（詞彙表自動完成）

作品管理（Phase 1）、比對框（Phase 2）、詞彙表管理與自動完成（Phase 3）、翻譯筆記（Phase 4）、EPUB 匯入／匯出（Phase 5）皆已實作完成：`novelTranslate.createWork`、`addChapter`、`importChapterFile`、`openCompareView`、`addGlossaryEntry`、`editGlossaryEntry`、`deleteGlossaryEntry` 都是真正的邏輯，資料持久化在工作區的 `.novel-translate/project.json`——詞彙表就存在每個 `WorkConfig.glossary` 裡，沒有另開 `glossary.json`。章節項目的 `TreeItem.command` 直接綁定 `openCompareView`（見 `workTreeProvider.ts` 的 `ChapterTreeItem`），所以單擊章節就會進入比對模式；`addChapter`／`importChapterFile` 完成後也會呼叫同一個函式自動開比對框。`openCompareView`（`src/commands/compareCommands.ts`）只做「使用者互動」這一層：沒給章節時跳 QuickPick 讓使用者選作品／章節，取出 `originalPath`/`translationPath` 對應的 `Uri`，呼叫 `CompareView.open(originalUri, translationUri)`。

真正「開比對畫面」的邏輯都在 `CompareView`（`src/services/compareView/compareView.ts`）：依 `novelTranslate.compareView.translationOnLeft` 決定左右欄分別開哪個檔案，依內建指令 `workbench.action.files.setActiveEditorReadonlyInSession` 把原文設為本次 session 唯讀，開完後記住這對 `Uri`。**`CompareView` 本身完全不認識游標同步、捲動同步、詞彙表語言模式這些概念**——它只單純監聽 VSCode 原生的 `onDidChangeActiveTextEditor`／`onDidChangeTextEditorSelection`／`onDidChangeTextEditorVisibleRanges`／`onDidChangeVisibleTextEditors`，過濾出屬於目前配對的那兩個檔案，轉成語意化的事件廣播出去：`onDidSetPair`（開了新的一對原文／譯文）、`onDidFocusEditor`／`onDidBlurEditor`（配對中某一側變成／不再是焦點編輯器）、`onDidMoveIndex`（配對中某一側的游標移動了）、`onDidScroll`（配對中某一側的可視範圍變了）、`onDidChangeVisibility`（配對中兩側目前各自是否顯示在畫面上）。

所有「比對時順便做點什麼」的功能都是**擴充功能**，活在 `src/services/compareView/extensions/` 底下各自獨立的檔案：建構時讀自己的設定鍵，並監聽 `onDidChangeConfiguration` 動態訂閱／取消訂閱 `CompareView` 的事件——**設定關閉時要完全不向 `CompareView` 註冊任何監聽**，不是訂閱了再在 handler 裡用 `if (!enabled) return` 短路。目前有三個：

- `cursorSyncExtension.ts`（`novelTranslate.compareCursorSync.enabled`）：訂閱 `onDidMoveIndex` 把游標行同步到另一側；`onDidSetPair`／`onDidChangeVisibility` 觸發時額外用目前 `activeTextEditor` 校正一次，不用等使用者先移動游標才會同步
- `scrollSyncExtension.ts`（`novelTranslate.compareScrollSync.enabled`）：訂閱 `onDidScroll`，用「每一側同時最多一筆待回應的 `revealRange` 請求＋排隊＋落點偏差學習」處理 `revealRange(AtTop)` 實際落點與要求行數不保證精確對齊、連續捲動時請求互相干擾的問題；**不使用** VSCode 內建的 `workbench.action.toggleLockedScrolling`（那個指令是用絕對像素差值同步，兩個檔案長度不同或編輯中捲動時容易把另一邊頂到檔案底部）。狀態列的「同步捲動：開／關」按鈕是例外：為了讓使用者在同步關閉時仍看得到、能點擊重新開啟，它的可見度追蹤（跟著 `onDidChangeVisibility`）**不受**這個擴充功能啟用與否影響，一律在建構時就訂閱
- `glossaryLanguageModeExtension.ts`（`novelTranslate.glossaryAutocomplete.enabled`）：訂閱 `onDidSetPair`，把原文／譯文兩份文件用 `vscode.languages.setTextDocumentLanguage` 設為 `novel-translation` 語言模式（詞彙表自動完成）；關閉時維持文件原本的語言模式

是否啟用各自由對應設定控制，可透過命令面板指令（如 `novelTranslate.toggleScrollSync`）、比對視窗可見時顯示的狀態列項目、或 `SettingsTreeProvider`（`src/views/settingsTreeProvider.ts`，掛在「設置」View、用 `TreeItem.checkboxState` + `TreeView.onDidChangeCheckboxState` 實作核取方塊）等 UI 入口切換，彼此透過 `onDidChangeConfiguration` 保持同步。

**日後要幫比對畫面加新的「順便做點什麼」功能**（例如：比較兩側段落數量、在狀態列顯示字數差異……），請新增一個獨立檔案到 `extensions/` 底下，依上面的模式實作，不要把邏輯寫進 `compareView.ts`。只有當新需求真的是「開視窗本身的行為」（例如要改左右欄位的判斷方式），或者**現有事件都無法表達**你需要的語意（例如需要一個全新的「段落邊界」事件）時才動 `compareView.ts`——而且即使那樣，也只新增一個新的事件或方法，不要讓 core 認識任何設定鍵、或在 core 裡面寫任何條件式的同步邏輯，那些永遠是擴充功能的職責。

`GlossaryCompletionProvider`（`src/providers/glossaryCompletionProvider.ts`）註冊在 `{ language: TRANSLATION_LANGUAGE_ID }`：拿到文件後先用 `ProjectStore.findWorkIdForDocumentUri` 反查所屬作品，再把該作品的 `glossary` 整批轉成 `CompletionItem`（每個詞條各給原文、譯名兩個候選項，`filterText` 同時含兩者）。`novelTranslate.toggleAutocompleteMode`（`src/commands/languageModeCommands.ts`）則是在目前分頁的語言模式 `novel-translation` 與 `plaintext` 間切換，供需要臨時關閉詞彙表建議時使用。

`NovelCommentController`（`src/services/novelCommentController.ts`）包裝 `vscode.comments.createCommentController`，實作翻譯筆記（Phase 4）：

- `commentingRangeProvider` 用 `ProjectStore.findChapterForDocumentUri` 判斷文件是否屬於某個章節，只有章節的原文/譯文檔案才會出現留言「+」affordance
- 每個文件第一次被開啟（`onDidOpenTextDocument`）時，從 `CommentStore`（`src/services/commentStore.ts`，讀寫 `.novel-translate/comments/<workId>/<chapterId>.json`）載入屬於它那一側（`relativePath` 比對 `originalPath`/`translationPath`）的討論串資料，用 `controller.createCommentThread` 還原成真正的 `vscode.CommentThread`；文件關閉（`onDidCloseTextDocument`）時把對應的 thread 物件 dispose 掉，避免殘留
- 用兩個 `Map` 追蹤執行期狀態：`threadMeta`（`CommentThread → {id, workId, chapterId, relativePath}`，因為 `vscode.Comment`/`CommentThread` 本身不會記住我們自訂的 id）與 `chapterThreads`（`"workId/chapterId" → Set<CommentThread>`，持久化時用來蒐集同一章節所有存活的討論串）
- 新增留言（`novelTranslate.submitComment`，對應 `comments/commentThread/context` 的 inline 按鈕）：若 `reply.thread` 還沒在 `threadMeta` 裡（代表是使用者點「+」新建立的討論串），先反查所屬作品／章節並註冊；每次送出都會把整個章節目前所有存活討論串重新序列化寫回同一個 JSON 檔（`persistChapter`），沒有做差異化增量寫入
- 「待確認／已解決」直接對應 `vscode.CommentThreadState.Unresolved`/`Resolved`（`novelTranslate.toggleCommentResolved`）；「刪除討論串」（`novelTranslate.deleteCommentThread`）會把 thread 從追蹤 Map 移除、`dispose()`，再重新寫回持久化檔案
- 作者名稱固定用 `os.userInfo().username`（取不到就用「我」），沒有身分切換機制

`epubService.ts`（Phase 5）刻意不依賴 `vscode` API，純粹操作 bytes/字串，方便獨立測試（開發時曾用 esbuild 把這個檔案單獨打包成一個暫存的 CJS 檔，寫一個建構假 EPUB → 匯入 → 部分翻譯回填 → 重新打包的 smoke test 腳本驗證往返正確性，不需要啟動 Extension Development Host）：

- `parseEpub(bytes)`：`jszip` 解壓 → 讀 `META-INF/container.xml` 找 OPF 路徑 → 剖析 OPF 的 `manifest`/`spine` → 依 spine 順序、只留 HTML 類型的 manifest 項目，逐一讀出章節 XHTML 原始內容
- `extractParagraphTexts(html)`：`p, h1-h6, blockquote, li` 選取器依文件順序取出有文字的節點 → 文字陣列；這個函式在匯入（抽取成 `originals/*.txt`）與日後可能的重新匯入校驗都共用同一份邏輯，確保節點順序穩定
- `applyTranslationToChapterHtml(html, translationText)`：匯出時用，把譯文逐行塞回對應索引的段落節點的文字內容（`$(el).text(line)`），行內標籤因此會被整段清掉——這是刻意的取捨，詳見 `PLAN.md` Phase 5 的已知限制
- `buildEpubZip(baseFiles, overrides)`：以原始 EPUB 的全部檔案為底，只替換 `overrides` 指定路徑的內容，`mimetype` 強制排最前面且用 `STORE`（不壓縮），符合 EPUB OCF 規格
- `epubCommands.ts` 的 `importEpub`／`exportEpub` 負責串接 UI（`showOpenDialog`/`showSaveDialog`/`withProgress`）與 `ProjectStore` 的 `setEpubSource`/`writeEpubPackageFiles`/`listEpubPackageFiles`；`WorkTreeItem.contextValue` 依 `work.epubSource` 是否存在分成 `novelTranslateWork` 與 `novelTranslateWork-epub` 兩種，讓「匯出為 EPUB」只出現在來自 EPUB 的作品上

多工作區資料夾僅取第一個（`workspaceFolders[0]`），這是目前已知的簡化限制。

## 打包發佈

```bash
npm run package-vsix
```

會呼叫 `vsce package` 並將產出的 `.vsix` 放到 `releases/` 目錄。

### 發佈前待辦

- 目前僅規劃產出 `.vsix` 供個人安裝使用，不上傳到 Marketplace，因此 `package.json` 保留 `"private": true`（`vsce publish` 會因此直接拒絕執行，避免手滑誤發佈）。`publisher` 欄位填入 `a7code`，若日後真的要發佈到 Marketplace，需先在 https://marketplace.visualstudio.com/manage 註冊對應的 publisher 帳號，並移除 `private` 欄位。
- Phase 6 其餘收尾項目（icon、LICENSE、repository、README/CHANGELOG）已完成，見 `PLAN.md` 的 Phase 6。

### 安裝 .vsix

打包完成後，在 VSCode 的擴充功能面板點右上角「...」→「從 VSIX 安裝...」，選擇 `releases/` 底下產生的 `.vsix` 檔即可；或用指令列：

```bash
code --install-extension releases/novel-translate-editor-0.1.0.vsix
```

## 路線圖

完整的分階段開發計畫（Phase 0～6，含每階段的技術設計細節）記錄在 [PLAN.md](../PLAN.md)，之後接續開發時請以該文件為準，並隨進度更新。
