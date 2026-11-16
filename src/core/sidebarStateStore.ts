import * as vscode from "vscode";

/**
 * 側邊欄各區塊（作品總管／詞彙表／設置）共用的「展開了哪些項目、最後選了哪個」記憶邏輯。
 * 每個區塊各自用一個獨立的 globalState key 儲存，跨視窗、重啟後仍保留。
 */
interface SidebarSectionState {
  expandedIds: string[];
  selectedId?: string;
}

export class SidebarSectionStateStore {
  constructor(private readonly globalState: vscode.Memento, private readonly key: string) {}

  private read(): SidebarSectionState {
    return this.globalState.get<SidebarSectionState>(this.key, { expandedIds: [] });
  }

  private write(state: SidebarSectionState): void {
    void this.globalState.update(this.key, state);
  }

  isExpanded(id: string): boolean {
    return this.read().expandedIds.includes(id);
  }

  setExpanded(id: string, expanded: boolean): void {
    const state = this.read();
    const expandedIds = new Set(state.expandedIds);
    if (expanded) {
      expandedIds.add(id);
    } else {
      expandedIds.delete(id);
    }
    this.write({ ...state, expandedIds: Array.from(expandedIds) });
  }

  getSelectedId(): string | undefined {
    return this.read().selectedId;
  }

  setSelectedId(id: string | undefined): void {
    const state = this.read();
    this.write({ ...state, selectedId: id });
  }
}
