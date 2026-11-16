import * as vscode from "vscode";
import { SCROLL_SYNC_ENABLED_SETTING_KEY } from "../compareView/extensions/scrollSyncExtension";
import { CURSOR_SYNC_ENABLED_SETTING_KEY } from "../compareView/extensions/cursorSyncExtension";
import {
  COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY,
  GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY,
  GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY
} from "../core/constants";

const SCROLL_SYNC_ITEM_ID = "compareScrollSync.enabled";
const CURSOR_SYNC_ITEM_ID = "compareCursorSync.enabled";
const GLOSSARY_AUTOCOMPLETE_ITEM_ID = "glossaryAutocomplete.enabled";
const TRANSLATION_ON_LEFT_ITEM_ID = "compareView.translationOnLeft";
const GLOSSARY_PHONETIC_MATCH_ITEM_ID = "glossaryAutocomplete.matchMode.phonetic";

// 讓使用者點擊整個設定項目（不只是核取方塊本身）時也能切換開關。
export const TOGGLE_CHECKBOX_COMMAND_ID = "novelTranslate.settingsTree.toggleCheckbox";

// 群組節點的 id，同時也是記住展開狀態用的 key。
const COMPARE_VIEW_GROUP_ID = "group.compareView";
const GLOSSARY_GROUP_ID = "group.glossary";
const GROUP_IDS = new Set([COMPARE_VIEW_GROUP_ID, GLOSSARY_GROUP_ID]);

// 記住使用者展開／收合群組狀態用的 globalState key（跨視窗、重啟後仍保留）。
const GROUP_EXPANDED_STATE_MEMENTO_KEY = "novelTranslate.settingsGroupExpandedState";

type GroupExpandedState = Record<string, boolean>;

class SettingsGroupItem extends vscode.TreeItem {
  constructor(label: string, groupId: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
    this.id = groupId;
    this.contextValue = "settingsGroup";
  }
}

class ScrollSyncSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("同步捲動", vscode.TreeItemCollapsibleState.None);
    this.id = SCROLL_SYNC_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，是否同步捲動兩側編輯器。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = { command: TOGGLE_CHECKBOX_COMMAND_ID, title: "切換", arguments: [this] };
  }
}

class CursorSyncSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("同步游標行", vscode.TreeItemCollapsibleState.None);
    this.id = CURSOR_SYNC_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，是否把焦點編輯器的游標行同步到另一側編輯器（借用其原生的目前行樣式呈現對應位置）。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = { command: TOGGLE_CHECKBOX_COMMAND_ID, title: "切換", arguments: [this] };
  }
}

class GlossaryAutocompleteSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("自動完成模式", vscode.TreeItemCollapsibleState.None);
    this.id = GLOSSARY_AUTOCOMPLETE_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，是否自動切換為詞彙表自動完成語言模式。關閉後維持一般自動完成。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = { command: TOGGLE_CHECKBOX_COMMAND_ID, title: "切換", arguments: [this] };
  }
}

class GlossaryPhoneticMatchSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("同音建議", vscode.TreeItemCollapsibleState.None);
    this.id = GLOSSARY_PHONETIC_MATCH_ITEM_ID;
    this.tooltip =
      "開啟後，自動完成除了比對完全相同的文字，游標前一個字只要跟詞條首字同音（含聲調）也會推薦，方便修正注音輸入法選錯的同音錯字（例如打「路」也能推薦「露西亞」）。關閉則只比對完全相同的文字。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = { command: TOGGLE_CHECKBOX_COMMAND_ID, title: "切換", arguments: [this] };
  }
}

class TranslationOnLeftSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("翻譯顯示在左側", vscode.TreeItemCollapsibleState.None);
    this.id = TRANSLATION_ON_LEFT_ITEM_ID;
    this.tooltip = "開啟原文／譯文比對畫面時，翻譯稿是否顯示在左側。取消勾選則改為原文在左、翻譯在右。";
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = { command: TOGGLE_CHECKBOX_COMMAND_ID, title: "切換", arguments: [this] };
  }
}

export class SettingsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly configSubscription: vscode.Disposable;

  // globalState 是 VS Code 擴充功能用來跨視窗、重啟後仍保留少量狀態的機制（概念上等同網頁的 localStorage）。
  constructor(private readonly globalState: vscode.Memento) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(SCROLL_SYNC_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(CURSOR_SYNC_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY) ||
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

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      return [
        new SettingsGroupItem("比對畫面設定", COMPARE_VIEW_GROUP_ID, this.getGroupCollapsibleState(COMPARE_VIEW_GROUP_ID)),
        new SettingsGroupItem("詞彙表設定", GLOSSARY_GROUP_ID, this.getGroupCollapsibleState(GLOSSARY_GROUP_ID))
      ];
    }

    const config = vscode.workspace.getConfiguration();

    if (element.id === COMPARE_VIEW_GROUP_ID) {
      const translationOnLeft = config.get<boolean>(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY, true);
      const scrollSyncEnabled = config.get<boolean>(SCROLL_SYNC_ENABLED_SETTING_KEY, true);
      const cursorSyncEnabled = config.get<boolean>(CURSOR_SYNC_ENABLED_SETTING_KEY, true);
      return [
        new TranslationOnLeftSettingItem(translationOnLeft),
        new ScrollSyncSettingItem(scrollSyncEnabled),
        new CursorSyncSettingItem(cursorSyncEnabled)
      ];
    }

    if (element.id === GLOSSARY_GROUP_ID) {
      const glossaryAutocompleteEnabled = config.get<boolean>(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, true);
      const glossaryPhoneticMatchEnabled =
        config.get<string>(GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY, "exact") === "phonetic";
      return [
        new GlossaryAutocompleteSettingItem(glossaryAutocompleteEnabled),
        new GlossaryPhoneticMatchSettingItem(glossaryPhoneticMatchEnabled)
      ];
    }

    return [];
  }

  // 依照使用者上次留下的展開／收合紀錄決定群組初始狀態，預設為全展開。
  private getGroupCollapsibleState(groupId: string): vscode.TreeItemCollapsibleState {
    const expandedState = this.globalState.get<GroupExpandedState>(GROUP_EXPANDED_STATE_MEMENTO_KEY, {});
    const expanded = expandedState[groupId] ?? true;
    return expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  }

  // 使用者展開或收合群組時呼叫，把狀態寫回 globalState，下次開啟畫面時套用。
  setGroupExpanded(groupId: string, expanded: boolean): void {
    if (!GROUP_IDS.has(groupId)) {
      return;
    }
    const expandedState = this.globalState.get<GroupExpandedState>(GROUP_EXPANDED_STATE_MEMENTO_KEY, {});
    expandedState[groupId] = expanded;
    void this.globalState.update(GROUP_EXPANDED_STATE_MEMENTO_KEY, expandedState);
  }

  // 使用者點擊樹狀視圖裡的核取方塊時觸發，依勾選狀態直接寫回設定值。
  handleCheckboxChange(item: vscode.TreeItem, state: vscode.TreeItemCheckboxState): void {
    const checked = state === vscode.TreeItemCheckboxState.Checked;
    if (item.id === GLOSSARY_PHONETIC_MATCH_ITEM_ID) {
      void vscode.workspace
        .getConfiguration()
        .update(
          GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY,
          checked ? "phonetic" : "exact",
          vscode.ConfigurationTarget.Global
        );
      return;
    }

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
    void vscode.workspace.getConfiguration().update(settingKey, checked, vscode.ConfigurationTarget.Global);
  }

  // 使用者點擊設定項目本身（非核取方塊）時觸發，依目前勾選狀態反轉後套用同一套邏輯。
  toggleCheckbox(item: vscode.TreeItem): void {
    const next =
      item.checkboxState === vscode.TreeItemCheckboxState.Checked
        ? vscode.TreeItemCheckboxState.Unchecked
        : vscode.TreeItemCheckboxState.Checked;
    this.handleCheckboxChange(item, next);
  }
}
