import * as vscode from "vscode";
import { CommentThreadData } from "../types";
import { ProjectStore } from "./projectStore";

export class CommentStore {
  constructor(private readonly store: ProjectStore | undefined) {}

  async load(workId: string, chapterId: string): Promise<CommentThreadData[]> {
    const uri = this.fileUri(workId, chapterId);
    if (!uri) {
      return [];
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as CommentThreadData[];
    } catch {
      return [];
    }
  }

  async save(workId: string, chapterId: string, threads: CommentThreadData[]): Promise<void> {
    if (!this.store) {
      return;
    }
    const uri = this.fileUri(workId, chapterId);
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.createDirectory(this.store.resolveUri(`.novel-translate/comments/${workId}`));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(threads, null, 2), "utf8"));
  }

  private fileUri(workId: string, chapterId: string): vscode.Uri | undefined {
    return this.store?.resolveUri(`.novel-translate/comments/${workId}/${chapterId}.json`);
  }
}
