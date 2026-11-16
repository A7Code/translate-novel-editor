export interface ChapterConfig {
  id: string;
  title: string;
  originalPath: string;
  translationPath: string;
  /** 若此章節是從 EPUB 匯入的，記錄它在 EpubSourceInfo.packageDir 底下對應的 XHTML 相對路徑。 */
  epubContentPath?: string;
}

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
}

export interface ProjectConfig {
  version: 1;
  works: WorkConfig[];
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
