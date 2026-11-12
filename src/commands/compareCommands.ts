import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { ChapterConfig } from "../types";
import { ChapterTreeItem } from "../views/workTreeProvider";

let lockedScrollingEnabled = false;

export async function openCompareView(store: ProjectStore | undefined, item?: ChapterTreeItem): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const chapter = item ? item.chapter : await pickChapter(store);
  if (!chapter) {
    return;
  }

  const originalDocument = await vscode.workspace.openTextDocument(store.resolveUri(chapter.originalPath));
  await vscode.window.showTextDocument(originalDocument, {
    viewColumn: vscode.ViewColumn.One,
    preview: false
  });
  await vscode.commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");

  const translationDocument = await vscode.workspace.openTextDocument(store.resolveUri(chapter.translationPath));
  await vscode.window.showTextDocument(translationDocument, {
    viewColumn: vscode.ViewColumn.Two,
    preview: false
  });

  if (!lockedScrollingEnabled) {
    await vscode.commands.executeCommand("workbench.action.toggleLockedScrolling");
    lockedScrollingEnabled = true;
  }
}

async function pickChapter(store: ProjectStore): Promise<ChapterConfig | undefined> {
  const config = await store.load();
  if (config.works.length === 0) {
    vscode.window.showErrorMessage("請先建立作品與章節。");
    return undefined;
  }

  const workPick = await vscode.window.showQuickPick(
    config.works.map((work) => ({ label: work.title, work })),
    { placeHolder: "選擇作品" }
  );
  if (!workPick) {
    return undefined;
  }
  if (workPick.work.chapters.length === 0) {
    vscode.window.showErrorMessage("這個作品還沒有章節。");
    return undefined;
  }

  const chapterPick = await vscode.window.showQuickPick(
    workPick.work.chapters.map((chapter) => ({ label: chapter.title, chapter })),
    { placeHolder: "選擇章節" }
  );
  return chapterPick?.chapter;
}
