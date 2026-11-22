import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { safeRun } from "../core/safeRun";
import { ChapterConfig } from "../core/types";
import { ChapterProgress, computeChapterProgress, summarizeWorkProgress, WorkProgress } from "./progress";

const DEBOUNCE_MS = 300;
const READ_CONCURRENCY = 8;
const CHAPTER_ROOTS = ["originals", "translations"];

export interface WorkProgressSnapshot {
  chapters: Record<string, ChapterProgress>;
  summary: WorkProgress;
  /** 讀取失敗的章節。這些章節不計入總進度，畫面需要明確提示。 */
  unreadableChapterIds: string[];
}

interface TextSource {
  /** 磁碟檔案的版本戳記；開啟中的文件為 undefined，每次都重新計算。 */
  stamp: string | undefined;
  read: () => Promise<string>;
}

interface CachedChapter {
  stamp: string;
  progress: ChapterProgress;
}

/**
 * 計算並快取各作品的翻譯進度。進度可由檔案算出，所以不寫入 project.json。
 * 開啟中的文件優先使用編輯器內容，未存檔的輸入也會反映在進度上。
 */
export class ProgressService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<string>();
  /** 某作品的進度實際改變時觸發，參數為作品 id。 */
  readonly onDidChangeProgress = this.emitter.event;

  private readonly snapshots = new Map<string, WorkProgressSnapshot>();
  private readonly chapterCache = new Map<string, Map<string, CachedChapter>>();
  private readonly running = new Map<string, Promise<WorkProgressSnapshot | undefined>>();
  private readonly rerun = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly rootPrefixes: string[];
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: ProjectStore,
    workspaceFolder: vscode.WorkspaceFolder
  ) {
    this.rootPrefixes = CHAPTER_ROOTS.map((root) => `${store.resolveUri(root).toString()}/`);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, "{originals,translations}/**/*.txt")
    );
    const onFileEvent = (uri: vscode.Uri) => this.scheduleForUri(uri);
    this.subscriptions.push(
      watcher,
      watcher.onDidChange(onFileEvent),
      watcher.onDidCreate(onFileEvent),
      watcher.onDidDelete(onFileEvent),
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleForUri(event.document.uri)),
      // 文件關閉後改回讀磁碟內容，未存檔的輸入不應繼續算進進度。
      vscode.workspace.onDidCloseTextDocument((document) => this.scheduleForUri(document.uri))
    );
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.emitter.dispose();
  }

  getSnapshot(workId: string): WorkProgressSnapshot | undefined {
    return this.snapshots.get(workId);
  }

  /** 在背景更新作品進度，有變化時透過 onDidChangeProgress 通知。 */
  requestWork(workId: string): void {
    safeRun(this.ensureWork(workId), "計算翻譯進度");
  }

  /** 計算作品進度。同一作品同時只跑一次，期間的新請求會在結束後補跑。 */
  ensureWork(workId: string): Promise<WorkProgressSnapshot | undefined> {
    const current = this.running.get(workId);
    if (current) {
      this.rerun.add(workId);
      return current;
    }
    const task = this.computeWork(workId).finally(() => {
      this.running.delete(workId);
      if (this.rerun.delete(workId)) {
        this.requestWork(workId);
      }
    });
    this.running.set(workId, task);
    return task;
  }

  private scheduleForUri(uri: vscode.Uri): void {
    const workId = this.workIdFromUri(uri);
    if (!workId) {
      return;
    }
    this.pending.add(workId);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const workIds = Array.from(this.pending);
      this.pending.clear();
      workIds.forEach((id) => this.requestWork(id));
    }, DEBOUNCE_MS);
  }

  // 這個判斷在每次按鍵時都會執行，所以只比對路徑前綴，不查詢專案資料。
  private workIdFromUri(uri: vscode.Uri): string | undefined {
    const target = uri.toString();
    const prefix = this.rootPrefixes.find((candidate) => target.startsWith(candidate));
    if (!prefix) {
      return undefined;
    }
    const segment = target.slice(prefix.length).split("/")[0];
    return segment ? decodeURIComponent(segment) : undefined;
  }

  private async computeWork(workId: string): Promise<WorkProgressSnapshot | undefined> {
    const config = await this.store.load();
    const work = config.works.find((candidate) => candidate.id === workId);
    if (!work) {
      this.snapshots.delete(workId);
      this.chapterCache.delete(workId);
      return undefined;
    }

    const previousCache = this.chapterCache.get(workId);
    const nextCache = new Map<string, CachedChapter>();
    const results = new Map<string, ChapterProgress>();
    const unreadable = new Set<string>();

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < work.chapters.length) {
        const chapter = work.chapters[nextIndex++];
        try {
          const { progress, cached } = await this.computeChapter(chapter, previousCache?.get(chapter.id));
          results.set(chapter.id, progress);
          if (cached) {
            nextCache.set(chapter.id, cached);
          }
        } catch (error) {
          unreadable.add(chapter.id);
          console.error(`[novelTranslate] 讀取章節 ${chapter.id} 計算進度失敗：`, error);
        }
      }
    };
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));

    const chapters: Record<string, ChapterProgress> = {};
    for (const chapter of work.chapters) {
      const progress = results.get(chapter.id);
      if (progress) {
        chapters[chapter.id] = progress;
      }
    }
    const snapshot: WorkProgressSnapshot = {
      chapters,
      summary: summarizeWorkProgress(Object.values(chapters)),
      unreadableChapterIds: work.chapters.filter((chapter) => unreadable.has(chapter.id)).map((chapter) => chapter.id)
    };

    this.chapterCache.set(workId, nextCache);
    const changed = JSON.stringify(this.snapshots.get(workId)) !== JSON.stringify(snapshot);
    this.snapshots.set(workId, snapshot);
    if (changed) {
      this.emitter.fire(workId);
    }
    return snapshot;
  }

  private async computeChapter(
    chapter: ChapterConfig,
    previous: CachedChapter | undefined
  ): Promise<{ progress: ChapterProgress; cached?: CachedChapter }> {
    const [original, translation] = await Promise.all([
      this.getSource(chapter.originalPath),
      this.getSource(chapter.translationPath)
    ]);

    const stamp =
      original.stamp !== undefined && translation.stamp !== undefined
        ? `${original.stamp}|${translation.stamp}`
        : undefined;
    if (stamp !== undefined && previous?.stamp === stamp) {
      return { progress: previous.progress, cached: previous };
    }

    const [originalText, translationText] = await Promise.all([original.read(), translation.read()]);
    const progress = computeChapterProgress(originalText, translationText);
    return { progress, cached: stamp === undefined ? undefined : { stamp, progress } };
  }

  private async getSource(relativePath: string): Promise<TextSource> {
    const uri = this.store.resolveUri(relativePath);
    const target = uri.toString();
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === target);
    if (document) {
      return { stamp: undefined, read: async () => document.getText() };
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return {
        stamp: `${stat.mtime}:${stat.size}`,
        read: async () => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8")
      };
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return { stamp: "missing", read: async () => "" };
      }
      throw error;
    }
  }
}
