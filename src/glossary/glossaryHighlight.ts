import { GlossaryEntry } from "../core/types";

export interface GlossaryTermMatch {
  entry: GlossaryEntry;
  /** 字元位置，供底線裝飾與懸停範圍使用。 */
  start: number;
  length: number;
}

/**
 * 在一行原文裡找出所有命中詞彙表的區段，供「原文詞彙標示與懸停」使用（1.5）。
 * 多個詞條互相重疊時（例如「莉莉亞」包含在「莉莉亞娜」裡），採用由左到右、
 * 同起點優先取最長命中的貪婪比對，跟中文斷詞常用的最大匹配法一致，
 * 避免同一段文字被兩個詞條重複標示。
 */
export function findGlossaryTermMatches(lineText: string, glossary: readonly GlossaryEntry[]): GlossaryTermMatch[] {
  const candidates: GlossaryTermMatch[] = [];
  for (const entry of glossary) {
    const term = entry.term;
    if (!term) {
      continue;
    }
    let from = 0;
    while (from <= lineText.length - term.length) {
      const index = lineText.indexOf(term, from);
      if (index === -1) {
        break;
      }
      candidates.push({ entry, start: index, length: term.length });
      from = index + 1;
    }
  }

  candidates.sort((a, b) => (a.start !== b.start ? a.start - b.start : b.length - a.length));

  const matches: GlossaryTermMatch[] = [];
  let coveredUntil = 0;
  for (const candidate of candidates) {
    if (candidate.start < coveredUntil) {
      continue;
    }
    matches.push(candidate);
    coveredUntil = candidate.start + candidate.length;
  }
  return matches;
}

/** 找出覆蓋 character 這個字元位置的命中區段（供懸停使用）。 */
export function findGlossaryTermMatchAt(
  lineText: string,
  glossary: readonly GlossaryEntry[],
  character: number
): GlossaryTermMatch | undefined {
  return findGlossaryTermMatches(lineText, glossary).find(
    (match) => character >= match.start && character < match.start + match.length
  );
}
