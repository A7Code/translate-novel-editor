import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { SidebarSectionStateStore } from "../core/sidebarStateStore";
import { ChapterConfig, WorkConfig } from "../core/types";
import { ChapterProgress, WorkProgress } from "../translation/progress";
import { ProgressService } from "../translation/progressService";

export class WorkTreeItem extends vscode.TreeItem {
  constructor(public readonly work: WorkConfig, expanded: boolean) {
    super(
      work.title,
      expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = work.id;
    this.contextValue = work.epubSource ? "novelTranslateWork-epub" : "novelTranslateWork";
    this.description = work.author;
    this.tooltip = work.author ? `${work.title} — ${work.author}` : work.title;
    this.iconPath = new vscode.ThemeIcon("book");
  }

  applyProgress(progress: WorkProgress | undefined): void {
    const parts: string[] = [];
    if (progress && progress.percent !== null) {
      const warning = progress.extraTranslationLines > 0 ? " ⚠" : "";
      parts.push(`${progress.percent}% · ${progress.translatedLines}/${progress.totalLines}${warning}`);
    }
    if (this.work.author) {
      parts.push(this.work.author);
    }
    this.description = parts.join(" · ");
  }
}

export class ChapterTreeItem extends vscode.TreeItem {
  constructor(public readonly workId: string, public readonly chapter: ChapterConfig) {
    super(chapter.title, vscode.TreeItemCollapsibleState.None);
    this.id = `${workId}/${chapter.id}`;
    this.contextValue = "novelTranslateChapter";
    this.iconPath = new vscode.ThemeIcon("note");
    this.command = {
      command: "novelTranslate.openCompareView",
      title: "開啟原文／譯文比對",
      arguments: [this]
    };
  }

  applyProgress(progress: ChapterProgress | undefined): void {
    if (!progress) {
      return;
    }
    const warning = progress.extraTranslationLines > 0 ? " ⚠" : "";
    this.description =
      progress.percent === null
        ? `—${warning}`
        : `${progress.percent}% · ${progress.translatedLines}/${progress.totalLines}${warning}`;
    this.tooltip = warning
      ? `${this.chapter.title}：有 ${progress.extraTranslationLines} 行譯文沒有對應原文`
      : this.chapter.title;
    this.iconPath = new vscode.ThemeIcon(progress.status === "done" ? "check" : "note");
  }
}

type NovelTreeItem = WorkTreeItem | ChapterTreeItem;

export class WorkTreeProvider implements vscode.TreeDataProvider<NovelTreeItem> {
  private readonly emitter = new vscode.EventEmitter<NovelTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  // 作品資料真的改變時才觸發。進度更新只重畫單一節點，不應讓作品管理頁面重畫章節列表。
  private readonly worksEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeWorks = this.worksEmitter.event;
  // VS Code 以物件實例辨識節點，局部更新時必須傳回 getChildren 給出的同一個實例。
  private readonly workItems = new Map<string, WorkTreeItem>();

  constructor(
    private readonly store: ProjectStore | undefined,
    private readonly stateStore: SidebarSectionStateStore,
    private readonly progress?: ProgressService
  ) {
    progress?.onDidChangeProgress((workId) => this.handleProgressChange(workId));
  }

  refresh(): void {
    this.store?.refresh();
    this.emitter.fire(undefined);
    this.worksEmitter.fire();
  }

  // 只更新受影響的作品節點；不能呼叫 refresh()，它會清掉專案快取。
  private handleProgressChange(workId: string): void {
    const item = this.workItems.get(workId);
    if (!item) {
      return;
    }
    item.applyProgress(this.progress?.getSnapshot(workId)?.summary);
    item.collapsibleState = this.stateStore.isExpanded(workId)
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    this.emitter.fire(item);
  }

  // 使用者展開／收合「作品」節點時呼叫，記住狀態供下次初始化時還原。
  setExpanded(workId: string, expanded: boolean): void {
    this.stateStore.setExpanded(workId, expanded);
  }

  // 使用者在樹狀視圖中變更選取時呼叫，記住最後選了哪個節點。
  setSelected(id: string | undefined): void {
    this.stateStore.setSelectedId(id);
  }

  getLastSelectedId(): string | undefined {
    return this.stateStore.getSelectedId();
  }

  getTreeItem(element: NovelTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NovelTreeItem): Promise<NovelTreeItem[]> {
    if (!this.store) {
      return [];
    }
    if (!element) {
      const config = await this.store.load();
      this.workItems.clear();
      return config.works.map((work) => {
        const item = this.createWorkItem(work);
        this.workItems.set(work.id, item);
        this.progress?.requestWork(work.id);
        return item;
      });
    }
    if (element instanceof WorkTreeItem) {
      const snapshot = this.progress?.getSnapshot(element.work.id);
      return element.work.chapters.map((chapter) => {
        const item = new ChapterTreeItem(element.work.id, chapter);
        item.applyProgress(snapshot?.chapters[chapter.id]);
        return item;
      });
    }
    return [];
  }

  // reveal() 還原選取狀態時，VS Code 會用這個方法往上找出完整的父節點鏈。
  async getParent(element: NovelTreeItem): Promise<NovelTreeItem | undefined> {
    if (element instanceof ChapterTreeItem) {
      const config = await this.store?.load();
      const work = config?.works.find((candidate) => candidate.id === element.workId);
      return work ? this.createWorkItem(work) : undefined;
    }
    return undefined;
  }

  // 依照初始化時還原選取用的 id，找回對應的節點實例（可能是作品或章節）。
  async findItemById(id: string): Promise<NovelTreeItem | undefined> {
    if (!this.store) {
      return undefined;
    }
    const config = await this.store.load();
    for (const work of config.works) {
      if (work.id === id) {
        return this.createWorkItem(work);
      }
      const chapter = work.chapters.find((candidate) => `${work.id}/${candidate.id}` === id);
      if (chapter) {
        return new ChapterTreeItem(work.id, chapter);
      }
    }
    return undefined;
  }

  private createWorkItem(work: WorkConfig): WorkTreeItem {
    const item = new WorkTreeItem(work, this.stateStore.isExpanded(work.id));
    item.applyProgress(this.progress?.getSnapshot(work.id)?.summary);
    return item;
  }
}
