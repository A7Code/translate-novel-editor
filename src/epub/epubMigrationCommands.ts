import * as vscode from "vscode";
import { commentFilePath } from "../comments/commentStore";
import { isCommentThreadList } from "../comments/commentMerge";
import { NovelCommentController } from "../comments/novelCommentController";
import { BACKUP_DIR, ProjectStore } from "../core/projectStore";
import { ChapterConfig, WorkConfig } from "../core/types";
import { WorkTreeItem, WorkTreeProvider } from "../work/workTreeProvider";
import { ChapterMigrationPlan, planChapterMigration, remapCommentThreads } from "./epubMigration";
import { CURRENT_EPUB_EXTRACT_VERSION } from "./epubService";

interface PlannedChapter {
  chapter: ChapterConfig;
  plan: ChapterMigrationPlan;
}

function needsUpgrade(chapter: ChapterConfig): boolean {
  return Boolean(chapter.epubContentPath) && (chapter.extractVersion ?? 1) < CURRENT_EPUB_EXTRACT_VERSION;
}

async function readText(store: ProjectStore, path: string): Promise<string> {
  const bytes = await store.files.readBytes(path);
  return bytes ? Buffer.from(bytes).toString("utf8") : "";
}

async function pickWork(store: ProjectStore, item?: WorkTreeItem): Promise<WorkConfig | undefined> {
  const config = await store.load();
  if (item) {
    return config.works.find((work) => work.id === item.work.id);
  }
  const candidates = config.works.filter((work) => work.epubSource && work.chapters.some(needsUpgrade));
  if (candidates.length === 0) {
    vscode.window.showInformationMessage("沒有需要升級的 EPUB 章節。");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((work) => ({
      label: work.title,
      description: `${work.chapters.filter(needsUpgrade).length} 章待升級`,
      work
    })),
    { placeHolder: "選擇要升級的 EPUB 作品" }
  );
  return picked?.work;
}

function findOpenChapters(store: ProjectStore, chapters: ChapterConfig[]): ChapterConfig[] {
  const openUris = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        openUris.add(tab.input.uri.toString());
      }
    }
  }
  for (const document of vscode.workspace.textDocuments) {
    if (document.isDirty) {
      openUris.add(document.uri.toString());
    }
  }
  return chapters.filter(
    (chapter) =>
      openUris.has(store.resolveUri(chapter.originalPath).toString()) ||
      openUris.has(store.resolveUri(chapter.translationPath).toString())
  );
}

function buildReport(work: WorkConfig, planned: PlannedChapter[], backupDir: string): string {
  const lines = [`# EPUB 章節升級報告：${work.title}`, "", `備份位置：\`${backupDir}\``, ""];
  for (const { chapter, plan } of planned) {
    if (plan.status === "blocked") {
      lines.push(`## ${chapter.title}（${chapter.id}）：未升級`, "", `- ${plan.reason}`, "");
      continue;
    }
    if (plan.needsReview.length === 0 && plan.unplaced.length === 0) {
      continue;
    }
    lines.push(`## ${chapter.title}（${chapter.id}）`, "");
    for (const entry of plan.needsReview) {
      lines.push(`- 需要拆分：舊第 ${entry.oldLine + 1} 行已放到新第 ${entry.newLine + 1} 行：${entry.text}`);
    }
    for (const entry of plan.unplaced) {
      lines.push(`- 未放入譯文檔：舊第 ${entry.oldLine + 1} 行：${entry.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function upgradeEpubChapters(
  store: ProjectStore | undefined,
  treeProvider: WorkTreeProvider,
  commentController: NovelCommentController,
  item?: WorkTreeItem
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }
  const work = await pickWork(store, item);
  if (!work?.epubSource) {
    return;
  }
  const chapters = work.chapters.filter(needsUpgrade);
  if (chapters.length === 0) {
    vscode.window.showInformationMessage(`「${work.title}」的章節都已是最新格式。`);
    return;
  }

  const open = findOpenChapters(store, chapters);
  if (open.length > 0) {
    vscode.window.showWarningMessage(
      `請先儲存並關閉這些章節的分頁後再升級：${open.map((chapter) => chapter.title).join("、")}`
    );
    return;
  }

  const packageDir = work.epubSource.packageDir;
  const planned: PlannedChapter[] = [];
  for (const chapter of chapters) {
    const htmlBytes = await store.files.readBytes(`${packageDir}/${chapter.epubContentPath}`);
    if (!htmlBytes) {
      planned.push({ chapter, plan: { status: "blocked", reason: "找不到對應的 EPUB 章節檔" } });
      continue;
    }
    const plan = planChapterMigration(
      Buffer.from(htmlBytes).toString("utf8"),
      await readText(store, chapter.originalPath),
      await readText(store, chapter.translationPath)
    );
    planned.push({ chapter, plan });
  }

  const changed = planned.filter(({ plan }) => plan.status === "changed");
  const unchanged = planned.filter(({ plan }) => plan.status === "unchanged");
  const blocked = planned.filter(({ plan }) => plan.status === "blocked");
  const reviewCount = planned.reduce(
    (sum, { plan }) => sum + (plan.status === "blocked" ? 0 : plan.needsReview.length + plan.unplaced.length),
    0
  );

  const upgradeAction = "備份並升級";
  const detail = [
    `行號會變動：${changed.length} 章${changed.length ? `（${changed.slice(0, 8).map(({ chapter }) => chapter.title).join("、")}${changed.length > 8 ? "…" : ""}）` : ""}`,
    `內容不變：${unchanged.length} 章`,
    `無法自動升級（維持舊格式）：${blocked.length} 章`,
    `需要人工確認的譯文：${reviewCount} 筆`,
    "",
    "升級前會備份原文、譯文、註解和 project.json。"
  ].join("\n");
  const answer = await vscode.window.showWarningMessage(
    `升級「${work.title}」的 EPUB 章節？`,
    { modal: true, detail },
    upgradeAction
  );
  if (answer !== upgradeAction) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const backupDir = `${BACKUP_DIR}/epub-upgrade-${stamp}`;
  const projectBytes = await store.files.readBytes(".novel-translate/project.json");
  if (projectBytes) {
    await store.files.writeBytes(`${backupDir}/project.json`, projectBytes);
  }

  // 先完成全部備份，任何一章備份失敗都不會開始改檔。
  for (const { chapter } of changed) {
    const chapterBackup = `${backupDir}/${work.id}/${chapter.id}`;
    const sources: Array<[string, string]> = [
      [chapter.originalPath, "original.txt"],
      [chapter.translationPath, "translation.txt"],
      [commentFilePath(work.id, chapter.id), "comments.json"]
    ];
    for (const [source, name] of sources) {
      const bytes = await store.files.readBytes(source);
      if (bytes) {
        await store.files.writeBytes(`${chapterBackup}/${name}`, bytes);
      }
    }
  }

  const reportPath = `${backupDir}/report.md`;
  await store.files.writeBytes(reportPath, Buffer.from(buildReport(work, planned, backupDir), "utf8"));

  for (const { chapter, plan } of planned) {
    if (plan.status === "blocked") {
      continue;
    }
    if (plan.status === "changed") {
      const commentPath = commentFilePath(work.id, chapter.id);
      const comments = await store.files.readJson(commentPath, isCommentThreadList);
      if (comments.kind === "unreadable") {
        throw new Error(`註解檔無法讀取，已停止升級「${chapter.title}」：${comments.error.message}`);
      }
      await store.files.writeBytes(chapter.translationPath, Buffer.from(plan.newTranslation, "utf8"));
      await store.files.writeBytes(chapter.originalPath, Buffer.from(plan.newOriginal, "utf8"));
      if (comments.kind === "ok") {
        await store.files.writeJson(commentPath, remapCommentThreads(comments.value, plan.lineMap));
      }
    }
    await store.setChapterExtractVersion(work.id, chapter.id, CURRENT_EPUB_EXTRACT_VERSION);
    await commentController.reloadChapter(work.id, chapter.id);
  }

  treeProvider.refresh();

  const upgradedCount = changed.length + unchanged.length;
  const openReport = "開啟報告";
  const message = `已升級 ${upgradedCount} 章，${blocked.length} 章維持舊格式，${reviewCount} 筆譯文需要確認。`;
  const selection =
    reviewCount > 0 || blocked.length > 0
      ? await vscode.window.showWarningMessage(message, openReport)
      : await vscode.window.showInformationMessage(message, openReport);
  if (selection === openReport) {
    await vscode.window.showTextDocument(store.resolveUri(reportPath));
  }
}
