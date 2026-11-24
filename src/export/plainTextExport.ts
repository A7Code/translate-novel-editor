// 匯出純文字（1.11）的內容組裝邏輯。這裡不依賴 vscode，讀檔與存檔交給 plainTextExportCommands 負責。

export type PlainTextExportMode = "translationOnly" | "bilingual";

export interface ChapterTextExportInput {
  title: string;
  original: string;
  translation: string;
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

// 原文與譯文依行號對齊，所以逐行交錯輸出即可；兩邊都是空白的那一行（通常是段落間的
// 分段空行）交錯後會變成兩個連續空行，當作加大的段落間距，不特別處理。
function buildBilingualBody(original: string, translation: string): string {
  const originalLines = splitLines(original);
  const translationLines = splitLines(translation);
  const lineCount = Math.max(originalLines.length, translationLines.length);
  const lines: string[] = [];
  for (let line = 0; line < lineCount; line++) {
    lines.push(originalLines[line] ?? "");
    lines.push(translationLines[line] ?? "");
  }
  return lines.join("\n");
}

/** 把章節清單組成一份純文字檔內容；章節之間以空白行分隔，每章前面有一行標題。 */
export function buildPlainTextExport(chapters: readonly ChapterTextExportInput[], mode: PlainTextExportMode): string {
  const sections = chapters.map((chapter) => {
    const body = mode === "translationOnly" ? chapter.translation : buildBilingualBody(chapter.original, chapter.translation);
    return `${chapter.title}\n\n${body}`;
  });
  return `${sections.join("\n\n\n")}\n`;
}
