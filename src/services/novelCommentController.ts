import * as vscode from "vscode";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { ProjectStore } from "./projectStore";
import { CommentStore } from "./commentStore";
import { CommentThreadData } from "../types";

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
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly store: ProjectStore | undefined) {
    this.commentStore = new CommentStore(store);
    this.controller = vscode.comments.createCommentController(CONTROLLER_ID, CONTROLLER_LABEL);
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => this.provideCommentingRanges(document)
    };

    this.subscriptions.push(
      this.controller,
      vscode.workspace.onDidOpenTextDocument((document) => void this.materialize(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.dematerialize(document))
    );

    for (const document of vscode.workspace.textDocuments) {
      void this.materialize(document);
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
    void this.persistChapter(meta.workId, meta.chapterId);
  }

  deleteThread(thread: vscode.CommentThread): void {
    const meta = this.threadMeta.get(thread);
    this.threadMeta.delete(thread);
    if (meta) {
      this.chapterThreads.get(`${meta.workId}/${meta.chapterId}`)?.delete(thread);
    }
    thread.dispose();
    if (meta) {
      void this.persistChapter(meta.workId, meta.chapterId);
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

    await this.commentStore.save(workId, chapterId, data);
  }
}
