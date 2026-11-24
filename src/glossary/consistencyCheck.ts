// 譯名一致性檢查（1.7）的逐行比對邏輯：原文出現詞彙表詞條，但同一行譯文沒有找到對應的
// 譯名時提示。這裡不依賴 vscode，顯示在 Problems 面板的部分交給 consistencyDiagnosticsExtension 負責。

import { GlossaryEntry } from "../core/types";
import { findGlossaryTermMatches } from "./glossaryHighlight";

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export interface ConsistencyIssue {
  /** 0-indexed，原文與譯文的同一行號。 */
  line: number;
  entryId: string;
  term: string;
  translation: string;
  message: string;
}

/** 忽略清單的 key，格式見 ChapterConfig.ignoredConsistencyIssues。 */
export function consistencyIssueKey(line: number, entryId: string): string {
  return `${line}:${entryId}`;
}

/**
 * 找出原文該行命中詞彙表詞條、但譯文該行沒有對應譯名的問題。
 * - 譯文該行還是空白（還沒翻到這裡）不檢查，避免跟「翻譯進度」混在一起吵。
 * - 同一行同一個詞條只回報一次，即使原文該行出現這個詞條兩次。
 * - ignoredKeys 列出使用者已標記為「忽略」的 (line, entryId) 組合，不再回報。
 */
export function findConsistencyIssues(
  original: string,
  translation: string,
  glossary: readonly GlossaryEntry[],
  ignoredKeys: ReadonlySet<string> = new Set()
): ConsistencyIssue[] {
  if (glossary.length === 0) {
    return [];
  }

  const originalLines = splitLines(original);
  const translationLines = splitLines(translation);
  const issues: ConsistencyIssue[] = [];

  for (let line = 0; line < originalLines.length; line++) {
    const translationLine = translationLines[line];
    if (!translationLine?.trim()) {
      continue;
    }

    const reportedEntryIds = new Set<string>();
    for (const match of findGlossaryTermMatches(originalLines[line], glossary)) {
      const { entry } = match;
      if (!entry.translation || reportedEntryIds.has(entry.id) || ignoredKeys.has(consistencyIssueKey(line, entry.id))) {
        continue;
      }
      if (translationLine.includes(entry.translation)) {
        continue;
      }
      reportedEntryIds.add(entry.id);
      issues.push({
        line,
        entryId: entry.id,
        term: entry.term,
        translation: entry.translation,
        message: `原文出現詞條「${entry.term}」，但這行譯文沒有找到對應的譯名「${entry.translation}」。`
      });
    }
  }

  return issues;
}
