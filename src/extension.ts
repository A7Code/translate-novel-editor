import * as vscode from "vscode";
import { WorkTreeProvider, ChapterTreeItem, WorkTreeItem } from "./work/workTreeProvider";
import { GlossaryEntryTreeItem, GlossaryTreeProvider, GlossaryWorkTreeItem } from "./views/glossaryTreeProvider";
import { GlossaryManagerPanel } from "./panels/glossaryManagerPanel";
import { SettingsTreeProvider } from "./views/settingsTreeProvider";
import { ProjectStore } from "./services/projectStore";
import { CompareView } from "./services/compareView/compareView";
import { CursorSyncExtension } from "./services/compareView/extensions/cursorSyncExtension";
import { ScrollSyncExtension } from "./services/compareView/extensions/scrollSyncExtension";
import { GlossaryLanguageModeExtension } from "./services/compareView/extensions/glossaryLanguageModeExtension";
import { addChapter, createWork, importChapterFile } from "./work/workCommands";
import {
  openCompareView,
  restoreComparePairIfOpen,
  syncGlossaryAutocompleteLanguageMode,
  toggleCompareLayout
} from "./commands/compareCommands";
import { addGlossaryEntry, deleteGlossaryEntry, editGlossaryEntry } from "./commands/glossaryCommands";
import { toggleAutocompleteMode } from "./commands/languageModeCommands";
import { GlossaryCompletionProvider } from "./providers/glossaryCompletionProvider";
import { NovelCommentController } from "./comments/novelCommentController";
import { deleteCommentThread, submitComment, toggleCommentResolved } from "./comments/commentCommands";
import { exportEpub, importEpub } from "./epub/epubCommands";
import { GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, TRANSLATION_LANGUAGE_ID } from "./constants";
import { safeRun } from "./services/safeRun";

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const projectStore = workspaceFolder ? new ProjectStore(workspaceFolder) : undefined;

  const workTreeProvider = new WorkTreeProvider(projectStore);
  const glossaryTreeProvider = new GlossaryTreeProvider(projectStore);
  const settingsTreeProvider = new SettingsTreeProvider();
  const compareView = new CompareView();
  const cursorSyncExtension = new CursorSyncExtension(compareView);
  const scrollSyncExtension = new ScrollSyncExtension(compareView);
  const glossaryLanguageModeExtension = new GlossaryLanguageModeExtension(compareView);
  const commentController = new NovelCommentController(projectStore);

  const settingsTreeView = vscode.window.createTreeView("novelTranslate.settings", {
    treeDataProvider: settingsTreeProvider
  });

  context.subscriptions.push(
    compareView,
    cursorSyncExtension,
    scrollSyncExtension,
    glossaryLanguageModeExtension,
    commentController,
    settingsTreeProvider,
    settingsTreeView,
    settingsTreeView.onDidChangeCheckboxState((event) => {
      for (const [item, state] of event.items) {
        settingsTreeProvider.handleCheckboxChange(item, state);
      }
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY)) {
        safeRun(syncGlossaryAutocompleteLanguageMode(projectStore), "同步詞彙表自動完成語言模式");
      }
    }),

    vscode.window.registerTreeDataProvider("novelTranslate.works", workTreeProvider),
    vscode.window.registerTreeDataProvider("novelTranslate.glossary", glossaryTreeProvider),

    vscode.commands.registerCommand("novelTranslate.createWork", () => createWork(projectStore, workTreeProvider)),

    vscode.commands.registerCommand("novelTranslate.addChapter", (item?: WorkTreeItem) =>
      addChapter(projectStore, workTreeProvider, compareView, item)
    ),

    vscode.commands.registerCommand("novelTranslate.importChapterFile", (item?: WorkTreeItem) =>
      importChapterFile(projectStore, workTreeProvider, compareView, item)
    ),

    vscode.commands.registerCommand("novelTranslate.refreshWorks", () => workTreeProvider.refresh()),

    vscode.commands.registerCommand("novelTranslate.openCompareView", (item?: ChapterTreeItem) =>
      openCompareView(projectStore, compareView, item?.chapter)
    ),

    vscode.commands.registerCommand("novelTranslate.toggleScrollSync", () => scrollSyncExtension.toggle()),

    vscode.commands.registerCommand("novelTranslate.toggleCompareLayout", () => toggleCompareLayout()),

    vscode.commands.registerCommand("novelTranslate.refreshGlossary", () => glossaryTreeProvider.refresh()),

    vscode.commands.registerCommand("novelTranslate.addGlossaryEntry", (item?: GlossaryWorkTreeItem) =>
      addGlossaryEntry(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.editGlossaryEntry", (item?: GlossaryEntryTreeItem) =>
      editGlossaryEntry(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.deleteGlossaryEntry", (item?: GlossaryEntryTreeItem) =>
      deleteGlossaryEntry(projectStore, glossaryTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.openGlossaryManager", (item?: GlossaryWorkTreeItem) =>
      GlossaryManagerPanel.createOrShow(projectStore, glossaryTreeProvider, item?.work.id)
    ),

    vscode.commands.registerCommand("novelTranslate.toggleAutocompleteMode", () => toggleAutocompleteMode()),

    vscode.languages.registerCompletionItemProvider(
      { language: TRANSLATION_LANGUAGE_ID },
      new GlossaryCompletionProvider(projectStore)
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
    )
  );

  safeRun(syncGlossaryAutocompleteLanguageMode(projectStore), "同步詞彙表自動完成語言模式");

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
