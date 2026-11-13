import * as vscode from "vscode";
import { SCROLL_SYNC_ENABLED_SETTING_KEY } from "../services/compareScrollSync";
import { CURSOR_SYNC_ENABLED_SETTING_KEY } from "../services/compareCursorSync";
import { COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY, GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY } from "../constants";

const SCROLL_SYNC_ITEM_ID = "compareScrollSync.enabled";
const CURSOR_SYNC_ITEM_ID = "compareCursorSync.enabled";
const GLOSSARY_AUTOCOMPLETE_ITEM_ID = "glossaryAutocomplete.enabled";
const TRANSLATION_ON_LEFT_ITEM_ID = "compareView.translationOnLeft";

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

class CursorSyncSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("比對畫面同步游標行", vscode.TreeItemCollapsibleState.None);
    this.id = CURSOR_SYNC_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，是否把焦點編輯器的游標行同步到另一側編輯器（借用其原生的目前行樣式呈現對應位置）。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
  }
}

class GlossaryAutocompleteSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("詞彙表自動完成模式", vscode.TreeItemCollapsibleState.None);
    this.id = GLOSSARY_AUTOCOMPLETE_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，是否自動切換為詞彙表自動完成語言模式。關閉後維持一般自動完成。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
  }
}

class TranslationOnLeftSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("比對畫面：翻譯顯示在左側", vscode.TreeItemCollapsibleState.None);
    this.id = TRANSLATION_ON_LEFT_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，翻譯稿是否顯示在左側。取消勾選則改為原文在左、翻譯在右。";
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
      if (
        event.affectsConfiguration(SCROLL_SYNC_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(CURSOR_SYNC_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY)
      ) {
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
    const config = vscode.workspace.getConfiguration();
    const scrollSyncEnabled = config.get<boolean>(SCROLL_SYNC_ENABLED_SETTING_KEY, true);
    const cursorSyncEnabled = config.get<boolean>(CURSOR_SYNC_ENABLED_SETTING_KEY, true);
    const glossaryAutocompleteEnabled = config.get<boolean>(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, true);
    const translationOnLeft = config.get<boolean>(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY, true);
    return [
      new ScrollSyncSettingItem(scrollSyncEnabled),
      new CursorSyncSettingItem(cursorSyncEnabled),
      new GlossaryAutocompleteSettingItem(glossaryAutocompleteEnabled),
      new TranslationOnLeftSettingItem(translationOnLeft)
    ];
  }

  // 使用者點擊樹狀視圖裡的核取方塊時觸發，依勾選狀態直接寫回設定值。
  handleCheckboxChange(item: vscode.TreeItem, state: vscode.TreeItemCheckboxState): void {
    const settingKey =
      item.id === SCROLL_SYNC_ITEM_ID
        ? SCROLL_SYNC_ENABLED_SETTING_KEY
        : item.id === CURSOR_SYNC_ITEM_ID
          ? CURSOR_SYNC_ENABLED_SETTING_KEY
          : item.id === GLOSSARY_AUTOCOMPLETE_ITEM_ID
            ? GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY
            : item.id === TRANSLATION_ON_LEFT_ITEM_ID
              ? COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY
              : undefined;
    if (!settingKey) {
      return;
    }
    void vscode.workspace
      .getConfiguration()
      .update(settingKey, state === vscode.TreeItemCheckboxState.Checked, vscode.ConfigurationTarget.Global);
  }
}
