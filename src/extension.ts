import * as vscode from "vscode";
import { WorkTreeProvider, ChapterTreeItem, WorkTreeItem } from "./views/workTreeProvider";
import { GlossaryEntryTreeItem, GlossaryTreeProvider, GlossaryWorkTreeItem } from "./views/glossaryTreeProvider";
import { SettingsTreeProvider } from "./views/settingsTreeProvider";
import { ProjectStore } from "./services/projectStore";
import { CompareScrollSync } from "./services/compareScrollSync";
import { addChapter, createWork, importChapterFile } from "./commands/workCommands";
import { openCompareView } from "./commands/compareCommands";
import { addGlossaryEntry, deleteGlossaryEntry, editGlossaryEntry } from "./commands/glossaryCommands";
import { toggleAutocompleteMode } from "./commands/languageModeCommands";
import { GlossaryCompletionProvider } from "./providers/glossaryCompletionProvider";
import { TRANSLATION_LANGUAGE_ID } from "./constants";

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const projectStore = workspaceFolder ? new ProjectStore(workspaceFolder) : undefined;

  const workTreeProvider = new WorkTreeProvider(projectStore);
  const glossaryTreeProvider = new GlossaryTreeProvider(projectStore);
  const settingsTreeProvider = new SettingsTreeProvider();
  const compareScrollSync = new CompareScrollSync();

  const settingsTreeView = vscode.window.createTreeView("novelTranslate.settings", {
    treeDataProvider: settingsTreeProvider
  });

  context.subscriptions.push(
    compareScrollSync,
    settingsTreeProvider,
    settingsTreeView,
    settingsTreeView.onDidChangeCheckboxState((event) => {
      for (const [item, state] of event.items) {
        settingsTreeProvider.handleCheckboxChange(item, state);
      }
    }),

    vscode.window.registerTreeDataProvider("novelTranslate.works", workTreeProvider),
    vscode.window.registerTreeDataProvider("novelTranslate.glossary", glossaryTreeProvider),

    vscode.commands.registerCommand("novelTranslate.createWork", () => createWork(projectStore, workTreeProvider)),

    vscode.commands.registerCommand("novelTranslate.addChapter", (item?: WorkTreeItem) =>
      addChapter(projectStore, workTreeProvider, compareScrollSync, item)
    ),

    vscode.commands.registerCommand("novelTranslate.importChapterFile", (item?: WorkTreeItem) =>
      importChapterFile(projectStore, workTreeProvider, compareScrollSync, item)
    ),

    vscode.commands.registerCommand("novelTranslate.refreshWorks", () => workTreeProvider.refresh()),

    vscode.commands.registerCommand("novelTranslate.openCompareView", (item?: ChapterTreeItem) =>
      openCompareView(projectStore, compareScrollSync, item?.chapter)
    ),

    vscode.commands.registerCommand("novelTranslate.toggleScrollSync", () => compareScrollSync.toggle()),

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
    )
  );
}

export function deactivate() {}
