export const TRANSLATION_LANGUAGE_ID = "novel-translation";

// 控制「開啟比對畫面時是否自動套用詞彙表自動完成語言模式」的設定鍵，預設開啟。
export const GLOSSARY_AUTOCOMPLETE_ENABLED_SETTING_KEY = "novelTranslate.glossaryAutocomplete.enabled";

// 控制「開啟比對畫面時，翻譯稿是否顯示在左側」的設定鍵，預設開啟（翻譯在左、原文在右）。
export const COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY = "novelTranslate.compareView.translationOnLeft";

// 控制詞彙表自動完成的比對模式："exact"（只比對完全相同的文字前綴）
// 或 "phonetic"（文字前綴之外，游標前一字同音〔含聲調〕也會推薦）。
export const GLOSSARY_AUTOCOMPLETE_MATCH_MODE_SETTING_KEY = "novelTranslate.glossaryAutocomplete.matchMode";
