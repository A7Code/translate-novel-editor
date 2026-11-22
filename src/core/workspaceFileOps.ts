import * as vscode from "vscode";
import { FileOps } from "./jsonFileStore";
import { NodeFileOps } from "./nodeFileOps";

/** 非本機工作區（虛擬檔案系統）的後備實作；這類環境無法保證 rename 是原子操作。 */
class VscodeFileOps implements FileOps {
  constructor(private readonly root: vscode.Uri) {}

  private resolve(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, relativePath);
  }

  async read(relativePath: string): Promise<Uint8Array | undefined> {
    try {
      return await vscode.workspace.fs.readFile(this.resolve(relativePath));
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return undefined;
      }
      throw error;
    }
  }

  async write(relativePath: string, bytes: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(this.resolve(relativePath), bytes);
  }

  async rename(from: string, to: string): Promise<void> {
    await vscode.workspace.fs.rename(this.resolve(from), this.resolve(to), { overwrite: true });
  }

  async remove(relativePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.resolve(relativePath));
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
        throw error;
      }
    }
  }

  async list(dir: string): Promise<string[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.resolve(dir));
      return entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return [];
      }
      throw error;
    }
  }

  async ensureDir(dir: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.resolve(dir));
  }
}

export function createWorkspaceFileOps(root: vscode.Uri): FileOps {
  return root.scheme === "file" ? new NodeFileOps(root.fsPath) : new VscodeFileOps(root);
}
