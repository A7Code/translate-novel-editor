// 翻譯進度的計算規則。這裡不依賴 vscode，讀檔、快取與事件由 progressService 負責。

export type ChapterStatus = "empty" | "notStarted" | "inProgress" | "done";

export interface ChapterProgress {
  /** 原文中有內容的行數。 */
  totalLines: number;
  /** 原文該行有內容，且譯文同一行也有內容的行數。 */
  translatedLines: number;
  /** 原文該行空白或不存在，譯文卻有內容的行數；不計入進度。 */
  extraTranslationLines: number;
  /** 無條件捨去的百分比；沒有原文時為 null。 */
  percent: number | null;
  status: ChapterStatus;
}

export interface WorkProgress {
  totalLines: number;
  translatedLines: number;
  extraTranslationLines: number;
  percent: number | null;
  /** 已翻完的章節數。 */
  doneChapters: number;
  /** 有原文內容的章節數；無原文的章節不計入。 */
  countedChapters: number;
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

// String.prototype.trim 會移除全形空白（U+3000）與 BOM，所以這兩種都視為空白行。
function hasContent(line: string | undefined): boolean {
  return line !== undefined && line.trim().length > 0;
}

// 無條件捨去，還差一行時才不會顯示 100%。
function toPercent(translatedLines: number, totalLines: number): number | null {
  return totalLines === 0 ? null : Math.floor((translatedLines * 100) / totalLines);
}

export function computeChapterProgress(original: string, translation: string): ChapterProgress {
  const originalLines = splitLines(original);
  const translationLines = splitLines(translation);
  let totalLines = 0;
  let translatedLines = 0;
  let extraTranslationLines = 0;

  const lineCount = Math.max(originalLines.length, translationLines.length);
  for (let index = 0; index < lineCount; index++) {
    const originalHasContent = hasContent(originalLines[index]);
    const translationHasContent = hasContent(translationLines[index]);
    if (originalHasContent) {
      totalLines++;
      if (translationHasContent) {
        translatedLines++;
      }
    } else if (translationHasContent) {
      extraTranslationLines++;
    }
  }

  let status: ChapterStatus;
  if (totalLines === 0) {
    status = "empty";
  } else if (translatedLines === 0) {
    status = "notStarted";
  } else if (translatedLines === totalLines) {
    status = "done";
  } else {
    status = "inProgress";
  }

  return {
    totalLines,
    translatedLines,
    extraTranslationLines,
    percent: toPercent(translatedLines, totalLines),
    status
  };
}

// 以行數加總計算，不平均各章百分比，短章節才不會扭曲整體數字。
export function summarizeWorkProgress(chapters: readonly ChapterProgress[]): WorkProgress {
  let totalLines = 0;
  let translatedLines = 0;
  let extraTranslationLines = 0;
  let doneChapters = 0;
  let countedChapters = 0;

  for (const chapter of chapters) {
    totalLines += chapter.totalLines;
    translatedLines += chapter.translatedLines;
    extraTranslationLines += chapter.extraTranslationLines;
    if (chapter.status !== "empty") {
      countedChapters++;
    }
    if (chapter.status === "done") {
      doneChapters++;
    }
  }

  return {
    totalLines,
    translatedLines,
    extraTranslationLines,
    percent: toPercent(translatedLines, totalLines),
    doneChapters,
    countedChapters
  };
}

/** 依章節順序找出第一個還沒翻完的章節；無原文的章節不需要翻譯，會被略過。 */
export function findFirstIncompleteChapter(
  chapterIds: readonly string[],
  progressById: Readonly<Record<string, ChapterProgress | undefined>>
): string | undefined {
  return chapterIds.find((id) => {
    const status = progressById[id]?.status;
    return status === "notStarted" || status === "inProgress";
  });
}
