import * as vscode from "vscode";
import { WorkTreeProvider, ChapterTreeItem, WorkTreeItem } from "./work/workTreeProvider";
import {
  GlossaryCategoryTreeItem,
  GlossaryEntryTreeItem,
  GlossaryTreeProvider,
  GlossaryWorkTreeItem
} from "./glossary/glossaryTreeProvider";
import { GlossaryManagerPanel } from "./glossary/glossaryManagerPanel";
import { WorkManagerPanel } from "./work/workManagerPanel";
import {
  EDIT_DEFAULT_LANGUAGE_COMMAND_ID,
  SettingsTreeProvider,
  TOGGLE_CHECKBOX_COMMAND_ID
} from "./settings/settingsTreeProvider";
import { ProjectStore } from "./core/projectStore";
import { CompareView } from "./compareView/compareView";
import { CursorSyncExtension } from "./compareView/extensions/cursorSyncExtension";
import { ScrollSyncExtension } from "./compareView/extensions/scrollSyncExtension";
import { LineAlignmentDiagnosticsExtension } from "./compareView/extensions/lineAlignmentDiagnosticsExtension";
import { GlossaryLanguageModeExtension } from "./glossary/integrations/compareViewLanguageMode";
import { addChapter, createWork, editWork, importChapterFile, moveTreeItem, renameChapter } from "./work/workCommands";
import { openCompareView, restoreComparePairIfOpen, toggleCompareLayout } from "./compareView/compareCommands";
import {
  addGlossaryCategory,
  addGlossaryEntry,
  addGlossaryEntryToCategory,
  deleteGlossaryEntry,
  editGlossaryEntry
} from "./glossary/glossaryCommands";
import { syncGlossaryAutocompleteLanguageMode, toggleAutocompleteMode } from "./glossary/languageModeCommands";
import { GlossaryCompletionProvider } from "./glossary/glossaryCompletionProvider";
import { GlossaryHoverProvider } from "./glossary/glossaryHoverProvider";
import { GlossaryHighlightExtension } from "./glossary/integrations/glossaryHighlightExtension";
import { PunctuationSuggestCompletionProvider } from "./compareView/extensions/punctuationSuggestProvider";
import {
  configurePunctuationSuggestKeybinding,
  suggestPunctuationFromOriginal
} from "./compareView/punctuationSuggestCommands";
import { NovelCommentController } from "./comments/novelCommentController";
import { deleteCommentThread, submitComment, toggleCommentResolved } from "./comments/commentCommands";
import { exportEpub, importEpub } from "./epub/epubCommands";
import { upgradeEpubChapters } from "./epub/epubMigrationCommands";
import {
  notifyProjectLoadFailure,
  RESTORE_PROJECT_COMMAND_ID,
  restoreProjectBackup
} from "./core/projectRecoveryCommands";
import { GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, TRANSLATION_LANGUAGE_ID } from "./core/constants";
import { safeRun } from "./core/safeRun";
import { SidebarSectionStateStore } from "./core/sidebarStateStore";
import { jumpToNextUntranslated } from "./translation/jumpCommands";
import { ProgressService } from "./translation/progressService";
import { ProgressStatusBar } from "./translation/progressStatusBar";

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const projectStore = workspaceFolder ? new ProjectStore(workspaceFolder) : undefined;

  // 側邊欄三個 View（作品總管／詞彙表／設置）各自記住自己的展開／選取狀態，互不干擾。
  const workSidebarState = new SidebarSectionStateStore(context.globalState, "novelTranslate.sidebarState.works");
  const glossarySidebarState = new SidebarSectionStateStore(
    context.globalState,
    "novelTranslate.sidebarState.glossary"
  );
  const settingsSidebarState = new SidebarSectionStateStore(
    context.globalState,
    "novelTranslate.sidebarState.settings"
  );

  const progressService =
    projectStore && workspaceFolder ? new ProgressService(projectStore, workspaceFolder) : undefined;
  const workTreeProvider = new WorkTreeProvider(projectStore, workSidebarState, progressService);
  const glossaryTreeProvider = new GlossaryTreeProvider(projectStore, glossarySidebarState);
  const settingsTreeProvider = new SettingsTreeProvider(
    settingsSidebarState,
    projectStore,
    glossaryTreeProvider.onDidChangeTreeData
  );
  const compareView = new CompareView();
  const cursorSyncExtension = new CursorSyncExtension(compareView);
  const scrollSyncExtension = new ScrollSyncExtension(compareView);
  const lineAlignmentDiagnosticsExtension = new LineAlignmentDiagnosticsExtension(compareView);
  const glossaryLanguageModeExtension = new GlossaryLanguageModeExtension(compareView);
  const glossaryHighlightExtension = new GlossaryHighlightExtension(
    projectStore,
    glossaryTreeProvider.onDidChangeTreeData
  );
  const commentController = new NovelCommentController(projectStore);
  if (projectStore && progressService) {
    context.subscriptions.push(progressService, new ProgressStatusBar(projectStore, compareView, progressService));
  }

  const workTreeView = vscode.window.createTreeView("novelTranslate.works", {
    treeDataProvider: workTreeProvider
  });
  const glossaryTreeView = vscode.window.createTreeView("novelTranslate.glossary", {
    treeDataProvider: glossaryTreeProvider
  });
  const settingsTreeView = vscode.window.createTreeView("novelTranslate.settings", {
    treeDataProvider: settingsTreeProvider
  });

  context.subscriptions.push(
    compareView,
    cursorSyncExtension,
    scrollSyncExtension,
    lineAlignmentDiagnosticsExtension,
    glossaryLanguageModeExtension,
    glossaryHighlightExtension,
    commentController,
    settingsTreeProvider,
    workTreeView,
    glossaryTreeView,
    settingsTreeView,
    settingsTreeView.onDidChangeCheckboxState((event) => {
      for (const [item, state] of event.items) {
        safeRun(settingsTreeProvider.handleCheckboxChange(item, state), "切換設定核取方塊");
      }
    }),
    vscode.commands.registerCommand(TOGGLE_CHECKBOX_COMMAND_ID, (item: vscode.TreeItem) =>
      safeRun(settingsTreeProvider.toggleCheckbox(item), "切換設定核取方塊")
    ),
    vscode.commands.registerCommand(EDIT_DEFAULT_LANGUAGE_COMMAND_ID, (itemId: string) =>
      safeRun(settingsTreeProvider.editDefaultLanguage(itemId), "修改預設語言")
    ),

    // 記住使用者展開／收合了哪些節點、最後選了哪個項目，下次開啟畫面時套用同樣的狀態。
    workTreeView.onDidExpandElement((event) => {
      if (event.element.id) {
        workTreeProvider.setExpanded(event.element.id, true);
      }
    }),
    workTreeView.onDidCollapseElement((event) => {
      if (event.element.id) {
        workTreeProvider.setExpanded(event.element.id, false);
      }
    }),
    workTreeView.onDidChangeSelection((event) => {
      workTreeProvider.setSelected(event.selection[0]?.id);
    }),

    glossaryTreeView.onDidExpandElement((event) => {
      if (event.element.id) {
        glossaryTreeProvider.setExpanded(event.element.id, true);
      }
    }),
    glossaryTreeView.onDidCollapseElement((event) => {
      if (event.element.id) {
        glossaryTreeProvider.setExpanded(event.element.id, false);
      }
    }),
    glossaryTreeView.onDidChangeSelection((event) => {
      glossaryTreeProvider.setSelected(event.selection[0]?.id);
    }),

    settingsTreeView.onDidExpandElement((event) => {
      if (event.element.id) {
        settingsTreeProvider.setGroupExpanded(event.element.id, true);
      }
    }),
    settingsTreeView.onDidCollapseElement((event) => {
      if (event.element.id) {
        settingsTreeProvider.setGroupExpanded(event.element.id, false);
      }
    }),
    settingsTreeView.onDidChangeSelection((event) => {
      settingsTreeProvider.setSelected(event.selection[0]?.id);
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY)) {
        safeRun(syncGlossaryAutocompleteLanguageMode(projectStore), "同步詞彙表自動完成語言模式");
      }
    }),

    vscode.commands.registerCommand("novelTranslate.createWork", () =>
      createWork(projectStore, workTreeProvider, glossaryTreeProvider)
    ),

    vscode.commands.registerCommand("novelTranslate.editWork", (item?: WorkTreeItem | GlossaryWorkTreeItem) =>
      editWork(projectStore, workTreeProvider, glossaryTreeProvider, item?.work.id)
    ),

    vscode.commands.registerCommand("novelTranslate.addChapter", (item?: WorkTreeItem) =>
      addChapter(projectStore, workTreeProvider, compareView, item)
    ),

    vscode.commands.registerCommand("novelTranslate.importChapterFile", (item?: WorkTreeItem) =>
      importChapterFile(projectStore, workTreeProvider, compareView, item)
    ),

    vscode.commands.registerCommand("novelTranslate.renameChapter", (item: ChapterTreeItem) =>
      renameChapter(projectStore, workTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.moveItemUp", (item: WorkTreeItem | ChapterTreeItem) =>
      moveTreeItem(projectStore, workTreeProvider, glossaryTreeProvider, item, -1)
    ),

    vscode.commands.registerCommand("novelTranslate.moveItemDown", (item: WorkTreeItem | ChapterTreeItem) =>
      moveTreeItem(projectStore, workTreeProvider, glossaryTreeProvider, item, 1)
    ),

    vscode.commands.registerCommand("novelTranslate.refreshWorks", () => workTreeProvider.refresh()),

    // 從標題列開啟時沒有傳入節點，改用側邊欄目前選取的作品（或章節所屬作品）當預設選取。
    // 狀態列會直接傳入作品 id。
    vscode.commands.registerCommand("novelTranslate.openWorkManager", (requestedWorkId?: unknown) => {
      const selected = workTreeView.selection[0];
      const selectedWorkId = selected instanceof ChapterTreeItem ? selected.workId : selected?.work.id;
      const workId = typeof requestedWorkId === "string" ? requestedWorkId : selectedWorkId;
      WorkManagerPanel.createOrShow(
        projectStore,
        workTreeProvider,
        glossaryTreeProvider,
        compareView,
        progressService,
        workId
      );
    }),

    vscode.commands.registerCommand("novelTranslate.openCompareView", (item?: ChapterTreeItem) =>
      openCompareView(projectStore, compareView, item?.chapter)
    ),

    vscode.commands.registerCommand("novelTranslate.jumpToNextUntranslated", () =>
      safeRun(jumpToNextUntranslated(compareView), "跳到下一個未翻譯行")
    ),

    vscode.commands.registerCommand("novelTranslate.toggleScrollSync", () => scrollSyncExtension.toggle()),

    vscode.commands.registerCommand("novelTranslate.toggleCompareLayout", () => toggleCompareLayout()),

    vscode.commands.registerCommand("novelTranslate.refreshGlossary", () => glossaryTreeProvider.refresh()),

    vscode.commands.registerCommand("novelTranslate.addGlossaryEntry", (item?: GlossaryWorkTreeItem) =>
      addGlossaryEntry(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.addGlossaryCategory", (item?: GlossaryWorkTreeItem) =>
      addGlossaryCategory(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.addGlossaryEntryToCategory", (item: GlossaryCategoryTreeItem) =>
      addGlossaryEntryToCategory(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.editGlossaryEntry", (item?: GlossaryEntryTreeItem) =>
      editGlossaryEntry(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.deleteGlossaryEntry", (item?: GlossaryEntryTreeItem) =>
      deleteGlossaryEntry(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.openGlossaryManager", (item?: GlossaryWorkTreeItem) =>
      GlossaryManagerPanel.createOrShow(projectStore, workTreeProvider, glossaryTreeProvider, item?.work.id)
    ),

    vscode.commands.registerCommand("novelTranslate.toggleAutocompleteMode", () => toggleAutocompleteMode()),

    vscode.languages.registerCompletionItemProvider(
      { language: TRANSLATION_LANGUAGE_ID },
      new GlossaryCompletionProvider(projectStore)
    ),

    vscode.languages.registerHoverProvider(
      { language: TRANSLATION_LANGUAGE_ID },
      new GlossaryHoverProvider(projectStore)
    ),

    vscode.languages.registerCompletionItemProvider(
      { language: TRANSLATION_LANGUAGE_ID },
      new PunctuationSuggestCompletionProvider(compareView)
    ),

    vscode.commands.registerCommand("novelTranslate.suggestPunctuationFromOriginal", () =>
      safeRun(suggestPunctuationFromOriginal(compareView), "推薦原文標點符號")
    ),

    vscode.commands.registerCommand("novelTranslate.configurePunctuationSuggestKeybinding", () =>
      safeRun(configurePunctuationSuggestKeybinding(), "開啟標點符號推薦快捷鍵設定")
    ),

    vscode.commands.registerCommand("novelTranslate.submitComment", (reply: vscode.CommentReply) =>
      submitComment(commentController, reply)
    ),

    vscode.commands.registerCommand("novelTranslate.toggleCommentResolved", (thread: vscode.CommentThread) =>
      toggleCommentResolved(commentController, thread)
    ),

    vscode.commands.registerCommand("novelTranslate.deleteCommentThread", (thread: vscode.CommentThread) =>
      deleteCommentThread(commentController, thread)
    ),

    vscode.commands.registerCommand("novelTranslate.importEpub", () => importEpub(projectStore, workTreeProvider)),

    vscode.commands.registerCommand("novelTranslate.exportEpub", (item?: WorkTreeItem) =>
      exportEpub(projectStore, item)
    ),

    vscode.commands.registerCommand("novelTranslate.upgradeEpubChapters", (item?: WorkTreeItem) =>
      upgradeEpubChapters(projectStore, workTreeProvider, commentController, item)
    ),

    vscode.commands.registerCommand(RESTORE_PROJECT_COMMAND_ID, () =>
      restoreProjectBackup(projectStore, () => {
        workTreeProvider.refresh();
        glossaryTreeProvider.refresh();
      })
    )
  );

  if (projectStore) {
    projectStore.onLoadFailure = notifyProjectLoadFailure;
    safeRun(projectStore.backupProject(), "備份 project.json");
  }

  safeRun(syncGlossaryAutocompleteLanguageMode(projectStore), "同步詞彙表自動完成語言模式");

  // 側邊欄三個 View 展開哪些節點已經在 getChildren() 裡依紀錄套用了，這裡只需要額外
  // 把「最後選取的節點」reveal 回來。畫面可能還沒就緒（例如側邊欄一開始沒被打開），
  // 所以每個區塊都要接住例外，不能讓它擋住其他初始化。
  const restoreTreeSelection = async (): Promise<void> => {
    try {
      const workId = workTreeProvider.getLastSelectedId();
      const item = workId ? await workTreeProvider.findItemById(workId) : undefined;
      if (item) {
        await workTreeView.reveal(item, { select: true, focus: false });
      }
    } catch (error) {
      console.error("[novelTranslate] 還原「作品總管」選取狀態時發生錯誤：", error);
    }

    try {
      const glossaryId = glossaryTreeProvider.getLastSelectedId();
      const item = glossaryId ? await glossaryTreeProvider.findItemById(glossaryId) : undefined;
      if (item) {
        await glossaryTreeView.reveal(item, { select: true, focus: false });
      }
    } catch (error) {
      console.error("[novelTranslate] 還原「詞彙表」選取狀態時發生錯誤：", error);
    }

    try {
      const settingsId = settingsTreeProvider.getLastSelectedId();
      const item = settingsId ? await settingsTreeProvider.findItemById(settingsId) : undefined;
      if (item) {
        await settingsTreeView.reveal(item, { select: true, focus: false });
      }
    } catch (error) {
      console.error("[novelTranslate] 還原「設置」選取狀態時發生錯誤：", error);
    }
  };

  void restoreTreeSelection();

  // 啟動當下 VS Code 可能還沒還原完上次開啟的分頁，所以先嘗試一次，沒找到配對的話
  // 就繼續監聽可見分頁變化，直到找到為止（找到後立即停止監聽，避免之後重複掃描）。
  // 這個過程會連鎖觸發游標／捲動同步等功能去操作編輯器，分頁可能還沒完全就緒，
  // 所以一定要接住例外，不然沒接住的 rejection 可能讓整個 Extension Host 行程掛掉。
  const tryRestoreComparePair = async (): Promise<boolean> => {
    try {
      return await restoreComparePairIfOpen(projectStore, compareView);
    } catch (error) {
      console.error("[novelTranslate] 還原比對配對時發生錯誤：", error);
      return false;
    }
  };

  void (async () => {
    if (await tryRestoreComparePair()) {
      return;
    }
    const retryOnVisibleEditorsChange = vscode.window.onDidChangeVisibleTextEditors(() => {
      void (async () => {
        if (await tryRestoreComparePair()) {
          retryOnVisibleEditorsChange.dispose();
        }
      })();
    });
    context.subscriptions.push(retryOnVisibleEditorsChange);
  })();
}

export function deactivate() {}
