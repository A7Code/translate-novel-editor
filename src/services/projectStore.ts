import * as vscode from "vscode";
import { posix as posixPath } from "node:path";
import { randomUUID } from "node:crypto";
import { ChapterConfig, GlossaryEntry, ProjectConfig, WorkConfig } from "../types";

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

  async addChapter(workId: string, title: string, originalContent = ""): Promise<ChapterConfig> {
    const config = await this.load();
    const work = this.findWork(config, workId);

    const index = work.chapters.length + 1;
    const chapterId = `ch${String(index).padStart(2, "0")}`;
    const originalPath = `originals/${work.id}/${chapterId}.txt`;
    const translationPath = `translations/${work.id}/${chapterId}.txt`;

    await this.writeTextFile(originalPath, originalContent);
    await this.writeTextFile(translationPath, "");

    const chapter: ChapterConfig = { id: chapterId, title, originalPath, translationPath };
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
      note: input.note
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
    await this.save(config);
    return entry;
  }

  async deleteGlossaryEntry(workId: string, entryId: string): Promise<void> {
    const config = await this.load();
    const work = this.findWork(config, workId);
    work.glossary = work.glossary.filter((candidate) => candidate.id !== entryId);
    await this.save(config);
  }

  async findChapterByTranslationUri(
    uri: vscode.Uri
  ): Promise<{ workId: string; chapter: ChapterConfig } | undefined> {
    const config = await this.load();
    const target = uri.toString();
    for (const work of config.works) {
      const chapter = work.chapters.find((candidate) => this.resolveUri(candidate.translationPath).toString() === target);
      if (chapter) {
        return { workId: work.id, chapter };
      }
    }
    return undefined;
  }

  async findWorkIdForDocumentUri(uri: vscode.Uri): Promise<string | undefined> {
    const config = await this.load();
    const target = uri.toString();
    for (const work of config.works) {
      const chapter = work.chapters.find(
        (candidate) =>
          this.resolveUri(candidate.originalPath).toString() === target ||
          this.resolveUri(candidate.translationPath).toString() === target
      );
      if (chapter) {
        return work.id;
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

  private findWork(config: ProjectConfig, workId: string): WorkConfig {
    const work = config.works.find((candidate) => candidate.id === workId);
    if (!work) {
      throw new Error(`找不到作品：${workId}`);
    }
    return work;
  }

  private async writeTextFile(relativePath: string, content: string): Promise<void> {
    const dirUri = this.resolveUri(posixPath.dirname(relativePath));
    await vscode.workspace.fs.createDirectory(dirUri);
    await vscode.workspace.fs.writeFile(this.resolveUri(relativePath), Buffer.from(content, "utf8"));
  }

  private async save(config: ProjectConfig): Promise<void> {
    this.cache = config;
    const dirUri = this.resolveUri(posixPath.dirname(PROJECT_CONFIG_RELATIVE_PATH));
    await vscode.workspace.fs.createDirectory(dirUri);
    const bytes = Buffer.from(JSON.stringify(config, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(this.resolveUri(PROJECT_CONFIG_RELATIVE_PATH), bytes);
  }
}
