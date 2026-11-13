import { pinyin } from "pinyin-pro";

const PINYIN_WITH_TONE_PATTERN = /^[a-z]+[1-5]$/;

/**
 * 取得字串第一個字的所有可能讀音（含聲調，例如 "lu4"）。
 * 多音字會回傳多個讀音；非中文字（英數、標點等）pinyin-pro 會原字傳回，
 * 這裡一律過濾掉，視為「沒有讀音」。
 */
export function getInitialPinyin(text: string): string[] {
  const firstChar = text.trim().charAt(0);
  if (!firstChar) {
    return [];
  }
  const readings = pinyin(firstChar, { toneType: "num", multiple: true, type: "array" }) as string[];
  return readings.filter((reading) => PINYIN_WITH_TONE_PATTERN.test(reading));
}

/** 判斷兩組讀音是否有任何一個讀音（含聲調）完全相同。 */
export function hasOverlappingReading(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  return a.some((reading) => b.includes(reading));
}
