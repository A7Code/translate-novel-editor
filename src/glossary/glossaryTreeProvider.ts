import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { SidebarSectionStateStore } from "../core/sidebarStateStore";
import { GlossaryEntry, WorkConfig } from "../core/types";

export class GlossaryWorkTreeItem extends vscode.TreeItem {
  constructor(public readonly work: WorkConfig, expanded: boolean) {
    super(
      work.title,
      expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `glossary/${work.id}`;
    this.contextValue = "novelTranslateGlossaryWork";
    this.description = `${work.glossary.length} 筆`;
    this.iconPath = new vscode.ThemeIcon("book");
  }
}

export class GlossaryEntryTreeItem extends vscode.TreeItem {
  constructor(public readonly workId: string, public readonly entry: GlossaryEntry) {
    super(`${entry.term} → ${entry.translation}`, vscode.TreeItemCollapsibleState.None);
    this.id = `glossary/${workId}/${entry.id}`;
    this.contextValue = "novelTranslateGlossaryEntry";
    this.description = entry.category;
    this.tooltip = entry.note;
    this.iconPath = new vscode.ThemeIcon("symbol-text");
    this.command = {
      command: "novelTranslate.editGlossaryEntry",
      title: "編輯詞條",
      arguments: [this]
    };
  }
}

type GlossaryTreeItemUnion = GlossaryWorkTreeItem | GlossaryEntryTreeItem;

export class GlossaryTreeProvider implements vscode.TreeDataProvider<GlossaryTreeItemUnion> {
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
  setExpanded(id: string, expanded: boolean): void {
    this.stateStore.setExpanded(id, expanded);
  }

  // 使用者在樹狀視圖中變更選取時呼叫，記住最後選了哪個節點。
  setSelected(id: string | undefined): void {
    this.stateStore.setSelectedId(id);
  }

  getLastSelectedId(): string | undefined {
    return this.stateStore.getSelectedId();
  }

  getTreeItem(element: GlossaryTreeItemUnion): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: GlossaryTreeItemUnion): Promise<GlossaryTreeItemUnion[]> {
    if (!this.store) {
      return [];
    }
    if (!element) {
      const config = await this.store.load();
      return config.works.map((work) => this.createWorkItem(work));
    }
    if (element instanceof GlossaryWorkTreeItem) {
      return element.work.glossary.map((entry) => new GlossaryEntryTreeItem(element.work.id, entry));
    }
    return [];
  }

  // reveal() 還原選取狀態時，VS Code 會用這個方法往上找出完整的父節點鏈。
  async getParent(element: GlossaryTreeItemUnion): Promise<GlossaryTreeItemUnion | undefined> {
    if (element instanceof GlossaryEntryTreeItem) {
      const config = await this.store?.load();
      const work = config?.works.find((candidate) => candidate.id === element.workId);
      return work ? this.createWorkItem(work) : undefined;
    }
    return undefined;
  }

  // 依照初始化時還原選取用的 id，找回對應的節點實例（可能是作品或詞條）。
  async findItemById(id: string): Promise<GlossaryTreeItemUnion | undefined> {
    if (!this.store) {
      return undefined;
    }
    const config = await this.store.load();
    for (const work of config.works) {
      if (`glossary/${work.id}` === id) {
        return this.createWorkItem(work);
      }
      const entry = work.glossary.find((candidate) => `glossary/${work.id}/${candidate.id}` === id);
      if (entry) {
        return new GlossaryEntryTreeItem(work.id, entry);
      }
    }
    return undefined;
  }

  private createWorkItem(work: WorkConfig): GlossaryWorkTreeItem {
    return new GlossaryWorkTreeItem(work, this.stateStore.isExpanded(`glossary/${work.id}`));
  }
}
