import { GlossaryEntry, ProjectConfig, WorkConfig } from "../core/types";

// 詞條沒有填分類時，統一歸到這個群組顯示／設定。
export const UNCATEGORIZED_CATEGORY = "未分類";

export function categoryOf(entry: GlossaryEntry): string {
  return entry.category?.trim() || UNCATEGORIZED_CATEGORY;
}

// 分類預設啟用；只有出現在 disabledGlossaryCategories 裡才視為關閉。
export function isCategoryEnabled(work: WorkConfig, category: string): boolean {
  return !(work.disabledGlossaryCategories ?? []).includes(category);
}

// 整個作品的詞彙表預設參與自動完成；只有明確設為 false 才視為關閉，
// 關閉後不論底下個別分類開關如何都不查詢（由呼叫端自行決定優先順序）。
export function isWorkGlossaryAutocompleteEnabled(work: WorkConfig): boolean {
  return work.glossaryAutocompleteEnabled !== false;
}

// 篩選出這個作品目前參與自動完成／標示的詞條：作品總開關關閉時整個作品沒有結果，
// 否則依各分類的開關過濾。原文詞彙標示（1.5）和譯名一致性檢查（1.7）共用這份邏輯。
export function enabledGlossaryEntries(work: WorkConfig): GlossaryEntry[] {
  if (!isWorkGlossaryAutocompleteEnabled(work)) {
    return [];
  }
  return work.glossary.filter((entry) => isCategoryEnabled(work, categoryOf(entry)));
}

// 跨作品共用的分類名稱清單：以專案層級的 categories 為主，再聯集目前這個作品
// 已經在用、但可能是舊資料（建立這個欄位之前）還沒被記錄進全域清單的分類，
// 確保不會漏掉既有詞條的分類。
export function collectKnownCategories(config: ProjectConfig, work?: WorkConfig): string[] {
  const categories = new Set<string>(config.categories ?? []);
  for (const entry of work?.glossary ?? []) {
    const trimmed = entry.category?.trim();
    if (trimmed) {
      categories.add(trimmed);
    }
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

export interface GlossaryCategoryCount {
  category: string;
  count: number;
}

// 依詞條數量由多到少排序，讓設定畫面優先列出目前最大宗的分類；
// 數量相同則依名稱排序，未分類固定排最後。
export function getCategoryCountsByUsage(work: WorkConfig): GlossaryCategoryCount[] {
  const counts = new Map<string, number>();
  for (const entry of work.glossary) {
    const category = categoryOf(entry);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => {
      if (a.category === UNCATEGORIZED_CATEGORY) {
        return 1;
      }
      if (b.category === UNCATEGORIZED_CATEGORY) {
        return -1;
      }
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.category.localeCompare(b.category, "zh-Hant");
    });
}
