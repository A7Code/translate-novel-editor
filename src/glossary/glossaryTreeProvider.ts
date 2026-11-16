import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { SidebarSectionStateStore } from "../core/sidebarStateStore";
import { GlossaryEntry, WorkConfig } from "../core/types";
import { categoryOf, UNCATEGORIZED_CATEGORY } from "./glossaryCategories";

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

// 詞語類型（分類）群組節點，把同一本作品底下的詞條依分類歸類顯示。
export class GlossaryCategoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly workId: string,
    public readonly category: string,
    public readonly entries: readonly GlossaryEntry[],
    expanded: boolean
  ) {
    super(
      category,
      expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `glossary/${workId}/category/${encodeURIComponent(category)}`;
    this.contextValue = "novelTranslateGlossaryCategory";
    this.description = `${entries.length} 筆`;
    this.iconPath = new vscode.ThemeIcon("tag");
  }
}

export class GlossaryEntryTreeItem extends vscode.TreeItem {
  constructor(public readonly workId: string, public readonly entry: GlossaryEntry) {
    super(`${entry.term} → ${entry.translation}`, vscode.TreeItemCollapsibleState.None);
    this.id = `glossary/${workId}/${entry.id}`;
    this.contextValue = "novelTranslateGlossaryEntry";
    // 分類已經由上層群組節點呈現，這裡的淡字改留給備註，方便瀏覽時快速看到註解。
    this.description = entry.note;
    this.tooltip = entry.note;
    this.iconPath = new vscode.ThemeIcon("symbol-text");
    this.command = {
      command: "novelTranslate.editGlossaryEntry",
      title: "編輯詞條",
      arguments: [this]
    };
  }
}

type GlossaryTreeItemUnion = GlossaryWorkTreeItem | GlossaryCategoryTreeItem | GlossaryEntryTreeItem;

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
      return this.createCategoryItems(element.work);
    }
    if (element instanceof GlossaryCategoryTreeItem) {
      return element.entries.map((entry) => new GlossaryEntryTreeItem(element.workId, entry));
    }
    return [];
  }

  // reveal() 還原選取狀態時，VS Code 會用這個方法往上找出完整的父節點鏈。
  async getParent(element: GlossaryTreeItemUnion): Promise<GlossaryTreeItemUnion | undefined> {
    if (element instanceof GlossaryEntryTreeItem) {
      const work = await this.findWork(element.workId);
      if (!work) {
        return undefined;
      }
      return this.createCategoryItems(work).find((item) => item.category === categoryOf(element.entry));
    }
    if (element instanceof GlossaryCategoryTreeItem) {
      const work = await this.findWork(element.workId);
      return work ? this.createWorkItem(work) : undefined;
    }
    return undefined;
  }

  // 依照初始化時還原選取用的 id，找回對應的節點實例（可能是作品、分類群組或詞條）。
  async findItemById(id: string): Promise<GlossaryTreeItemUnion | undefined> {
    if (!this.store) {
      return undefined;
    }
    const config = await this.store.load();
    for (const work of config.works) {
      if (`glossary/${work.id}` === id) {
        return this.createWorkItem(work);
      }
      const categoryItem = this.createCategoryItems(work).find((item) => item.id === id);
      if (categoryItem) {
        return categoryItem;
      }
      const entry = work.glossary.find((candidate) => `glossary/${work.id}/${candidate.id}` === id);
      if (entry) {
        return new GlossaryEntryTreeItem(work.id, entry);
      }
    }
    return undefined;
  }

  private async findWork(workId: string): Promise<WorkConfig | undefined> {
    const config = await this.store?.load();
    return config?.works.find((candidate) => candidate.id === workId);
  }

  private createWorkItem(work: WorkConfig): GlossaryWorkTreeItem {
    return new GlossaryWorkTreeItem(work, this.stateStore.isExpanded(`glossary/${work.id}`));
  }

  // 依分類把作品底下的詞條分組；未填分類的歸到「未分類」，依分類名稱排序（未分類排最後）。
  private createCategoryItems(work: WorkConfig): GlossaryCategoryTreeItem[] {
    const grouped = new Map<string, GlossaryEntry[]>();
    for (const entry of work.glossary) {
      const category = categoryOf(entry);
      const entries = grouped.get(category);
      if (entries) {
        entries.push(entry);
      } else {
        grouped.set(category, [entry]);
      }
    }

    const categories = Array.from(grouped.keys()).sort((a, b) => {
      if (a === UNCATEGORIZED_CATEGORY) {
        return 1;
      }
      if (b === UNCATEGORIZED_CATEGORY) {
        return -1;
      }
      return a.localeCompare(b, "zh-Hant");
    });

    return categories.map((category) => {
      const entries = grouped.get(category)!;
      const id = `glossary/${work.id}/category/${encodeURIComponent(category)}`;
      return new GlossaryCategoryTreeItem(work.id, category, entries, this.stateStore.isExpanded(id));
    });
  }
}
