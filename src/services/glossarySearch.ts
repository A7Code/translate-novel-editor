import { GlossaryEntry } from "../types";
import { getInitialPinyin, hasOverlappingReading } from "./pinyinUtil";

export interface GlossaryTextMatch {
  text: string;
  /** 比對到的區段，[起始位置, 長度]，給 UI 加上高光用。 */
  highlights: Array<[number, number]>;
  /** true 表示這個比對是靠同音比對找到的，不是逐字相符（用於 UI 標示「同音」）。 */
  phonetic: boolean;
}

export interface GlossarySearchResult {
  entry: GlossaryEntry;
  term: GlossaryTextMatch;
  translation: GlossaryTextMatch;
}

/**
 * 依查詢字串過濾詞彙表，term／translation 任一邊比對到都算命中，
 * 並回傳每一筆命中的高光區段供畫面標示。查詢字串為空時回傳全部詞條（無高光）。
 *
 * phoneticEnabled 開啟時，逐字相符找不到才會退而比對讀音（含聲調）是否相同，
 * 用來處理打錯同音字導致搜尋不到詞條的情況（例如搜尋「路西亞」要能找到「露西亞」）。
 */
export function searchGlossary(
  entries: readonly GlossaryEntry[],
  query: string,
  phoneticEnabled = false
): GlossarySearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return entries.map((entry) => ({
      entry,
      term: { text: entry.term, highlights: [], phonetic: false },
      translation: { text: entry.translation, highlights: [], phonetic: false }
    }));
  }

  const results: GlossarySearchResult[] = [];
  for (const entry of entries) {
    const term = matchText(entry.term, trimmed, phoneticEnabled);
    const translation = matchText(entry.translation, trimmed, phoneticEnabled);
    if (term.highlights.length > 0 || translation.highlights.length > 0) {
      results.push({ entry, term, translation });
    }
  }
  return results;
}

function matchText(text: string, query: string, phoneticEnabled: boolean): GlossaryTextMatch {
  const literalHighlights = findLiteralOccurrences(text, query);
  if (literalHighlights.length > 0) {
    return { text, highlights: literalHighlights, phonetic: false };
  }
  if (!phoneticEnabled) {
    return { text, highlights: [], phonetic: false };
  }
  const phoneticMatch = findPhoneticMatch(text, query);
  return phoneticMatch
    ? { text, highlights: [phoneticMatch], phonetic: true }
    : { text, highlights: [], phonetic: false };
}

/**
 * 逐字滑動視窗比對：候選字串裡每一段跟查詢字串等長的區間，
 * 只要每個位置的字讀音（含聲調）都跟查詢字串對應位置重疊，就算同音命中。
 * 查詢字串只要有一個字沒有中文讀音（英數、標點），就放棄同音比對。
 */
function findPhoneticMatch(text: string, query: string): [number, number] | undefined {
  const chars = Array.from(text);
  const queryChars = Array.from(query);
  if (queryChars.length === 0 || queryChars.length > chars.length) {
    return undefined;
  }

  const queryReadings = queryChars.map((char) => getInitialPinyin(char));
  if (queryReadings.some((readings) => readings.length === 0)) {
    return undefined;
  }

  for (let start = 0; start <= chars.length - queryReadings.length; start++) {
    const matched = queryReadings.every((readings, offset) =>
      hasOverlappingReading(readings, getInitialPinyin(chars[start + offset]))
    );
    if (matched) {
      return [start, queryReadings.length];
    }
  }
  return undefined;
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
