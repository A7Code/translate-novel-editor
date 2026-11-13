import { GlossaryEntry } from "../types";

export interface GlossaryTextMatch {
  text: string;
  /** 比對到的區段，[起始位置, 長度]，給 UI 加上高光用。 */
  highlights: Array<[number, number]>;
}

export interface GlossarySearchResult {
  entry: GlossaryEntry;
  term: GlossaryTextMatch;
  translation: GlossaryTextMatch;
}

/**
 * 依查詢字串過濾詞彙表，term／translation 任一邊比對到都算命中，
 * 並回傳每一筆命中的高光區段供畫面標示。查詢字串為空時回傳全部詞條（無高光）。
 */
export function searchGlossary(entries: readonly GlossaryEntry[], query: string): GlossarySearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return entries.map((entry) => ({
      entry,
      term: { text: entry.term, highlights: [] },
      translation: { text: entry.translation, highlights: [] }
    }));
  }

  const results: GlossarySearchResult[] = [];
  for (const entry of entries) {
    const term = matchText(entry.term, trimmed);
    const translation = matchText(entry.translation, trimmed);
    if (term.highlights.length > 0 || translation.highlights.length > 0) {
      results.push({ entry, term, translation });
    }
  }
  return results;
}

function matchText(text: string, query: string): GlossaryTextMatch {
  return { text, highlights: findLiteralOccurrences(text, query) };
}

function findLiteralOccurrences(text: string, query: string): Array<[number, number]> {
  const highlights: Array<[number, number]> = [];
  let from = 0;
  while (from <= text.length - query.length) {
    const index = text.indexOf(query, from);
    if (index === -1) {
      break;
    }
    highlights.push([index, query.length]);
    from = index + query.length;
  }
  return highlights;
}
