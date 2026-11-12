import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";
import { GlossaryEntry, WorkConfig } from "../types";

export class GlossaryWorkTreeItem extends vscode.TreeItem {
  constructor(public readonly work: WorkConfig) {
    super(work.title, vscode.TreeItemCollapsibleState.Collapsed);
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

  constructor(private readonly store: ProjectStore | undefined) {}

  refresh(): void {
    this.store?.refresh();
    this.emitter.fire();
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
      return config.works.map((work) => new GlossaryWorkTreeItem(work));
    }
    if (element instanceof GlossaryWorkTreeItem) {
      return element.work.glossary.map((entry) => new GlossaryEntryTreeItem(element.work.id, entry));
    }
    return [];
  }
}
