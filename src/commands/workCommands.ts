import * as vscode from "vscode";
import * as path from "node:path";
import { ProjectStore } from "../services/projectStore";
import { WorkTreeItem, WorkTreeProvider } from "../views/workTreeProvider";
import { ChapterConfig } from "../types";

export async function createWork(store: ProjectStore | undefined, treeProvider: WorkTreeProvider): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾，才能建立作品。");
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "作品名稱",
    placeHolder: "例如：魔法少女小說",
    validateInput: (value) => (value.trim() ? undefined : "請輸入作品名稱")
  });
  if (!title) {
    return;
  }

  const author = await vscode.window.showInputBox({ prompt: "作者（可留空）" });
  const sourceLanguage = await vscode.window.showInputBox({
    prompt: "原文語言代碼（可留空，例如 en、ja）",
    placeHolder: "en"
  });
  const targetLanguage = await vscode.window.showInputBox({
    prompt: "譯文語言代碼（可留空，例如 zh-TW）",
    placeHolder: "zh-TW"
  });

  const work = await store.addWork({
    title: title.trim(),
    author: author?.trim() || undefined,
    sourceLanguage: sourceLanguage?.trim() || undefined,
    targetLanguage: targetLanguage?.trim() || undefined
  });

  treeProvider.refresh();
  vscode.window.showInformationMessage(`已建立作品「${work.title}」。`);
}

export async function addChapter(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  item?: WorkTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const workId = await resolveWorkId(store, item);
  if (!workId) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "章節標題",
    placeHolder: "例如：第一章",
    validateInput: (value) => (value.trim() ? undefined : "請輸入章節標題")
  });
  if (!title) {
    return;
  }

  const chapter = await store.addChapter(workId, title.trim());
  treeProvider.refresh();
  await openTranslationDocument(store, chapter);
}

export async function importChapterFile(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  item?: WorkTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const workId = await resolveWorkId(store, item);
  if (!workId) {
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "文字檔": ["txt", "md"] },
    openLabel: "匯入為章節原文"
  });
  if (!picked || picked.length === 0) {
    return;
  }

  const bytes = await vscode.workspace.fs.readFile(picked[0]);
  const content = Buffer.from(bytes).toString("utf8");
  const fileName = path.basename(picked[0].fsPath);
  const defaultTitle = fileName.slice(0, fileName.length - path.extname(fileName).length) || fileName;

  const title = await vscode.window.showInputBox({
    prompt: "章節標題",
    value: defaultTitle,
    validateInput: (value) => (value.trim() ? undefined : "請輸入章節標題")
  });
  if (!title) {
    return;
  }

  const chapter = await store.addChapter(workId, title.trim(), content);
  treeProvider.refresh();
  vscode.window.showInformationMessage(`已匯入章節「${chapter.title}」。`);
}

export async function openChapterTranslation(store: ProjectStore | undefined, chapter: ChapterConfig): Promise<void> {
  if (!store) {
    return;
  }
  await openTranslationDocument(store, chapter);
}

async function openTranslationDocument(store: ProjectStore, chapter: ChapterConfig): Promise<void> {
  const document = await vscode.workspace.openTextDocument(store.resolveUri(chapter.translationPath));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function resolveWorkId(store: ProjectStore, item: WorkTreeItem | undefined): Promise<string | undefined> {
  if (item) {
    return item.work.id;
  }

  const config = await store.load();
  if (config.works.length === 0) {
    vscode.window.showErrorMessage("請先建立作品。");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    config.works.map((work) => ({ label: work.title, work })),
    { placeHolder: "選擇要加入章節的作品" }
  );
  return picked?.work.id;
}
