import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { SidebarSectionStateStore } from "../core/sidebarStateStore";
import { ChapterConfig, WorkConfig } from "../core/types";

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
}

type NovelTreeItem = WorkTreeItem | ChapterTreeItem;

export class WorkTreeProvider implements vscode.TreeDataProvider<NovelTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly store: ProjectStore | undefined,
    private readonly stateStore: SidebarSectionStateStore
  ) {}

  refresh(): void {
    this.store?.refresh();
    this.emitter.fire();
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
      return config.works.map((work) => this.createWorkItem(work));
    }
    if (element instanceof WorkTreeItem) {
      return element.work.chapters.map((chapter) => new ChapterTreeItem(element.work.id, chapter));
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
    return new WorkTreeItem(work, this.stateStore.isExpanded(work.id));
  }
}
