import { GlossaryEntry, WorkConfig } from "../core/types";

// 詞條沒有填分類時，統一歸到這個群組顯示／設定。
export const UNCATEGORIZED_CATEGORY = "未分類";

export function categoryOf(entry: GlossaryEntry): string {
  return entry.category?.trim() || UNCATEGORIZED_CATEGORY;
}

// 分類預設啟用；只有出現在 disabledGlossaryCategories 裡才視為關閉。
export function isCategoryEnabled(work: WorkConfig, category: string): boolean {
  return !(work.disabledGlossaryCategories ?? []).includes(category);
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
