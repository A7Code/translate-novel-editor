import * as vscode from "vscode";
import * as path from "node:path";
import { getDefaultLanguages } from "../core/defaultLanguages";
import { ProjectStore } from "../core/projectStore";
import { WorkConfig } from "../core/types";
import { CompareView } from "../compareView/compareView";
import { ChapterTreeItem, WorkTreeItem, WorkTreeProvider } from "./workTreeProvider";
import { GlossaryTreeProvider } from "../glossary/glossaryTreeProvider";
import { openCompareView } from "../compareView/compareCommands";

// glossaryTreeProvider 是選擇性的：作品清單同時影響「作品總管」跟「詞彙表」兩個側邊欄，
// 兩邊都需要在作品新增／編輯後重新整理；從只關心作品總管的呼叫端（例如命令面板）則可以省略。
export async function createWork(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  glossaryTreeProvider?: GlossaryTreeProvider
): Promise<WorkConfig | undefined> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾，才能建立作品。");
    return undefined;
  }

  const title = await vscode.window.showInputBox({
    prompt: "作品名稱",
    placeHolder: "例如：魔法少女小說",
    validateInput: (value) => (value.trim() ? undefined : "請輸入作品名稱")
  });
  if (!title) {
    return undefined;
  }

  const author = await vscode.window.showInputBox({ prompt: "作者（可留空）" });
  const defaultLanguages = getDefaultLanguages();
  const sourceLanguage = await vscode.window.showInputBox({
    prompt: "原文語言代碼（可留空，例如 en、ja）",
    placeHolder: "en",
    value: defaultLanguages.source
  });
  const targetLanguage = await vscode.window.showInputBox({
    prompt: "譯文語言代碼（可留空，例如 zh-TW）",
    placeHolder: "zh-TW",
    value: defaultLanguages.target
  });

  const work = await store.addWork({
    title: title.trim(),
    author: author?.trim() || undefined,
    sourceLanguage: sourceLanguage?.trim() || undefined,
    targetLanguage: targetLanguage?.trim() || undefined
  });

  treeProvider.refresh();
  glossaryTreeProvider?.refresh();
  vscode.window.showInformationMessage(`已建立作品「${work.title}」。`);
  return work;
}

export async function editWork(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  glossaryTreeProvider: GlossaryTreeProvider,
  workId?: string
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const resolvedWorkId = workId ?? (await resolveWorkId(store));
  if (!resolvedWorkId) {
    return;
  }

  const config = await store.load();
  const work = config.works.find((candidate) => candidate.id === resolvedWorkId);
  if (!work) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "作品名稱",
    value: work.title,
    validateInput: (value) => (value.trim() ? undefined : "請輸入作品名稱")
  });
  if (!title) {
    return;
  }

  const author = await vscode.window.showInputBox({ prompt: "作者（可留空）", value: work.author });
  const sourceLanguage = await vscode.window.showInputBox({
    prompt: "原文語言代碼（可留空，例如 en、ja）",
    value: work.sourceLanguage
  });
  const targetLanguage = await vscode.window.showInputBox({
    prompt: "譯文語言代碼（可留空，例如 zh-TW）",
    value: work.targetLanguage
  });

  await store.updateWork(resolvedWorkId, {
    title: title.trim(),
    author: author?.trim() || undefined,
    sourceLanguage: sourceLanguage?.trim() || undefined,
    targetLanguage: targetLanguage?.trim() || undefined
  });

  treeProvider.refresh();
  glossaryTreeProvider.refresh();
  vscode.window.showInformationMessage(`已更新作品「${title.trim()}」。`);
}

export async function addChapter(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  compareView: CompareView,
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
  await openCompareView(store, compareView, chapter);
}

export async function renameChapter(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  item: ChapterTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "章節標題",
    value: item.chapter.title,
    validateInput: (value) => (value.trim() ? undefined : "請輸入章節標題")
  });
  if (!title) {
    return;
  }

  await store.renameChapter(item.workId, item.chapter.id, title.trim());
  treeProvider.refresh();
}

export async function moveTreeItem(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  glossaryTreeProvider: GlossaryTreeProvider,
  item: WorkTreeItem | ChapterTreeItem,
  delta: -1 | 1
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  if (item instanceof ChapterTreeItem) {
    if (await store.moveChapter(item.workId, item.chapter.id, delta)) {
      treeProvider.refresh();
    }
    return;
  }

  // 詞彙表側邊欄也依作品順序顯示，所以移動作品時兩邊都要更新。
  if (await store.moveWork(item.work.id, delta)) {
    treeProvider.refresh();
    glossaryTreeProvider.refresh();
  }
}

export async function importChapterFile(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  compareView: CompareView,
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
  await openCompareView(store, compareView, chapter);
}

// 刪除前先關掉這個章節／作品目前開著的分頁，避免刪除後分頁還指著一個已經被搬到 trash 的檔案。
async function closeOpenEditorsFor(uris: readonly vscode.Uri[]): Promise<void> {
  const targets = new Set(uris.map((uri) => uri.toString()));
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputText && targets.has(tab.input.uri.toString()));
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs);
  }
}

export async function deleteChapter(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  item: ChapterTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `確定要刪除章節「${item.chapter.title}」嗎？原文、譯文與翻譯筆記會移到 .novel-translate/trash/ 底下，不是立即永久刪除，但需要手動從那裡找回。`,
    { modal: true },
    "刪除"
  );
  if (confirmed !== "刪除") {
    return;
  }

  await closeOpenEditorsFor([
    store.resolveUri(item.chapter.originalPath),
    store.resolveUri(item.chapter.translationPath)
  ]);
  await store.deleteChapter(item.workId, item.chapter.id);
  treeProvider.refresh();
  vscode.window.showInformationMessage(`已刪除章節「${item.chapter.title}」，檔案已移到 .novel-translate/trash/。`);
}

// 作品的刪除範圍比章節大得多（所有章節、詞彙表、翻譯筆記），除了警告對話框，
// 還要求輸入完全相同的作品名稱才會真正刪除，降低手滑誤刪整部作品的風險。
export async function deleteWork(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  glossaryTreeProvider: GlossaryTreeProvider,
  item: WorkTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `確定要刪除作品「${item.work.title}」嗎？這會刪除底下所有 ${item.work.chapters.length} 個章節、詞彙表與翻譯筆記。檔案會移到 .novel-translate/trash/ 底下，不是立即永久刪除。`,
    { modal: true },
    "刪除"
  );
  if (confirmed !== "刪除") {
    return;
  }

  const typed = await vscode.window.showInputBox({
    prompt: `再次確認：輸入作品名稱「${item.work.title}」以刪除`,
    placeHolder: item.work.title,
    validateInput: (value) => (value === item.work.title ? undefined : "請輸入完全相同的作品名稱")
  });
  if (typed !== item.work.title) {
    return;
  }

  await closeOpenEditorsFor(
    item.work.chapters.flatMap((chapter) => [
      store.resolveUri(chapter.originalPath),
      store.resolveUri(chapter.translationPath)
    ])
  );
  await store.deleteWork(item.work.id);
  treeProvider.refresh();
  glossaryTreeProvider.refresh();
  vscode.window.showInformationMessage(`已刪除作品「${item.work.title}」，檔案已移到 .novel-translate/trash/。`);
}

async function resolveWorkId(store: ProjectStore, item?: WorkTreeItem): Promise<string | undefined> {
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
