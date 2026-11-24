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

/**
 * 從 fromLine 的下一行開始找未翻譯行，到結尾後繞回開頭，最後才檢查 fromLine 本身。
 * fromLine 傳 -1 表示從第一行開始。全部翻完時回傳 undefined。
 */
export function findNextUntranslatedLine(original: string, translation: string, fromLine: number): number | undefined {
  const originalLines = splitLines(original);
  const translationLines = splitLines(translation);
  const count = originalLines.length;
  for (let offset = 1; offset <= count; offset++) {
    const line = (fromLine + offset) % count;
    if (hasContent(originalLines[line]) && !hasContent(translationLines[line])) {
      return line;
    }
  }
  return undefined;
}

export type LineAlignmentIssueKind = "lineCountMismatch" | "missingTranslation";

export interface LineAlignmentIssue {
  /** 0-indexed，對應譯文文件的行號。 */
  line: number;
  kind: LineAlignmentIssueKind;
  message: string;
}

/**
 * 找出可能造成「後面整章錯位」的行數對齊問題（B6）：
 * - 譯文總行數比原文多：很可能是多了一個換行，從多出的那一行開始後面都可能對不上原文。
 *   （譯文比原文少行是翻譯中途的正常狀態——還沒翻到結尾，所以不檢查這個方向。）
 * - 原文有內容的某一行譯文空白，但譯文後面還有其他已翻譯的行：代表很可能是漏翻或對應到
 *   錯誤的行，跟「單純還沒翻到這裡」（空白只會留在譯文結尾，後面不會再出現內容）不同，
 *   所以只檢查最後一行有內容的譯文之前的範圍，避免翻譯中途的章節被整頁提示淹沒。
 * 沒有原文內容的章節（無原文章節）不需要對齊，略過不檢查。
 */
export function findLineAlignmentIssues(original: string, translation: string): LineAlignmentIssue[] {
  const originalLines = splitLines(original);
  const translationLines = splitLines(translation);
  if (!originalLines.some(hasContent)) {
    return [];
  }

  const issues: LineAlignmentIssue[] = [];

  if (translationLines.length > originalLines.length) {
    const extra = translationLines.length - originalLines.length;
    issues.push({
      line: originalLines.length,
      kind: "lineCountMismatch",
      message: `譯文共 ${translationLines.length} 行，比原文（${originalLines.length} 行）多 ${extra} 行，這一行開始可能都因為多出的換行而錯位。`
    });
  }

  let lastNonBlankTranslation = -1;
  for (let index = translationLines.length - 1; index >= 0; index--) {
    if (hasContent(translationLines[index])) {
      lastNonBlankTranslation = index;
      break;
    }
  }
  for (let index = 0; index < lastNonBlankTranslation; index++) {
    if (hasContent(originalLines[index]) && !hasContent(translationLines[index])) {
      issues.push({
        line: index,
        kind: "missingTranslation",
        message: `原文第 ${index + 1} 行有內容，但這行譯文是空白，而後面已經有譯文，可能是漏翻或對應到錯誤的行。`
      });
    }
  }

  return issues;
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
