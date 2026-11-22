import * as vscode from "vscode";
import { CommentThreadData } from "../core/types";
import { ProjectStore } from "../core/projectStore";
import { isCommentThreadList, mergeCommentThreads } from "./commentMerge";

export function commentFilePath(workId: string, chapterId: string): string {
  return `.novel-translate/comments/${workId}/${chapterId}.json`;
}

export class CommentStore {
  constructor(private readonly store: ProjectStore | undefined) {}

  async load(workId: string, chapterId: string): Promise<CommentThreadData[]> {
    if (!this.store) {
      return [];
    }
    const path = commentFilePath(workId, chapterId);
    const result = await this.store.files.readJson(path, isCommentThreadList);
    if (result.kind === "unreadable") {
      vscode.window.showErrorMessage(`註解檔無法讀取，已停止寫入這個檔案以保護資料：${path}`);
      return [];
    }
    return result.kind === "ok" ? result.value : [];
  }

  /** 更新開啟中的討論串並移除 deletedIds，其他討論串原樣保留。檔案損毀時會拋錯且不寫入。 */
  async update(
    workId: string,
    chapterId: string,
    live: CommentThreadData[],
    deletedIds: ReadonlySet<string>
  ): Promise<void> {
    if (!this.store) {
      return;
    }
    await this.store.files.updateJson<CommentThreadData[]>(
      commentFilePath(workId, chapterId),
      [],
      (stored) => mergeCommentThreads(stored, live, deletedIds),
      isCommentThreadList
    );
  }
}
