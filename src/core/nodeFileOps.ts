import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FileOps } from "./jsonFileStore";

const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_DELAYS_MS = [20, 60, 150, 400];

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * 本機檔案操作。這裡刻意不用 vscode.workspace.fs.rename：它覆寫時可能先刪除目標，
 * 中途當機就會失去檔案；Node 的 fs.rename 才是作業系統層級的取代。
 */
export class NodeFileOps implements FileOps {
  constructor(private readonly rootPath: string) {}

  private resolve(relativePath: string): string {
    return path.join(this.rootPath, ...relativePath.split("/"));
  }

  async read(relativePath: string): Promise<Uint8Array | undefined> {
    try {
      return await fs.readFile(this.resolve(relativePath));
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async write(relativePath: string, bytes: Uint8Array): Promise<void> {
    const handle = await fs.open(this.resolve(relativePath), "w");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  // Windows 上防毒或索引程式短暫佔用檔案時，rename 會失敗，稍後重試通常就會成功。
  async rename(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(this.resolve(from), this.resolve(to));
        return;
      } catch (error) {
        const code = errorCode(error);
        if (!code || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  async remove(relativePath: string): Promise<void> {
    await fs.rm(this.resolve(relativePath), { force: true });
  }

  async list(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.resolve(dir), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(this.resolve(dir), { recursive: true });
  }
}
