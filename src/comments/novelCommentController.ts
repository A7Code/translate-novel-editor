import * as vscode from "vscode";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { ProjectStore } from "../core/projectStore";
import { CommentStore } from "./commentStore";
import { CommentThreadData } from "../core/types";
import { safeRun } from "../core/safeRun";
import { describeTextChange, shiftLineRange } from "./commentRangeTracking";

const CONTROLLER_ID = "novelTranslate.notes";
const CONTROLLER_LABEL = "小說翻譯筆記";
const RANGE_PERSIST_DEBOUNCE_MS = 300;

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

export interface UnresolvedCommentEntry {
  workId: string;
  workTitle: string;
  chapterId: string;
  chapterTitle: string;
  side: "original" | "translation";
  /** 0-indexed。 */
  line: number;
  commentCount: number;
  /** 最新一則留言內容，供列表預覽，已去除多餘空白。 */
  preview: string;
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
  /** 討論串範圍因文字變更而移動後，debounce 寫回檔案用的計時器（key 為 `${workId}/${chapterId}`）。 */
  private readonly rangePersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
      vscode.workspace.onDidCloseTextDocument((document) => this.dematerialize(document)),
      // 討論串依行號定位，增刪上方的行會讓它指到錯誤段落（B7），這裡依文字變更調整範圍。
      vscode.workspace.onDidChangeTextDocument((event) => this.handleDocumentChange(event))
    );

    for (const document of vscode.workspace.textDocuments) {
      safeRun(this.materialize(document), "載入分頁註解");
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const timer of this.rangePersistTimers.values()) {
      clearTimeout(timer);
    }
  }

  // 文字變更後，把目前這份文件上每個討論串的範圍依變更內容重新計算；只有真的移動的討論串
  // 才需要 debounce 寫回檔案，單純在範圍以外打字（絕大多數情況）不會觸發任何寫入。
  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) {
      return;
    }
    const key = event.document.uri.toString();
    const maxLine = Math.max(event.document.lineCount - 1, 0);
    const affectedChapterKeys = new Set<string>();

    for (const [thread, meta] of this.threadMeta) {
      if (thread.uri.toString() !== key || !thread.range) {
        continue;
      }
      let range = { startLine: thread.range.start.line, endLine: thread.range.end.line };
      for (const change of event.contentChanges) {
        range = shiftLineRange(range, describeTextChange(change.range.start.line, change.range.end.line, change.text));
      }
      const startLine = Math.min(range.startLine, maxLine);
      const endLine = Math.min(range.endLine, maxLine);
      if (startLine !== thread.range.start.line || endLine !== thread.range.end.line) {
        thread.range = new vscode.Range(startLine, 0, endLine, 0);
        affectedChapterKeys.add(`${meta.workId}/${meta.chapterId}`);
      }
    }

    for (const chapterKey of affectedChapterKeys) {
      this.scheduleRangePersist(chapterKey);
    }
  }

  private scheduleRangePersist(chapterKey: string): void {
    const existing = this.rangePersistTimers.get(chapterKey);
    if (existing) {
      clearTimeout(existing);
    }
    const [workId, chapterId] = chapterKey.split("/");
    const timer = setTimeout(() => {
      this.rangePersistTimers.delete(chapterKey);
      safeRun(this.persistChapter(workId, chapterId), "儲存討論串位置");
    }, RANGE_PERSIST_DEBOUNCE_MS);
    this.rangePersistTimers.set(chapterKey, timer);
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

  /** 列出所有作品、所有章節裡「待確認」的討論串，供 1.9 的註解總覽使用。 */
  async listUnresolvedComments(): Promise<UnresolvedCommentEntry[]> {
    if (!this.store) {
      return [];
    }
    const config = await this.store.load();
    const entries: UnresolvedCommentEntry[] = [];
    for (const work of config.works) {
      for (const chapter of work.chapters) {
        const threads = await this.commentStore.load(work.id, chapter.id);
        for (const thread of threads) {
          if (thread.resolved) {
            continue;
          }
          const lastComment = thread.comments[thread.comments.length - 1];
          entries.push({
            workId: work.id,
            workTitle: work.title,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            side: thread.relativePath === chapter.originalPath ? "original" : "translation",
            line: thread.startLine,
            commentCount: thread.comments.length,
            preview: (lastComment?.body ?? "").replace(/\s+/g, " ").trim()
          });
        }
      }
    }
    return entries;
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
