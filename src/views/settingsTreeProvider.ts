import * as vscode from "vscode";
import { SCROLL_SYNC_ENABLED_SETTING_KEY } from "../services/compareScrollSync";

const SCROLL_SYNC_ITEM_ID = "compareScrollSync.enabled";

class ScrollSyncSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("比對畫面同步捲動", vscode.TreeItemCollapsibleState.None);
    this.id = SCROLL_SYNC_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，是否同步捲動兩側編輯器。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
  }
}

export class SettingsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly configSubscription: vscode.Disposable;

  constructor() {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SCROLL_SYNC_ENABLED_SETTING_KEY)) {
        this.emitter.fire();
      }
    });
  }

  dispose(): void {
    this.configSubscription.dispose();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const enabled = vscode.workspace.getConfiguration().get<boolean>(SCROLL_SYNC_ENABLED_SETTING_KEY, true);
    return [new ScrollSyncSettingItem(enabled)];
  }

  // 使用者點擊樹狀視圖裡的核取方塊時觸發，依勾選狀態直接寫回設定值。
  handleCheckboxChange(item: vscode.TreeItem, state: vscode.TreeItemCheckboxState): void {
    if (item.id !== SCROLL_SYNC_ITEM_ID) {
      return;
    }
    void vscode.workspace
      .getConfiguration()
      .update(
        SCROLL_SYNC_ENABLED_SETTING_KEY,
        state === vscode.TreeItemCheckboxState.Checked,
        vscode.ConfigurationTarget.Global
      );
  }
}
