import * as vscode from "vscode";
import { posix as posixPath } from "node:path";
import { randomUUID } from "node:crypto";
import { ChapterConfig, EpubExtractVersion, EpubSourceInfo, GlossaryEntry, ProjectConfig, WorkConfig } from "./types";
import { getInitialPinyin } from "./pinyinUtil";
import { JsonFileStore } from "./jsonFileStore";
import { createWorkspaceFileOps } from "./workspaceFileOps";

const PROJECT_CONFIG_RELATIVE_PATH = ".novel-translate/project.json";
export const BACKUP_DIR = ".novel-translate/backups";
const PROJECT_BACKUP_PREFIX = "project";
const PROJECT_BACKUP_KEEP = 10;
// 刪除章節／作品（1.10）不會立即永久刪除，先把相關檔案搬到這裡，使用者需要的話可以手動救回。
const TRASH_DIR = ".novel-translate/trash";
// 留言檔的路徑跟 commentStore.ts 的 commentFilePath() 算法必須一致；這裡不直接 import 那個函式，
// 避免 core/ 反過來依賴 comments/（comments/ 已經依賴 ProjectStore，import 回去會形成循環依賴）。
function commentFilePathFor(workId: string, chapterId: string): string {
  return `.novel-translate/comments/${workId}/${chapterId}.json`;
}

function isProjectConfig(value: unknown): value is ProjectConfig {
  return typeof value === "object" && value !== null && Array.isArray((value as ProjectConfig).works);
}

function swapWithNeighbor<T>(items: T[], index: number, delta: -1 | 1): boolean {
  const target = index + delta;
  if (target < 0 || target >= items.length) {
    return false;
  }
  [items[index], items[target]] = [items[target], items[index]];
  return true;
}

export class ProjectStore {
  /** 共用的安全讀寫層，註解等其他資料檔也透過它寫入。 */
  readonly files: JsonFileStore;
  /** project.json 第一次被判定為無法讀取時呼叫，用來提示使用者還原。 */
  onLoadFailure: ((error: Error) => void) | undefined;

  private cache: ProjectConfig | undefined;
  private loading: Promise<ProjectConfig> | undefined;
  private failure: Error | undefined;

  constructor(private readonly workspaceFolder: vscode.WorkspaceFolder) {
    this.files = new JsonFileStore(createWorkspaceFileOps(workspaceFolder.uri));
  }

  resolveUri(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceFolder.uri, relativePath);
  }

  refresh(): void {
    this.cache = undefined;
    this.loading = undefined;
  }

  /** project.json 目前是否無法讀取。此時畫面顯示空清單，但所有寫入都會被拒絕。 */
  get loadFailure(): Error | undefined {
    return this.failure;
  }

  /**
   * 讀取專案設定。只有檔案不存在才視為新專案；檔案損毀時回傳空的記憶體資料讓畫面能顯示，
   * 並由 loadForWrite 擋下寫入，避免空資料覆蓋使用者的檔案。
   */
  async load(): Promise<ProjectConfig> {
    if (this.cache) {
      return this.cache;
    }
    if (!this.loading) {
      const loading: Promise<ProjectConfig> = this.readConfig(() => this.loading === loading).finally(() => {
        if (this.loading === loading) {
          this.loading = undefined;
        }
      });
      this.loading = loading;
    }
    return this.loading;
  }

  private async readConfig(isCurrent: () => boolean): Promise<ProjectConfig> {
    const result = await this.files.readJson(PROJECT_CONFIG_RELATIVE_PATH, isProjectConfig);
    const config: ProjectConfig = result.kind === "ok" ? result.value : { version: 1, works: [] };
    config.categories ??= [];
    for (const work of config.works) {
      work.glossary ??= [];
      work.disabledGlossaryCategories ??= [];
    }
    if (!isCurrent()) {
      return config;
    }

    this.cache = config;
    if (result.kind === "unreadable") {
      const isNewFailure = !this.failure;
      this.failure = result.error;
      if (isNewFailure) {
        this.onLoadFailure?.(result.error);
      }
    } else {
      this.failure = undefined;
    }
    return config;
  }

  private async loadForWrite(): Promise<ProjectConfig> {
    if (this.failure) {
      // 使用者可能已在外部修好檔案，寫入前重新確認一次。
      this.refresh();
    }
    const config = await this.load();
    if (this.failure) {
      throw new Error(
        `project.json 無法讀取，為避免覆蓋資料已停止寫入。請執行「小說翻譯：從備份還原專案」。（${this.failure.message}）`
      );
    }
    return config;
  }

  /** 備份目前有效的 project.json。檔案損毀或內容與最新備份相同時不會建立新備份。 */
  backupProject(): Promise<string | undefined> {
    return this.files.backup(PROJECT_CONFIG_RELATIVE_PATH, BACKUP_DIR, PROJECT_BACKUP_PREFIX, PROJECT_BACKUP_KEEP);
  }

  listProjectBackups(): Promise<string[]> {
    return this.files.listBackups(BACKUP_DIR, PROJECT_BACKUP_PREFIX);
  }

  async restoreProjectBackup(backupName: string): Promise<void> {
    await this.files.restore(PROJECT_CONFIG_RELATIVE_PATH, BACKUP_DIR, backupName, PROJECT_BACKUP_PREFIX);
    this.failure = undefined;
    this.refresh();
  }

  async setChapterExtractVersion(workId: string, chapterId: string, version: EpubExtractVersion): Promise<void> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const chapter = work.chapters.find((candidate) => candidate.id === chapterId);
    if (!chapter) {
      throw new Error(`找不到章節：${chapterId}`);
    }
    chapter.extractVersion = version;
    await this.save(config);
  }

  async addWork(input: {
    title: string;
    author?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  }): Promise<WorkConfig> {
    const config = await this.loadForWrite();
    const work: WorkConfig = {
      id: `work-${randomUUID().slice(0, 8)}`,
      title: input.title,
      author: input.author,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      chapters: [],
      glossary: []
    };
    config.works.push(work);
    await this.save(config);
    return work;
  }

  async updateWork(
    workId: string,
    input: { title: string; author?: string; sourceLanguage?: string; targetLanguage?: string }
  ): Promise<WorkConfig> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    work.title = input.title;
    work.author = input.author;
    work.sourceLanguage = input.sourceLanguage;
    work.targetLanguage = input.targetLanguage;
    await this.save(config);
    return work;
  }

  async addChapter(
    workId: string,
    title: string,
    originalContent = "",
    epubContentPath?: string,
    extractVersion?: EpubExtractVersion
  ): Promise<ChapterConfig> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);

    // 用隨機 id（而不是依目前章節數推算的序號）產生，刪除章節後再新增不會撞到被移到
    // trash 底下、但 id 仍被註解等資料引用的舊章節（1.10）。顯示順序不受影響，
    // 因為章節編號是依 work.chapters 陣列順序顯示，跟 id 本身的格式無關。
    const chapterId = `ch-${randomUUID().slice(0, 8)}`;
    const originalPath = `originals/${work.id}/${chapterId}.txt`;
    const translationPath = `translations/${work.id}/${chapterId}.txt`;

    await this.writeTextFile(originalPath, originalContent);
    await this.writeTextFile(translationPath, "");

    const chapter: ChapterConfig = {
      id: chapterId,
      title,
      originalPath,
      translationPath,
      epubContentPath,
      extractVersion
    };
    work.chapters.push(chapter);
    await this.save(config);
    return chapter;
  }

  // 只改顯示用標題；章節 id 與檔案路徑維持不變，註解和已開啟的比對分頁才不會失去對應。
  async renameChapter(workId: string, chapterId: string, title: string): Promise<ChapterConfig> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const chapter = work.chapters.find((candidate) => candidate.id === chapterId);
    if (!chapter) {
      throw new Error(`找不到章節：${chapterId}`);
    }
    chapter.title = title;
    await this.save(config);
    return chapter;
  }

  async moveWork(workId: string, delta: -1 | 1): Promise<boolean> {
    const config = await this.loadForWrite();
    const index = config.works.findIndex((candidate) => candidate.id === workId);
    if (index < 0 || !swapWithNeighbor(config.works, index, delta)) {
      return false;
    }
    await this.save(config);
    return true;
  }

  // 只調整陣列順序，章節 id 不重新編號，檔案路徑與註解的對應才不會錯位。
  async moveChapter(workId: string, chapterId: string, delta: -1 | 1): Promise<boolean> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const index = work.chapters.findIndex((candidate) => candidate.id === chapterId);
    if (index < 0 || !swapWithNeighbor(work.chapters, index, delta)) {
      return false;
    }
    await this.save(config);
    return true;
  }

  // 標記／取消標記一筆譯名一致性檢查提示為「忽略」，供 1.7 的 Problems 面板快速修正使用。
  // 用 (line, entryId) 當 key，不會因為同一章節其他提示而互相干擾；行號本身不會跟著文字
  // 移動（跟留言的已知限制 B7 一致），之後增刪該行以上的內容時可能需要重新忽略一次。
  async setConsistencyIssueIgnored(
    workId: string,
    chapterId: string,
    line: number,
    entryId: string,
    ignored: boolean
  ): Promise<void> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const chapter = work.chapters.find((candidate) => candidate.id === chapterId);
    if (!chapter) {
      throw new Error(`找不到章節：${chapterId}`);
    }
    const existing = (chapter.ignoredConsistencyIssues ?? []).filter(
      (key) => !(key.line === line && key.entryId === entryId)
    );
    chapter.ignoredConsistencyIssues = ignored ? [...existing, { line, entryId }] : existing;
    await this.save(config);
  }

  // 刪除章節：先把原文、譯文與翻譯筆記搬到 trash，成功後才把章節從設定中移除並存檔
  // （跟 addChapter 「先寫檔案、再存設定」是同一種順序，確保設定不會指到不存在的檔案）。
  async deleteChapter(workId: string, chapterId: string): Promise<void> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const index = work.chapters.findIndex((candidate) => candidate.id === chapterId);
    if (index < 0) {
      throw new Error(`找不到章節：${chapterId}`);
    }
    const chapter = work.chapters[index];

    await this.moveToTrash(chapterId, [
      chapter.originalPath,
      chapter.translationPath,
      commentFilePathFor(workId, chapterId)
    ]);
    work.chapters.splice(index, 1);
    await this.save(config);
  }

  // 刪除作品：連同底下所有章節的原文、譯文、翻譯筆記，以及 EPUB 來源（如果有）一併搬到 trash。
  async deleteWork(workId: string): Promise<void> {
    const config = await this.loadForWrite();
    const index = config.works.findIndex((candidate) => candidate.id === workId);
    if (index < 0) {
      throw new Error(`找不到作品：${workId}`);
    }
    const work = config.works[index];

    const relativePaths = [`originals/${work.id}`, `translations/${work.id}`, `.novel-translate/comments/${work.id}`];
    if (work.epubSource) {
      relativePaths.push(work.epubSource.packageDir);
    }
    await this.moveToTrash(work.id, relativePaths);
    config.works.splice(index, 1);
    await this.save(config);
  }

  // 把檔案或資料夾搬到 .novel-translate/trash/<時間戳記>-<label>/<原本的相對路徑> 底下，
  // 保留原本的相對路徑結構方便人工比對、救回。本來就不存在的路徑（例如還沒有任何留言）直接略過。
  private async moveToTrash(label: string, relativePaths: readonly string[]): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const trashRoot = `${TRASH_DIR}/${stamp}-${label}`;
    for (const relativePath of relativePaths) {
      const sourceUri = this.resolveUri(relativePath);
      try {
        await vscode.workspace.fs.stat(sourceUri);
      } catch {
        continue;
      }
      const targetRelativePath = `${trashRoot}/${relativePath}`;
      await vscode.workspace.fs.createDirectory(this.resolveUri(posixPath.dirname(targetRelativePath)));
      await vscode.workspace.fs.rename(sourceUri, this.resolveUri(targetRelativePath), { overwrite: false });
    }
  }

  async addGlossaryEntry(
    workId: string,
    input: { term: string; translation: string; category?: string; note?: string }
  ): Promise<GlossaryEntry> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);

    const entry: GlossaryEntry = {
      id: `term-${randomUUID().slice(0, 8)}`,
      term: input.term,
      translation: input.translation,
      category: input.category,
      note: input.note,
      termInitialPinyin: getInitialPinyin(input.term),
      translationInitialPinyin: getInitialPinyin(input.translation)
    };
    work.glossary.push(entry);
    this.registerCategory(config, entry.category);
    await this.save(config);
    return entry;
  }

  async updateGlossaryEntry(
    workId: string,
    entryId: string,
    input: { term: string; translation: string; category?: string; note?: string }
  ): Promise<GlossaryEntry> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const entry = work.glossary.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new Error(`找不到詞條：${entryId}`);
    }

    entry.term = input.term;
    entry.translation = input.translation;
    entry.category = input.category;
    entry.note = input.note;
    entry.termInitialPinyin = getInitialPinyin(input.term);
    entry.translationInitialPinyin = getInitialPinyin(input.translation);
    this.registerCategory(config, entry.category);
    await this.save(config);
    return entry;
  }

  // 新增／編輯詞條只要填了分類，就記錄進跨作品共用的分類清單，之後其他作品選分類時
  // 就能直接選用、不用重新輸入（實際清單見 ProjectConfig.categories）。
  private registerCategory(config: ProjectConfig, category: string | undefined): void {
    const trimmed = category?.trim();
    if (!trimmed) {
      return;
    }
    config.categories ??= [];
    if (!config.categories.includes(trimmed)) {
      config.categories.push(trimmed);
    }
  }

  async deleteGlossaryEntry(workId: string, entryId: string): Promise<void> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    work.glossary = work.glossary.filter((candidate) => candidate.id !== entryId);
    await this.save(config);
  }

  // 設定「某作品底下的某個詞彙分類」是否在自動完成時被查詢，設定值跟作品資料一起存進
  // project.json，重啟 VS Code 後會自動還原，不需要另外處理持久化。
  async setGlossaryCategoryEnabled(workId: string, category: string, enabled: boolean): Promise<void> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const disabled = new Set(work.disabledGlossaryCategories ?? []);
    if (enabled) {
      disabled.delete(category);
    } else {
      disabled.add(category);
    }
    work.disabledGlossaryCategories = Array.from(disabled);
    await this.save(config);
  }

  // 設定「某作品整體」是否參與自動完成；關閉後不論底下個別分類開關如何都不查詢。
  // 跟 setGlossaryCategoryEnabled 分屬不同層級、互不取代，同樣存進 project.json 自動持久化。
  async setWorkGlossaryAutocompleteEnabled(workId: string, enabled: boolean): Promise<void> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    work.glossaryAutocompleteEnabled = enabled;
    await this.save(config);
  }

  async findWorkIdForDocumentUri(uri: vscode.Uri): Promise<string | undefined> {
    return (await this.findChapterForDocumentUri(uri))?.workId;
  }

  async findChapterForDocumentUri(
    uri: vscode.Uri
  ): Promise<{ workId: string; chapter: ChapterConfig; relativePath: string } | undefined> {
    const config = await this.load();
    const target = uri.toString();
    for (const work of config.works) {
      for (const chapter of work.chapters) {
        if (this.resolveUri(chapter.originalPath).toString() === target) {
          return { workId: work.id, chapter, relativePath: chapter.originalPath };
        }
        if (this.resolveUri(chapter.translationPath).toString() === target) {
          return { workId: work.id, chapter, relativePath: chapter.translationPath };
        }
      }
    }
    return undefined;
  }

  async findGlossaryEntryByTerm(workId: string, term: string): Promise<GlossaryEntry | undefined> {
    const config = await this.load();
    const work = this.findWork(config, workId);
    const normalized = term.trim().toLowerCase();
    return work.glossary.find((candidate) => candidate.term.trim().toLowerCase() === normalized);
  }

  async setEpubSource(workId: string, opfPath: string): Promise<EpubSourceInfo> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    const epubSource: EpubSourceInfo = { packageDir: `.novel-translate/epub/${work.id}/package`, opfPath };
    work.epubSource = epubSource;
    await this.save(config);
    return epubSource;
  }

  async writeEpubPackageFiles(workId: string, files: Map<string, Uint8Array>): Promise<void> {
    const config = await this.loadForWrite();
    const work = this.findWork(config, workId);
    if (!work.epubSource) {
      throw new Error(`作品尚未設定 EPUB 來源：${workId}`);
    }
    for (const [relativePath, bytes] of files) {
      await this.writeBinaryFile(`${work.epubSource.packageDir}/${relativePath}`, bytes);
    }
  }

  async listEpubPackageFiles(workId: string): Promise<Map<string, Uint8Array>> {
    const config = await this.load();
    const work = this.findWork(config, workId);
    if (!work.epubSource) {
      throw new Error(`作品尚未設定 EPUB 來源：${workId}`);
    }
    const result = new Map<string, Uint8Array>();
    await this.walkDirectory(this.resolveUri(work.epubSource.packageDir), "", result);
    return result;
  }

  private async walkDirectory(
    dirUri: vscode.Uri,
    relativePrefix: string,
    out: Map<string, Uint8Array>
  ): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(dirUri, name);
      const childRelative = relativePrefix ? `${relativePrefix}/${name}` : name;
      if (type === vscode.FileType.Directory) {
        await this.walkDirectory(childUri, childRelative, out);
      } else {
        out.set(childRelative, await vscode.workspace.fs.readFile(childUri));
      }
    }
  }

  private findWork(config: ProjectConfig, workId: string): WorkConfig {
    const work = config.works.find((candidate) => candidate.id === workId);
    if (!work) {
      throw new Error(`找不到作品：${workId}`);
    }
    return work;
  }

  private async writeTextFile(relativePath: string, content: string): Promise<void> {
    await this.writeBinaryFile(relativePath, Buffer.from(content, "utf8"));
  }

  private async writeBinaryFile(relativePath: string, bytes: Uint8Array): Promise<void> {
    const dirUri = this.resolveUri(posixPath.dirname(relativePath));
    await vscode.workspace.fs.createDirectory(dirUri);
    await vscode.workspace.fs.writeFile(this.resolveUri(relativePath), bytes);
  }

  private async save(config: ProjectConfig): Promise<void> {
    this.cache = config;
    await this.files.writeJson(PROJECT_CONFIG_RELATIVE_PATH, config);
  }
}
