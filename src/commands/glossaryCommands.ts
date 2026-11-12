import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { GlossaryEntryTreeItem, GlossaryTreeProvider, GlossaryWorkTreeItem } from "../views/glossaryTreeProvider";

export async function addGlossaryEntry(
  store: ProjectStore | undefined,
  treeProvider: GlossaryTreeProvider,
  item?: GlossaryWorkTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const workId = await resolveWorkId(store, item);
  if (!workId) {
    return;
  }

  const input = await promptGlossaryInput();
  if (!input) {
    return;
  }

  await store.addGlossaryEntry(workId, input);
  treeProvider.refresh();
}

export async function editGlossaryEntry(
  store: ProjectStore | undefined,
  treeProvider: GlossaryTreeProvider,
  item?: GlossaryEntryTreeItem
): Promise<void> {
  if (!store || !item) {
    return;
  }

  const input = await promptGlossaryInput(item.entry);
  if (!input) {
    return;
  }

  await store.updateGlossaryEntry(item.workId, item.entry.id, input);
  treeProvider.refresh();
}

export async function deleteGlossaryEntry(
  store: ProjectStore | undefined,
  treeProvider: GlossaryTreeProvider,
  item?: GlossaryEntryTreeItem
): Promise<void> {
  if (!store || !item) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `確定要刪除詞條「${item.entry.term} → ${item.entry.translation}」嗎？`,
    { modal: true },
    "刪除"
  );
  if (confirmed !== "刪除") {
    return;
  }

  await store.deleteGlossaryEntry(item.workId, item.entry.id);
  treeProvider.refresh();
}

async function promptGlossaryInput(existing?: {
  term: string;
  translation: string;
  category?: string;
  note?: string;
}): Promise<{ term: string; translation: string; category?: string; note?: string } | undefined> {
  const term = await vscode.window.showInputBox({
    prompt: "原文詞彙",
    value: existing?.term,
    validateInput: (value) => (value.trim() ? undefined : "請輸入原文詞彙")
  });
  if (!term) {
    return undefined;
  }

  const translation = await vscode.window.showInputBox({
    prompt: "譯名",
    value: existing?.translation,
    validateInput: (value) => (value.trim() ? undefined : "請輸入譯名")
  });
  if (!translation) {
    return undefined;
  }

  const category = await vscode.window.showInputBox({
    prompt: "分類（可留空，例如：人名、地名、專有名詞）",
    value: existing?.category
  });

  const note = await vscode.window.showInputBox({
    prompt: "備註（可留空）",
    value: existing?.note
  });

  return {
    term: term.trim(),
    translation: translation.trim(),
    category: category?.trim() || undefined,
    note: note?.trim() || undefined
  };
}

async function resolveWorkId(store: ProjectStore, item?: GlossaryWorkTreeItem): Promise<string | undefined> {
  if (item) {
    return item.work.id;
  }

  const config = await store.load();
  if (config.works.length === 0) {
    vscode.window.showErrorMessage("請先到「作品總管」建立作品。");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    config.works.map((work) => ({ label: work.title, work })),
    { placeHolder: "選擇要加入詞條的作品" }
  );
  return picked?.work.id;
}
