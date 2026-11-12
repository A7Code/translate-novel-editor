export interface ChapterConfig {
  id: string;
  title: string;
  originalPath: string;
  translationPath: string;
}

export interface WorkConfig {
  id: string;
  title: string;
  author?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  chapters: ChapterConfig[];
}

export interface ProjectConfig {
  version: 1;
  works: WorkConfig[];
}
