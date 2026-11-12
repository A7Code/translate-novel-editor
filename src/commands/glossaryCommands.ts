import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { GlossaryEntry } from "../types";
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

  const workId = item ? item.work.id : await resolveWorkId(store);
  if (!workId) {
    return;
  }

  const selectedTerm = getSelectedText();
  if (selectedTerm) {
    const existing = await store.findGlossaryEntryByTerm(workId, selectedTerm);
    if (existing) {
      vscode.window.showInformationMessage(`詞彙「${selectedTerm}」已存在，已切換為修改模式。`);
      await runEditFlow(store, treeProvider, workId, existing);
      return;
    }
  }

  await runAddFlow(store, treeProvider, workId, selectedTerm);
}

export async function editGlossaryEntry(
  store: ProjectStore | undefined,
  treeProvider: GlossaryTreeProvider,
  item?: GlossaryEntryTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  if (item) {
    await runEditFlow(store, treeProvider, item.workId, item.entry);
    return;
  }

  const workId = await resolveWorkId(store);
  if (!workId) {
    return;
  }

  const selectedTerm = getSelectedText();
  if (selectedTerm) {
    const existing = await store.findGlossaryEntryByTerm(workId, selectedTerm);
    if (existing) {
      await runEditFlow(store, treeProvider, workId, existing);
      return;
    }
    vscode.window.showInformationMessage(`找不到詞彙「${selectedTerm}」的詞條，已切換為新增模式。`);
    await runAddFlow(store, treeProvider, workId, selectedTerm);
    return;
  }

  const entry = await pickGlossaryEntry(store, workId);
  if (!entry) {
    return;
  }
  await runEditFlow(store, treeProvider, workId, entry);
}

export async function deleteGlossaryEntry(
  store: ProjectStore | undefined,
  treeProvider: GlossaryTreeProvider,
  item?: GlossaryEntryTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  let workId: string;
  let entry: GlossaryEntry | undefined;

  if (item) {
    workId = item.workId;
    entry = item.entry;
  } else {
    const resolvedWorkId = await resolveWorkId(store);
    if (!resolvedWorkId) {
      return;
    }
    workId = resolvedWorkId;

    const selectedTerm = getSelectedText();
    if (selectedTerm) {
      entry = await store.findGlossaryEntryByTerm(workId, selectedTerm);
      if (!entry) {
        vscode.window.showWarningMessage(`找不到詞彙「${selectedTerm}」對應的詞條。`);
        return;
      }
    } else {
      entry = await pickGlossaryEntry(store, workId);
      if (!entry) {
        return;
      }
    }
  }

  const confirmed = await vscode.window.showWarningMessage(
    `確定要刪除詞條「${entry.term} → ${entry.translation}」嗎？`,
    { modal: true },
    "刪除"
  );
  if (confirmed !== "刪除") {
    return;
  }

  await store.deleteGlossaryEntry(workId, entry.id);
  treeProvider.refresh();
}

async function runAddFlow(
  store: ProjectStore,
  treeProvider: GlossaryTreeProvider,
  workId: string,
  prefillTerm?: string
): Promise<void> {
  const input = await promptGlossaryInput(prefillTerm ? { term: prefillTerm, translation: "" } : undefined);
  if (!input) {
    return;
  }

  await store.addGlossaryEntry(workId, input);
  treeProvider.refresh();
}

async function runEditFlow(
  store: ProjectStore,
  treeProvider: GlossaryTreeProvider,
  workId: string,
  entry: GlossaryEntry
): Promise<void> {
  const input = await promptGlossaryInput(entry);
  if (!input) {
    return;
  }

  await store.updateGlossaryEntry(workId, entry.id, input);
  treeProvider.refresh();
}

function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }
  const text = editor.document.getText(editor.selection).trim();
  return text || undefined;
}

async function pickGlossaryEntry(store: ProjectStore, workId: string): Promise<GlossaryEntry | undefined> {
  const config = await store.load();
  const work = config.works.find((candidate) => candidate.id === workId);
  if (!work || work.glossary.length === 0) {
    vscode.window.showInformationMessage("這個作品還沒有詞條。");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    work.glossary.map((entry) => ({
      label: `${entry.term} → ${entry.translation}`,
      description: entry.category,
      detail: entry.note,
      entry
    })),
    { placeHolder: "選擇要操作的詞條" }
  );
  return picked?.entry;
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

async function resolveWorkId(store: ProjectStore): Promise<string | undefined> {
  const config = await store.load();
  if (config.works.length === 0) {
    vscode.window.showErrorMessage("請先到「作品總管」建立作品。");
    return undefined;
  }

  if (config.works.length === 1) {
    return config.works[0].id;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const fromActiveEditor = activeUri ? await store.findWorkIdForDocumentUri(activeUri) : undefined;
  if (fromActiveEditor) {
    return fromActiveEditor;
  }

  const picked = await vscode.window.showQuickPick(
    config.works.map((work) => ({ label: work.title, work })),
    { placeHolder: "選擇要操作的作品" }
  );
  return picked?.work.id;
}
