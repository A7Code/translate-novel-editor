import * as vscode from "vscode";
import { openCompareView, revealCompareLine } from "../compareView/compareCommands";
import { CompareView } from "../compareView/compareView";
import { ProjectStore } from "../core/projectStore";
import { NovelCommentController } from "./novelCommentController";

export function submitComment(controller: NovelCommentController, reply: vscode.CommentReply): Promise<void> {
  return controller.submitComment(reply);
}

export function toggleCommentResolved(controller: NovelCommentController, thread: vscode.CommentThread): void {
  controller.toggleResolved(thread);
}

export function deleteCommentThread(controller: NovelCommentController, thread: vscode.CommentThread): void {
  controller.deleteThread(thread);
}

/** 列出全作品「待確認」的翻譯筆記，選擇後跳到比對畫面的該行（1.9）。 */
export async function showCommentOverview(
  store: ProjectStore | undefined,
  controller: NovelCommentController,
  compareView: CompareView
): Promise<void> {
  if (!store) {
    vscode.window.showErrorMessage("請先開啟一個工作區資料夾。");
    return;
  }

  const entries = await controller.listUnresolvedComments();
  if (entries.length === 0) {
    vscode.window.showInformationMessage("目前沒有待確認的翻譯筆記。");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: `${entry.workTitle} · ${entry.chapterTitle}`,
      description: `${entry.side === "original" ? "原文" : "譯文"} 第 ${entry.line + 1} 行 · ${entry.commentCount} 則留言`,
      detail: entry.preview || "（沒有留言內容）",
      entry
    })),
    {
      placeHolder: `共 ${entries.length} 則待確認的翻譯筆記，選擇即可跳到該行`,
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  if (!picked) {
    return;
  }

  const config = await store.load();
  const chapter = config.works
    .find((work) => work.id === picked.entry.workId)
    ?.chapters.find((candidate) => candidate.id === picked.entry.chapterId);
  if (!chapter) {
    vscode.window.showErrorMessage("找不到這個章節，可能已被刪除或重新命名。");
    return;
  }
  await openCompareView(store, compareView, chapter);
  revealCompareLine(compareView, picked.entry.line);
}
