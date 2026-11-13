import * as vscode from "vscode";
import { WorkTreeProvider, ChapterTreeItem, WorkTreeItem } from "./views/workTreeProvider";
import { GlossaryEntryTreeItem, GlossaryTreeProvider, GlossaryWorkTreeItem } from "./views/glossaryTreeProvider";
import { SettingsTreeProvider } from "./views/settingsTreeProvider";
import { ProjectStore } from "./services/projectStore";
import { CompareScrollSync } from "./services/compareScrollSync";
import { CompareCursorSync } from "./services/compareCursorSync";
import { addChapter, createWork, importChapterFile } from "./commands/workCommands";
import { openCompareView, syncGlossaryAutocompleteLanguageMode, toggleCompareLayout } from "./commands/compareCommands";
import { addGlossaryEntry, deleteGlossaryEntry, editGlossaryEntry } from "./commands/glossaryCommands";
import { toggleAutocompleteMode } from "./commands/languageModeCommands";
import { GlossaryCompletionProvider } from "./providers/glossaryCompletionProvider";
import { NovelCommentController } from "./services/novelCommentController";
import { exportEpub, importEpub } from "./commands/epubCommands";
import { GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, TRANSLATION_LANGUAGE_ID } from "./constants";

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const projectStore = workspaceFolder ? new ProjectStore(workspaceFolder) : undefined;

  const workTreeProvider = new WorkTreeProvider(projectStore);
  const glossaryTreeProvider = new GlossaryTreeProvider(projectStore);
  const settingsTreeProvider = new SettingsTreeProvider();
  const compareScrollSync = new CompareScrollSync();
  const compareCursorSync = new CompareCursorSync();
  const commentController = new NovelCommentController(projectStore);

  const settingsTreeView = vscode.window.createTreeView("novelTranslate.settings", {
    treeDataProvider: settingsTreeProvider
  });

  context.subscriptions.push(
    compareScrollSync,
    compareCursorSync,
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
        void syncGlossaryAutocompleteLanguageMode(projectStore);
      }
    }),

    vscode.window.registerTreeDataProvider("novelTranslate.works", workTreeProvider),
    vscode.window.registerTreeDataProvider("novelTranslate.glossary", glossaryTreeProvider),

    vscode.commands.registerCommand("novelTranslate.createWork", () => createWork(projectStore, workTreeProvider)),

    vscode.commands.registerCommand("novelTranslate.addChapter", (item?: WorkTreeItem) =>
      addChapter(projectStore, workTreeProvider, compareScrollSync, compareCursorSync, item)
    ),

    vscode.commands.registerCommand("novelTranslate.importChapterFile", (item?: WorkTreeItem) =>
      importChapterFile(projectStore, workTreeProvider, compareScrollSync, compareCursorSync, item)
    ),

    vscode.commands.registerCommand("novelTranslate.refreshWorks", () => workTreeProvider.refresh()),

    vscode.commands.registerCommand("novelTranslate.openCompareView", (item?: ChapterTreeItem) =>
      openCompareView(projectStore, compareScrollSync, compareCursorSync, item?.chapter)
    ),

    vscode.commands.registerCommand("novelTranslate.toggleScrollSync", () => compareScrollSync.toggle()),

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

    vscode.commands.registerCommand("novelTranslate.toggleAutocompleteMode", () => toggleAutocompleteMode()),

    vscode.languages.registerCompletionItemProvider(
      { language: TRANSLATION_LANGUAGE_ID },
      new GlossaryCompletionProvider(projectStore)
    ),

    vscode.commands.registerCommand("novelTranslate.submitComment", (reply: vscode.CommentReply) =>
      commentController.submitComment(reply)
    ),

    vscode.commands.registerCommand("novelTranslate.toggleCommentResolved", (thread: vscode.CommentThread) =>
      commentController.toggleResolved(thread)
    ),

    vscode.commands.registerCommand("novelTranslate.deleteCommentThread", (thread: vscode.CommentThread) =>
      commentController.deleteThread(thread)
    ),

    vscode.commands.registerCommand("novelTranslate.importEpub", () => importEpub(projectStore, workTreeProvider)),

    vscode.commands.registerCommand("novelTranslate.exportEpub", (item?: WorkTreeItem) =>
      exportEpub(projectStore, item)
    )
  );

  void syncGlossaryAutocompleteLanguageMode(projectStore);
}

export function deactivate() {}
