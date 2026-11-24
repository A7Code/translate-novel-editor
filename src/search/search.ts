// 全作品搜尋的逐行比對邏輯。這裡不依賴 vscode，讀檔與彙整跨作品結果交給 searchService 負責。

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export interface ChapterSearchMatch {
  /** 0-indexed，原文與譯文的同一行號。 */
  line: number;
  original: string;
  translation: string;
}

/**
 * 在同一章節裡逐行比對原文、譯文是否包含關鍵字（不分大小寫），任一側命中即算這一行命中，
 * 這樣「這個詞之前怎麼翻」才能同時從原文或譯文下手查詢。
 */
export function searchChapterLines(original: string, translation: string, query: string): ChapterSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const originalLines = splitLines(original);
  const translationLines = splitLines(translation);
  const lineCount = Math.max(originalLines.length, translationLines.length);
  const matches: ChapterSearchMatch[] = [];
  for (let line = 0; line < lineCount; line++) {
    const originalLine = originalLines[line] ?? "";
    const translationLine = translationLines[line] ?? "";
    if (originalLine.toLowerCase().includes(needle) || translationLine.toLowerCase().includes(needle)) {
      matches.push({ line, original: originalLine, translation: translationLine });
    }
  }
  return matches;
}
