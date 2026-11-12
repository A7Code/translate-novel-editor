import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { ChapterConfig, WorkConfig } from "../types";

export class WorkTreeItem extends vscode.TreeItem {
  constructor(public readonly work: WorkConfig) {
    super(work.title, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = work.id;
    this.contextValue = "novelTranslateWork";
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

  constructor(private readonly store: ProjectStore | undefined) {}

  refresh(): void {
    this.store?.refresh();
    this.emitter.fire();
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
      return config.works.map((work) => new WorkTreeItem(work));
    }
    if (element instanceof WorkTreeItem) {
      return element.work.chapters.map((chapter) => new ChapterTreeItem(element.work.id, chapter));
    }
    return [];
  }
}
