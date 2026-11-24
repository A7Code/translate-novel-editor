import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { WorkTreeItem } from "../work/workTreeProvider";
import { buildPlainTextExport, ChapterTextExportInput, PlainTextExportMode } from "./plainTextExport";

/** 匯出整部作品為純文字檔，可選「只有譯文」或「雙語逐行對照」（1.11）。 */
export async function exportPlainText(store: ProjectStore | undefined, item?: WorkTreeItem): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const workId = item ? item.work.id : await pickWorkId(store);
  if (!workId) {
    return;
  }

  const config = await store.load();
  const work = config.works.find((candidate) => candidate.id === workId);
  if (!work) {
    return;
  }
  if (work.chapters.length === 0) {
    vscode.window.showErrorMessage("這個作品還沒有章節。");
    return;
  }

  const modePick = await vscode.window.showQuickPick<{ label: string; description: string; mode: PlainTextExportMode }>(
    [
      { label: "只有譯文", description: "每章輸出標題與目前的譯文內容", mode: "translationOnly" },
      { label: "雙語逐行對照", description: "每行先輸出原文、再輸出對應的譯文", mode: "bilingual" }
    ],
    { placeHolder: "選擇匯出格式" }
  );
  if (!modePick) {
    return;
  }

  const saveUri = await vscode.window.showSaveDialog({
    filters: { "文字檔": ["txt"] },
    defaultUri: vscode.Uri.joinPath(store.resolveUri("."), `${sanitizeFileName(work.title)}.txt`)
  });
  if (!saveUri) {
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `匯出「${work.title}」為純文字中...` },
    async () => {
      const chapters: ChapterTextExportInput[] = await Promise.all(
        work.chapters.map(async (chapter) => ({
          title: chapter.title,
          original: await readText(store, chapter.originalPath),
          translation: await readText(store, chapter.translationPath)
        }))
      );
      const content = buildPlainTextExport(chapters, modePick.mode);
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, "utf8"));
    }
  );

  const revealAction = "在檔案總管中顯示";
  const selection = await vscode.window.showInformationMessage(
    `已匯出「${work.title}」到 ${saveUri.fsPath}`,
    revealAction
  );
  if (selection === revealAction) {
    void vscode.commands.executeCommand("revealFileInOS", saveUri);
  }
}

// 優先讀取開啟中、尚未儲存的編輯器內容，跟搜尋／翻譯進度的讀檔方式一致。
async function readText(store: ProjectStore, relativePath: string): Promise<string> {
  const uri = store.resolveUri(relativePath);
  const target = uri.toString();
  const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === target);
  if (document) {
    return document.getText();
  }
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return "";
    }
    throw error;
  }
}

async function pickWorkId(store: ProjectStore): Promise<string | undefined> {
  const config = await store.load();
  if (config.works.length === 0) {
    vscode.window.showErrorMessage("請先建立作品。");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    config.works.map((work) => ({ label: work.title, work })),
    { placeHolder: "選擇要匯出的作品" }
  );
  return picked?.work.id;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "novel";
}
