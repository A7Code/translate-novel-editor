import * as vscode from "vscode";
import { posix as posixPath } from "node:path";
import { randomUUID } from "node:crypto";
import { ChapterConfig, EpubSourceInfo, GlossaryEntry, ProjectConfig, WorkConfig } from "../types";
import { getInitialPinyin } from "./pinyinUtil";

const PROJECT_CONFIG_RELATIVE_PATH = ".novel-translate/project.json";

export class ProjectStore {
  private cache: ProjectConfig | undefined;

  constructor(private readonly workspaceFolder: vscode.WorkspaceFolder) {}

  resolveUri(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceFolder.uri, relativePath);
  }

  refresh(): void {
    this.cache = undefined;
  }

  async load(): Promise<ProjectConfig> {
    if (this.cache) {
      return this.cache;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(this.resolveUri(PROJECT_CONFIG_RELATIVE_PATH));
      this.cache = JSON.parse(Buffer.from(bytes).toString("utf8")) as ProjectConfig;
    } catch {
      this.cache = { version: 1, works: [] };
    }
    for (const work of this.cache.works) {
      work.glossary ??= [];
    }
    return this.cache;
  }

  async addWork(input: {
    title: string;
    author?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  }): Promise<WorkConfig> {
    const config = await this.load();
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

  async addChapter(
    workId: string,
    title: string,
    originalContent = "",
    epubContentPath?: string
  ): Promise<ChapterConfig> {
    const config = await this.load();
    const work = this.findWork(config, workId);

    const index = work.chapters.length + 1;
    const chapterId = `ch${String(index).padStart(2, "0")}`;
    const originalPath = `originals/${work.id}/${chapterId}.txt`;
    const translationPath = `translations/${work.id}/${chapterId}.txt`;

    await this.writeTextFile(originalPath, originalContent);
    await this.writeTextFile(translationPath, "");

    const chapter: ChapterConfig = { id: chapterId, title, originalPath, translationPath, epubContentPath };
    work.chapters.push(chapter);
    await this.save(config);
    return chapter;
  }

  async addGlossaryEntry(
    workId: string,
    input: { term: string; translation: string; category?: string; note?: string }
  ): Promise<GlossaryEntry> {
    const config = await this.load();
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
    await this.save(config);
    return entry;
  }

  async updateGlossaryEntry(
    workId: string,
    entryId: string,
    input: { term: string; translation: string; category?: string; note?: string }
  ): Promise<GlossaryEntry> {
    const config = await this.load();
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
    await this.save(config);
    return entry;
  }

  async deleteGlossaryEntry(workId: string, entryId: string): Promise<void> {
    const config = await this.load();
    const work = this.findWork(config, workId);
    work.glossary = work.glossary.filter((candidate) => candidate.id !== entryId);
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
    const config = await this.load();
    const work = this.findWork(config, workId);
    const epubSource: EpubSourceInfo = { packageDir: `.novel-translate/epub/${work.id}/package`, opfPath };
    work.epubSource = epubSource;
    await this.save(config);
    return epubSource;
  }

  async writeEpubPackageFiles(workId: string, files: Map<string, Uint8Array>): Promise<void> {
    const config = await this.load();
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
    const dirUri = this.resolveUri(posixPath.dirname(PROJECT_CONFIG_RELATIVE_PATH));
    await vscode.workspace.fs.createDirectory(dirUri);
    const bytes = Buffer.from(JSON.stringify(config, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(this.resolveUri(PROJECT_CONFIG_RELATIVE_PATH), bytes);
  }
}
