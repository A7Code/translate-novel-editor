import * as vscode from "vscode";
import { posix as posixPath } from "node:path";
import { randomUUID } from "node:crypto";
import { ChapterConfig, ProjectConfig, WorkConfig } from "../types";

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
      chapters: []
    };
    config.works.push(work);
    await this.save(config);
    return work;
  }

  async addChapter(workId: string, title: string, originalContent = ""): Promise<ChapterConfig> {
    const config = await this.load();
    const work = config.works.find((candidate) => candidate.id === workId);
    if (!work) {
      throw new Error(`找不到作品：${workId}`);
    }

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
