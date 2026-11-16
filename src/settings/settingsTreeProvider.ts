import * as vscode from "vscode";
import { SCROLL_SYNC_ENABLED_SETTING_KEY } from "../compareView/extensions/scrollSyncExtension";
import { CURSOR_SYNC_ENABLED_SETTING_KEY } from "../compareView/extensions/cursorSyncExtension";
import { SidebarSectionStateStore } from "../core/sidebarStateStore";
import { ProjectStore } from "../core/projectStore";
import { WorkConfig } from "../core/types";
import {
  getCategoryCountsByUsage,
  isCategoryEnabled,
  isWorkGlossaryAutocompleteEnabled
} from "../glossary/glossaryCategories";
import {
  COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY,
  GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY,
  GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY,
  PUNCTUATION_SUGGEST_ENABLED_SETTING_KEY
} from "../core/constants";

const SCROLL_SYNC_ITEM_ID = "compareScrollSync.enabled";
const CURSOR_SYNC_ITEM_ID = "compareCursorSync.enabled";
const GLOSSARY_AUTOCOMPLETE_ITEM_ID = "glossaryAutocomplete.enabled";
const TRANSLATION_ON_LEFT_ITEM_ID = "compareView.translationOnLeft";
const GLOSSARY_PHONETIC_MATCH_ITEM_ID = "glossaryAutocomplete.matchMode.phonetic";
const PUNCTUATION_SUGGEST_ITEM_ID = "punctuationSuggest.enabled";

// 讓使用者點擊整個設定項目（不只是核取方塊本身）時也能切換開關。
export const TOGGLE_CHECKBOX_COMMAND_ID = "novelTranslate.settingsTree.toggleCheckbox";

// 群組節點的 id，同時也是記住展開狀態用的 key。
const COMPARE_VIEW_GROUP_ID = "group.compareView";
const GLOSSARY_GROUP_ID = "group.glossary";
// 「是否使用詞語」分類開關群組：依作品列出各自的詞彙分類，開關狀態存在該作品的
// project.json 裡（ProjectStore.setGlossaryCategoryEnabled），所以每個作品可以各自獨立設定，
// 且會隨 project.json 持久化、下次開啟工作區時自動套用。
const GLOSSARY_CATEGORY_GROUP_ID = "group.glossaryCategories";
const GLOSSARY_CATEGORY_WORK_PREFIX = "glossaryCategoryGroup/";
const PUNCTUATION_SUGGEST_GROUP_ID = "group.punctuationSuggest";

// 各群組底下有哪些設定項目 id，用於 getParent() 往上找父節點。
const GROUP_ITEM_IDS: Record<string, string[]> = {
  [COMPARE_VIEW_GROUP_ID]: [TRANSLATION_ON_LEFT_ITEM_ID, SCROLL_SYNC_ITEM_ID, CURSOR_SYNC_ITEM_ID],
  [GLOSSARY_GROUP_ID]: [GLOSSARY_AUTOCOMPLETE_ITEM_ID, GLOSSARY_PHONETIC_MATCH_ITEM_ID],
  [PUNCTUATION_SUGGEST_GROUP_ID]: [PUNCTUATION_SUGGEST_ITEM_ID]
};
const GROUP_LABELS: Record<string, string> = {
  [COMPARE_VIEW_GROUP_ID]: "比對畫面設定",
  [GLOSSARY_GROUP_ID]: "詞彙表設定",
  [GLOSSARY_CATEGORY_GROUP_ID]: "是否使用詞語（分類）",
  [PUNCTUATION_SUGGEST_GROUP_ID]: "標點符號推薦設定"
};

function glossaryCategoryWorkGroupId(workId: string): string {
  return `${GLOSSARY_CATEGORY_WORK_PREFIX}${workId}`;
}

function glossaryCategoryToggleId(workId: string, category: string): string {
  return `${glossaryCategoryWorkGroupId(workId)}/category/${encodeURIComponent(category)}`;
}

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

class PunctuationSuggestSettingItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super("標點符號推薦", vscode.TreeItemCollapsibleState.None);
    this.id = PUNCTUATION_SUGGEST_ITEM_ID;
    this.tooltip =
      "在比對畫面的「譯文」編輯器某一行輸入觸發文字時（或使用快捷鍵），是否推薦原文同一行出現過的標點符號。觸發文字可以在 VS Code 設定裡的 novelTranslate.punctuationSuggest.triggerText 修改。";
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

// 「是否使用詞語」群組底下，每個有詞彙的作品各自一個子群組，展開後才是該作品的分類開關。
// 節點本身也是個核取方塊：這是「作品（大類型）」總開關，關閉後不論底下分類開關如何都
// 不查詢，跟下一層的分類（小類型）開關分屬不同層級、互不取代，由 GlossaryCompletionProvider
// 先判斷這個再判斷分類。
class GlossaryCategoryWorkGroupItem extends vscode.TreeItem {
  readonly workId: string;

  constructor(work: WorkConfig, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(work.title, collapsibleState);
    this.workId = work.id;
    this.id = glossaryCategoryWorkGroupId(work.id);
    this.contextValue = "settingsGlossaryCategoryWork";
    this.description = `${work.glossary.length} 筆`;
    this.tooltip = `作品總開關：關閉後，不論底下分類開關如何，自動完成都不會查詢「${work.title}」的詞彙表。`;
    this.iconPath = new vscode.ThemeIcon("book");
    this.checkboxState = isWorkGlossaryAutocompleteEnabled(work)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = { command: TOGGLE_CHECKBOX_COMMAND_ID, title: "切換", arguments: [this] };
  }
}

// 單一分類的開關項目；關閉後 GlossaryCompletionProvider 自動完成時會跳過這個分類底下的詞條。
class GlossaryCategoryToggleItem extends vscode.TreeItem {
  readonly workId: string;
  readonly category: string;

  constructor(work: WorkConfig, category: string, count: number) {
    super(category, vscode.TreeItemCollapsibleState.None);
    this.workId = work.id;
    this.category = category;
    this.id = glossaryCategoryToggleId(work.id, category);
    this.description = `${count} 筆`;
    this.tooltip = `關閉後，自動完成時不會查詢「${work.title}」裡「${category}」分類底下的詞條。`;
    this.checkboxState = isCategoryEnabled(work, category)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = { command: TOGGLE_CHECKBOX_COMMAND_ID, title: "切換", arguments: [this] };
  }
}

export class SettingsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly configSubscription: vscode.Disposable;
  private readonly glossaryChangeSubscription: vscode.Disposable;

  constructor(
    private readonly stateStore: SidebarSectionStateStore,
    private readonly projectStore: ProjectStore | undefined,
    glossaryChangeEvent: vscode.Event<void>
  ) {
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(SCROLL_SYNC_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(CURSOR_SYNC_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY) ||
        event.affectsConfiguration(GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY) ||
        event.affectsConfiguration(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY) ||
        event.affectsConfiguration(PUNCTUATION_SUGGEST_ENABLED_SETTING_KEY)
      ) {
        this.emitter.fire();
      }
    });
    // 詞彙表資料變動（新增/編輯/刪除詞條）時，分類清單與各分類筆數也要跟著重新整理。
    this.glossaryChangeSubscription = glossaryChangeEvent(() => this.emitter.fire());
  }

  dispose(): void {
    this.configSubscription.dispose();
    this.glossaryChangeSubscription.dispose();
  }

  // 使用者在樹狀視圖中變更選取時呼叫，記住最後選了哪個節點。
  setSelected(id: string | undefined): void {
    this.stateStore.setSelectedId(id);
  }

  getLastSelectedId(): string | undefined {
    return this.stateStore.getSelectedId();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return [
        this.createGroupItem(COMPARE_VIEW_GROUP_ID),
        this.createGroupItem(GLOSSARY_GROUP_ID),
        this.createGroupItem(GLOSSARY_CATEGORY_GROUP_ID),
        this.createGroupItem(PUNCTUATION_SUGGEST_GROUP_ID)
      ];
    }
    if (element.id === GLOSSARY_CATEGORY_GROUP_ID) {
      return this.createGlossaryCategoryWorkGroups();
    }
    if (element instanceof GlossaryCategoryWorkGroupItem) {
      return this.createGlossaryCategoryToggleItems(element.workId);
    }
    if (element.id && element.id in GROUP_ITEM_IDS) {
      return GROUP_ITEM_IDS[element.id]
        .map((itemId) => this.createSettingItem(itemId))
        .filter((item): item is vscode.TreeItem => item !== undefined);
    }
    return [];
  }

  // reveal() 還原選取狀態時，VS Code 會用這個方法往上找出完整的父節點鏈。
  async getParent(element: vscode.TreeItem): Promise<vscode.TreeItem | undefined> {
    if (!element.id) {
      return undefined;
    }
    if (element instanceof GlossaryCategoryToggleItem) {
      return this.findGlossaryCategoryWorkGroupItem(element.workId);
    }
    if (element instanceof GlossaryCategoryWorkGroupItem) {
      return this.createGroupItem(GLOSSARY_CATEGORY_GROUP_ID);
    }
    for (const groupId of Object.keys(GROUP_ITEM_IDS)) {
      if (GROUP_ITEM_IDS[groupId].includes(element.id)) {
        return this.createGroupItem(groupId);
      }
    }
    return undefined;
  }

  // 依照初始化時還原選取用的 id，找回對應的節點實例（可能是群組、設定項目，或作品的分類開關）。
  async findItemById(id: string): Promise<vscode.TreeItem | undefined> {
    if (id in GROUP_ITEM_IDS || id === GLOSSARY_CATEGORY_GROUP_ID) {
      return this.createGroupItem(id);
    }
    if (id.startsWith(GLOSSARY_CATEGORY_WORK_PREFIX)) {
      const config = await this.projectStore?.load();
      if (!config) {
        return undefined;
      }
      for (const work of config.works) {
        if (glossaryCategoryWorkGroupId(work.id) === id) {
          return this.createGlossaryCategoryWorkGroupItem(work);
        }
        const match = getCategoryCountsByUsage(work).find(
          ({ category }) => glossaryCategoryToggleId(work.id, category) === id
        );
        if (match) {
          return new GlossaryCategoryToggleItem(work, match.category, match.count);
        }
      }
      return undefined;
    }
    return this.createSettingItem(id);
  }

  // 依照使用者上次留下的展開／收合紀錄決定群組初始狀態，預設為全展開。
  private getGroupCollapsibleState(groupId: string): vscode.TreeItemCollapsibleState {
    const expanded = this.stateStore.isExpanded(groupId);
    return expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  }

  // 使用者展開或收合群組時呼叫，把狀態寫回 globalState，下次開啟畫面時套用。
  setGroupExpanded(groupId: string, expanded: boolean): void {
    const isKnownGroup =
      groupId in GROUP_ITEM_IDS ||
      groupId === GLOSSARY_CATEGORY_GROUP_ID ||
      (groupId.startsWith(GLOSSARY_CATEGORY_WORK_PREFIX) && !groupId.includes("/category/"));
    if (!isKnownGroup) {
      return;
    }
    this.stateStore.setExpanded(groupId, expanded);
  }

  private createGroupItem(groupId: string): SettingsGroupItem {
    return new SettingsGroupItem(GROUP_LABELS[groupId], groupId, this.getGroupCollapsibleState(groupId));
  }

  private async createGlossaryCategoryWorkGroups(): Promise<vscode.TreeItem[]> {
    if (!this.projectStore) {
      return [];
    }
    const config = await this.projectStore.load();
    return config.works
      .filter((work) => work.glossary.length > 0)
      .map((work) => this.createGlossaryCategoryWorkGroupItem(work));
  }

  private createGlossaryCategoryWorkGroupItem(work: WorkConfig): GlossaryCategoryWorkGroupItem {
    return new GlossaryCategoryWorkGroupItem(work, this.getGroupCollapsibleState(glossaryCategoryWorkGroupId(work.id)));
  }

  private async createGlossaryCategoryToggleItems(workId: string): Promise<vscode.TreeItem[]> {
    const config = await this.projectStore?.load();
    const work = config?.works.find((candidate) => candidate.id === workId);
    if (!work) {
      return [];
    }
    return getCategoryCountsByUsage(work).map(({ category, count }) => new GlossaryCategoryToggleItem(work, category, count));
  }

  private async findGlossaryCategoryWorkGroupItem(workId: string): Promise<GlossaryCategoryWorkGroupItem | undefined> {
    const config = await this.projectStore?.load();
    const work = config?.works.find((candidate) => candidate.id === workId);
    return work ? this.createGlossaryCategoryWorkGroupItem(work) : undefined;
  }

  private createSettingItem(itemId: string): vscode.TreeItem | undefined {
    const config = vscode.workspace.getConfiguration();
    switch (itemId) {
      case TRANSLATION_ON_LEFT_ITEM_ID:
        return new TranslationOnLeftSettingItem(config.get<boolean>(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY, true));
      case SCROLL_SYNC_ITEM_ID:
        return new ScrollSyncSettingItem(config.get<boolean>(SCROLL_SYNC_ENABLED_SETTING_KEY, true));
      case CURSOR_SYNC_ITEM_ID:
        return new CursorSyncSettingItem(config.get<boolean>(CURSOR_SYNC_ENABLED_SETTING_KEY, true));
      case GLOSSARY_AUTOCOMPLETE_ITEM_ID:
        return new GlossaryAutocompleteSettingItem(
          config.get<boolean>(GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY, true)
        );
      case GLOSSARY_PHONETIC_MATCH_ITEM_ID:
        return new GlossaryPhoneticMatchSettingItem(
          config.get<string>(GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY, "exact") === "phonetic"
        );
      case PUNCTUATION_SUGGEST_ITEM_ID:
        return new PunctuationSuggestSettingItem(config.get<boolean>(PUNCTUATION_SUGGEST_ENABLED_SETTING_KEY, true));
      default:
        return undefined;
    }
  }

  // 使用者點擊樹狀視圖裡的核取方塊時觸發，依勾選狀態直接寫回設定值。
  async handleCheckboxChange(item: vscode.TreeItem, state: vscode.TreeItemCheckboxState): Promise<void> {
    const checked = state === vscode.TreeItemCheckboxState.Checked;

    if (item instanceof GlossaryCategoryWorkGroupItem) {
      await this.projectStore?.setWorkGlossaryAutocompleteEnabled(item.workId, checked);
      this.emitter.fire();
      return;
    }

    if (item instanceof GlossaryCategoryToggleItem) {
      await this.projectStore?.setGlossaryCategoryEnabled(item.workId, item.category, checked);
      this.emitter.fire();
      return;
    }

    if (item.id === GLOSSARY_PHONETIC_MATCH_ITEM_ID) {
      await vscode.workspace
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
              : item.id === PUNCTUATION_SUGGEST_ITEM_ID
                ? PUNCTUATION_SUGGEST_ENABLED_SETTING_KEY
                : undefined;
    if (!settingKey) {
      return;
    }
    await vscode.workspace.getConfiguration().update(settingKey, checked, vscode.ConfigurationTarget.Global);
  }

  // 使用者點擊設定項目本身（非核取方塊）時觸發，依目前勾選狀態反轉後套用同一套邏輯。
  async toggleCheckbox(item: vscode.TreeItem): Promise<void> {
    const next =
      item.checkboxState === vscode.TreeItemCheckboxState.Checked
        ? vscode.TreeItemCheckboxState.Unchecked
        : vscode.TreeItemCheckboxState.Checked;
    await this.handleCheckboxChange(item, next);
  }
}
