import * as vscode from "vscode";
import * as path from "node:path";
import { ProjectStore } from "../services/projectStore";
import { WorkTreeItem, WorkTreeProvider } from "../views/workTreeProvider";
import { applyTranslationToChapterHtml, buildEpubZip, extractParagraphTexts, parseEpub } from "../services/epubService";

export async function importEpub(store: ProjectStore | undefined, treeProvider: WorkTreeProvider): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "EPUB 電子書": ["epub"] },
    openLabel: "匯入 EPUB"
  });
  if (!picked || picked.length === 0) {
    return;
  }

  const parsed = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "解析 EPUB 中..." },
    async () => {
      try {
        const bytes = await vscode.workspace.fs.readFile(picked[0]);
        return await parseEpub(bytes);
      } catch (error) {
        vscode.window.showErrorMessage(`解析 EPUB 失敗：${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    }
  );
  if (!parsed) {
    return;
  }

  const defaultTitle = parsed.title ?? path.basename(picked[0].fsPath, path.extname(picked[0].fsPath));
  const title = await vscode.window.showInputBox({
    prompt: "作品名稱",
    value: defaultTitle,
    validateInput: (value) => (value.trim() ? undefined : "請輸入作品名稱")
  });
  if (!title) {
    return;
  }

  const author = await vscode.window.showInputBox({ prompt: "作者（可留空）", value: parsed.author });
  const sourceLanguage = await vscode.window.showInputBox({
    prompt: "原文語言代碼（可留空，例如 en、ja）",
    value: parsed.language
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

  let importedCount = 0;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `匯入「${work.title}」的章節中...` },
    async (progress) => {
      await store.setEpubSource(work.id, parsed.opfPath);
      const increment = 100 / parsed.chapters.length;
      for (const chapter of parsed.chapters) {
        progress.report({ message: chapter.title, increment });
        const paragraphs = extractParagraphTexts(chapter.html);
        if (paragraphs.length === 0) {
          continue;
        }
        await store.addChapter(work.id, chapter.title, paragraphs.join("\n"), chapter.contentPath);
        importedCount++;
      }
      await store.writeEpubPackageFiles(work.id, parsed.files);
    }
  );

  treeProvider.refresh();
  vscode.window.showInformationMessage(`已匯入作品「${work.title}」，共 ${importedCount} 章。`);
}

export async function exportEpub(store: ProjectStore | undefined, item?: WorkTreeItem): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const workId = item ? item.work.id : await pickEpubWorkId(store);
  if (!workId) {
    return;
  }

  const config = await store.load();
  const work = config.works.find((candidate) => candidate.id === workId);
  if (!work?.epubSource) {
    vscode.window.showErrorMessage("這個作品不是從 EPUB 匯入的，無法匯出。");
    return;
  }

  const saveUri = await vscode.window.showSaveDialog({
    filters: { "EPUB 電子書": ["epub"] },
    defaultUri: vscode.Uri.joinPath(store.resolveUri("."), `${sanitizeFileName(work.title)}.epub`)
  });
  if (!saveUri) {
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `匯出「${work.title}」為 EPUB 中...` },
    async () => {
      const files = await store.listEpubPackageFiles(workId);
      const overrides = new Map<string, string>();

      for (const chapter of work.chapters) {
        if (!chapter.epubContentPath) {
          continue;
        }
        const htmlBytes = files.get(chapter.epubContentPath);
        if (!htmlBytes) {
          continue;
        }
        const html = Buffer.from(htmlBytes).toString("utf8");

        let translationText = "";
        try {
          const bytes = await vscode.workspace.fs.readFile(store.resolveUri(chapter.translationPath));
          translationText = Buffer.from(bytes).toString("utf8");
        } catch {
          // 沒有譯文檔案就保留原文不動
        }

        overrides.set(chapter.epubContentPath, applyTranslationToChapterHtml(html, translationText));
      }

      const epubBytes = await buildEpubZip(files, overrides);
      await vscode.workspace.fs.writeFile(saveUri, epubBytes);
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

async function pickEpubWorkId(store: ProjectStore): Promise<string | undefined> {
  const config = await store.load();
  const epubWorks = config.works.filter((work) => work.epubSource);
  if (epubWorks.length === 0) {
    vscode.window.showErrorMessage("目前沒有從 EPUB 匯入的作品。");
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    epubWorks.map((work) => ({ label: work.title, work })),
    { placeHolder: "選擇要匯出的作品" }
  );
  return picked?.work.id;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "novel";
}
