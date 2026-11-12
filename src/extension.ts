import * as vscode from "vscode";
import { WorkTreeProvider, ChapterTreeItem, WorkTreeItem } from "./views/workTreeProvider";
import { GlossaryTreeProvider } from "./views/glossaryTreeProvider";
import { ProjectStore } from "./services/projectStore";
import { addChapter, createWork, importChapterFile, openChapterTranslation } from "./commands/workCommands";
import { openCompareView } from "./commands/compareCommands";
import { ChapterConfig } from "./types";

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const projectStore = workspaceFolder ? new ProjectStore(workspaceFolder) : undefined;

  const workTreeProvider = new WorkTreeProvider(projectStore);
  const glossaryTreeProvider = new GlossaryTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("novelTranslate.works", workTreeProvider),
    vscode.window.registerTreeDataProvider("novelTranslate.glossary", glossaryTreeProvider),

    vscode.commands.registerCommand("novelTranslate.createWork", () => createWork(projectStore, workTreeProvider)),

    vscode.commands.registerCommand("novelTranslate.addChapter", (item?: WorkTreeItem) =>
      addChapter(projectStore, workTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.importChapterFile", (item?: WorkTreeItem) =>
      importChapterFile(projectStore, workTreeProvider, item)
    ),

    vscode.commands.registerCommand("novelTranslate.openChapterTranslation", (chapter: ChapterConfig) =>
      openChapterTranslation(projectStore, chapter)
    ),

    vscode.commands.registerCommand("novelTranslate.refreshWorks", () => workTreeProvider.refresh()),

    vscode.commands.registerCommand("novelTranslate.openCompareView", (item?: ChapterTreeItem) =>
      openCompareView(projectStore, item)
    )
  );
}

export function deactivate() {}
