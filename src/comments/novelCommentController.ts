import * as vscode from "vscode";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { ProjectStore } from "../core/projectStore";
import { CommentStore } from "./commentStore";
import { CommentThreadData } from "../core/types";
import { safeRun } from "../core/safeRun";

const CONTROLLER_ID = "novelTranslate.notes";
const CONTROLLER_LABEL = "小說翻譯筆記";

interface NovelComment extends vscode.Comment {
  id: string;
  createdAt: string;
}

interface ThreadMeta {
  id: string;
  workId: string;
  chapterId: string;
  relativePath: string;
}

function getAuthorName(): string {
  try {
    return os.userInfo().username || "我";
  } catch {
    return "我";
  }
}

export class NovelCommentController implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly commentStore: CommentStore;
  private readonly threadMeta = new Map<vscode.CommentThread, ThreadMeta>();
  private readonly chapterThreads = new Map<string, Set<vscode.CommentThread>>();
  private readonly materializedUris = new Set<string>();
  /** 已刪除但尚未成功寫回檔案的討論串 id；寫入失敗時保留，下次儲存再重試。 */
  private readonly pendingDeletes = new Map<string, Set<string>>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly store: ProjectStore | undefined) {
    this.commentStore = new CommentStore(store);
    this.controller = vscode.comments.createCommentController(CONTROLLER_ID, CONTROLLER_LABEL);
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => this.provideCommentingRanges(document)
    };

    this.subscriptions.push(
      this.controller,
      vscode.workspace.onDidOpenTextDocument((document) =>
        safeRun(this.materialize(document), "載入分頁註解")
      ),
      vscode.workspace.onDidCloseTextDocument((document) => this.dematerialize(document))
    );

    for (const document of vscode.workspace.textDocuments) {
      safeRun(this.materialize(document), "載入分頁註解");
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  async submitComment(reply: vscode.CommentReply): Promise<void> {
    if (!this.store) {
      return;
    }

    const thread = reply.thread;
    let meta = this.threadMeta.get(thread);
    if (!meta) {
      const found = await this.store.findChapterForDocumentUri(thread.uri);
      if (!found) {
        return;
      }
      meta = { id: randomUUID().slice(0, 8), workId: found.workId, chapterId: found.chapter.id, relativePath: found.relativePath };
      this.registerThread(thread, meta);
      thread.label = CONTROLLER_LABEL;
      thread.contextValue = "novelTranslateThread";
      thread.canReply = true;
      thread.state = vscode.CommentThreadState.Unresolved;
    }

    const newComment: NovelComment = {
      id: randomUUID().slice(0, 8),
      body: reply.text,
      mode: vscode.CommentMode.Preview,
      author: { name: getAuthorName() },
      createdAt: new Date().toISOString(),
      contextValue: "novelTranslateComment"
    };
    thread.comments = [...thread.comments, newComment];
    await this.persistChapter(meta.workId, meta.chapterId);
  }

  toggleResolved(thread: vscode.CommentThread): void {
    const meta = this.threadMeta.get(thread);
    if (!meta) {
      return;
    }
    thread.state =
      thread.state === vscode.CommentThreadState.Resolved
        ? vscode.CommentThreadState.Unresolved
        : vscode.CommentThreadState.Resolved;
    safeRun(this.persistChapter(meta.workId, meta.chapterId), "儲存註解");
  }

  deleteThread(thread: vscode.CommentThread): void {
    const meta = this.threadMeta.get(thread);
    this.threadMeta.delete(thread);
    if (meta) {
      const chapterKey = `${meta.workId}/${meta.chapterId}`;
      this.chapterThreads.get(chapterKey)?.delete(thread);
      let pending = this.pendingDeletes.get(chapterKey);
      if (!pending) {
        pending = new Set();
        this.pendingDeletes.set(chapterKey, pending);
      }
      pending.add(meta.id);
    }
    thread.dispose();
    if (meta) {
      safeRun(this.persistChapter(meta.workId, meta.chapterId), "儲存註解");
    }
  }

  private async provideCommentingRanges(document: vscode.TextDocument): Promise<vscode.Range[] | undefined> {
    if (!this.store) {
      return undefined;
    }
    const found = await this.store.findChapterForDocumentUri(document.uri);
    if (!found) {
      return undefined;
    }
    return [new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)];
  }

  private async materialize(document: vscode.TextDocument): Promise<void> {
    if (!this.store) {
      return;
    }
    const key = document.uri.toString();
    if (this.materializedUris.has(key)) {
      return;
    }
    const found = await this.store.findChapterForDocumentUri(document.uri);
    if (!found) {
      return;
    }
    this.materializedUris.add(key);

    const { workId, chapter, relativePath } = found;
    const stored = await this.commentStore.load(workId, chapter.id);

    for (const data of stored.filter((candidate) => candidate.relativePath === relativePath)) {
      const range = new vscode.Range(data.startLine, 0, data.endLine, 0);
      const comments: NovelComment[] = data.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        mode: vscode.CommentMode.Preview,
        author: { name: comment.author },
        createdAt: comment.createdAt,
        contextValue: "novelTranslateComment"
      }));

      const thread = this.controller.createCommentThread(document.uri, range, comments);
      thread.label = CONTROLLER_LABEL;
      thread.contextValue = "novelTranslateThread";
      thread.canReply = true;
      thread.state = data.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
      this.registerThread(thread, { id: data.id, workId, chapterId: chapter.id, relativePath });
    }
  }

  private dematerialize(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.materializedUris.delete(key);
    for (const [thread, meta] of this.threadMeta) {
      if (thread.uri.toString() !== key) {
        continue;
      }
      this.threadMeta.delete(thread);
      this.chapterThreads.get(`${meta.workId}/${meta.chapterId}`)?.delete(thread);
      thread.dispose();
    }
  }

  private registerThread(thread: vscode.CommentThread, meta: ThreadMeta): void {
    this.threadMeta.set(thread, meta);
    const key = `${meta.workId}/${meta.chapterId}`;
    let set = this.chapterThreads.get(key);
    if (!set) {
      set = new Set();
      this.chapterThreads.set(key, set);
    }
    set.add(thread);
  }

  private async persistChapter(workId: string, chapterId: string): Promise<void> {
    const threads = this.chapterThreads.get(`${workId}/${chapterId}`);
    const data: CommentThreadData[] = [];

    if (threads) {
      for (const thread of threads) {
        const meta = this.threadMeta.get(thread);
        if (!meta) {
          continue;
        }
        const range = thread.range ?? new vscode.Range(0, 0, 0, 0);
        data.push({
          id: meta.id,
          relativePath: meta.relativePath,
          startLine: range.start.line,
          endLine: range.end.line,
          resolved: thread.state === vscode.CommentThreadState.Resolved,
          comments: thread.comments.map((comment) => {
            const novelComment = comment as NovelComment;
            return {
              id: novelComment.id,
              author: typeof novelComment.author === "string" ? novelComment.author : novelComment.author.name,
              body: typeof novelComment.body === "string" ? novelComment.body : novelComment.body.value,
              createdAt: novelComment.createdAt
            };
          })
        });
      }
    }

    const chapterKey = `${workId}/${chapterId}`;
    const pending = this.pendingDeletes.get(chapterKey);
    const deletedIds = new Set(pending ?? []);
    try {
      await this.commentStore.update(workId, chapterId, data, deletedIds);
      for (const id of deletedIds) {
        pending?.delete(id);
      }
    } catch (error) {
      console.error("[novelTranslate] 儲存註解失敗：", error);
      vscode.window.showErrorMessage(`儲存註解失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 章節的註解檔被外部流程（例如 EPUB 升級）改寫後，重新載入目前開啟的文件。 */
  async reloadChapter(workId: string, chapterId: string): Promise<void> {
    const chapterKey = `${workId}/${chapterId}`;
    const uris = new Set<string>();
    for (const thread of this.chapterThreads.get(chapterKey) ?? []) {
      uris.add(thread.uri.toString());
      this.threadMeta.delete(thread);
      thread.dispose();
    }
    this.chapterThreads.delete(chapterKey);
    this.pendingDeletes.delete(chapterKey);

    for (const document of vscode.workspace.textDocuments) {
      const found = await this.store?.findChapterForDocumentUri(document.uri);
      if (found?.workId === workId && found.chapter.id === chapterId) {
        this.materializedUris.delete(document.uri.toString());
        await this.materialize(document);
      }
    }
  }
}
