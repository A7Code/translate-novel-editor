export interface ChapterConfig {
  id: string;
  title: string;
  originalPath: string;
  translationPath: string;
  /** 若此章節是從 EPUB 匯入的，記錄它在 EpubSourceInfo.packageDir 底下對應的 XHTML 相對路徑。 */
  epubContentPath?: string;
  /** EPUB 段落抽取規則版本；未設定的 EPUB 章節視為 1。行號依此版本對應，不可任意更改。 */
  extractVersion?: EpubExtractVersion;
}

export type EpubExtractVersion = 1 | 2;

export interface EpubSourceInfo {
  /** 解壓後的 EPUB 內容存放位置，工作區相對路徑。 */
  packageDir: string;
  /** OPF（content.opf）在 packageDir 底下的相對路徑。 */
  opfPath: string;
}

export interface GlossaryEntry {
  id: string;
  term: string;
  translation: string;
  category?: string;
  note?: string;
  /** term 第一個字的讀音（含聲調，例如 "lu4"；多音字會有多個）。新增/編輯詞條時寫入，供語音比對建議使用。 */
  termInitialPinyin?: string[];
  /** translation 第一個字的讀音（含聲調）。 */
  translationInitialPinyin?: string[];
}

export interface WorkConfig {
  id: string;
  title: string;
  author?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  chapters: ChapterConfig[];
  glossary: GlossaryEntry[];
  epubSource?: EpubSourceInfo;
  /** 這個作品底下被使用者關閉、自動完成時不查詢的詞彙分類名稱（對應 GlossaryEntry.category，未分類固定用「未分類」表示）。 */
  disabledGlossaryCategories?: string[];
  /** 這個作品的詞彙表是否整體參與自動完成；預設視為 true，設為 false 時不論底下個別分類開關如何都不查詢。 */
  glossaryAutocompleteEnabled?: boolean;
}

export interface ProjectConfig {
  version: 1;
  works: WorkConfig[];
  /** 跨作品共用的詞彙分類名稱清單；新增/編輯詞條填了分類時會自動記錄進來，供其他作品選用，不用重新輸入。 */
  categories?: string[];
}

export interface CommentData {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface CommentThreadData {
  id: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  resolved: boolean;
  comments: CommentData[];
}
