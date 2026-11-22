import { randomUUID } from "node:crypto";
import { posix as posixPath } from "node:path";

/** 檔案操作介面，路徑一律是工作區相對路徑（以 / 分隔）。本模組不依賴 vscode，方便單元測試。 */
export interface FileOps {
  /** 檔案不存在時回傳 undefined；其他讀取錯誤必須拋出，呼叫端才能區分「新專案」和「讀取失敗」。 */
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** 以 from 覆蓋 to，實作必須盡可能是原子操作。 */
  rename(from: string, to: string): Promise<void>;
  /** 檔案不存在時不視為錯誤。 */
  remove(path: string): Promise<void>;
  /** 列出目錄內的檔名；目錄不存在時回傳空陣列。 */
  list(dir: string): Promise<string[]>;
  ensureDir(dir: string): Promise<void>;
}

export type JsonReadResult<T> =
  | { kind: "missing" }
  | { kind: "ok"; value: T }
  | { kind: "unreadable"; error: Error };

export type JsonValidator<T> = (value: unknown) => value is T;

export class JsonFileUnreadableError extends Error {
  constructor(
    readonly path: string,
    readonly reason: Error
  ) {
    super(`無法讀取 ${path}：${reason.message}`);
    this.name = "JsonFileUnreadableError";
  }
}

function parseJson<T>(bytes: Uint8Array, validate?: JsonValidator<T>): T {
  const text = Buffer.from(bytes).toString("utf8").replace(/^﻿/, "");
  const value: unknown = JSON.parse(text);
  if (validate && !validate(value)) {
    throw new Error("檔案內容格式不正確");
  }
  return value as T;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function backupTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, "");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** 共用的安全讀寫層：同一路徑的操作依序執行，寫入時先寫暫存檔再改名。 */
export class JsonFileStore {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly ops: FileOps) {}

  private enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(path) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.queues.set(path, tail);
    void tail.then(() => {
      if (this.queues.get(path) === tail) {
        this.queues.delete(path);
      }
    });
    return run;
  }

  private async writeAtomicNow(path: string, bytes: Uint8Array): Promise<void> {
    await this.ops.ensureDir(posixPath.dirname(path));
    const tempPath = `${path}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      await this.ops.write(tempPath, bytes);
      await this.ops.rename(tempPath, path);
    } catch (error) {
      await this.ops.remove(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private async readJsonNow<T>(path: string, validate?: JsonValidator<T>): Promise<JsonReadResult<T>> {
    try {
      const bytes = await this.ops.read(path);
      if (!bytes) {
        return { kind: "missing" };
      }
      return { kind: "ok", value: parseJson(bytes, validate) };
    } catch (error) {
      return { kind: "unreadable", error: toError(error) };
    }
  }

  readJson<T>(path: string, validate?: JsonValidator<T>): Promise<JsonReadResult<T>> {
    return this.enqueue(path, () => this.readJsonNow(path, validate));
  }

  writeJson(path: string, value: unknown): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(value, null, 2), "utf8");
    return this.enqueue(path, () => this.writeAtomicNow(path, bytes));
  }

  /** 在佇列內完成「讀取 → 修改 → 寫回」。檔案無法解析時拋錯且不寫入。 */
  updateJson<T>(path: string, fallback: T, update: (current: T) => T, validate?: JsonValidator<T>): Promise<T> {
    return this.enqueue(path, async () => {
      const current = await this.readJsonNow(path, validate);
      if (current.kind === "unreadable") {
        throw new JsonFileUnreadableError(path, current.error);
      }
      const next = update(current.kind === "ok" ? current.value : fallback);
      await this.writeAtomicNow(path, Buffer.from(JSON.stringify(next, null, 2), "utf8"));
      return next;
    });
  }

  readBytes(path: string): Promise<Uint8Array | undefined> {
    return this.enqueue(path, () => this.ops.read(path));
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.enqueue(path, () => this.writeAtomicNow(path, bytes));
  }

  async listBackups(backupDir: string, prefix: string): Promise<string[]> {
    const names = await this.ops.list(backupDir);
    return names
      .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(".json"))
      .sort()
      .reverse();
  }

  /**
   * 備份目前的 JSON 檔並只保留最近 keep 份。損毀的檔案不備份，內容與最新備份相同時也略過，
   * 避免重複啟動把較舊的有效備份擠掉。回傳新備份的檔名，沒有建立時回傳 undefined。
   */
  backup(path: string, backupDir: string, prefix: string, keep: number, now = new Date()): Promise<string | undefined> {
    return this.enqueue(path, async () => {
      const bytes = await this.ops.read(path);
      if (!bytes) {
        return undefined;
      }
      parseJson(bytes);

      const existing = await this.listBackups(backupDir, prefix);
      const latest = existing[0] ? await this.ops.read(`${backupDir}/${existing[0]}`) : undefined;
      if (latest && bytesEqual(latest, bytes)) {
        return undefined;
      }

      const name = `${prefix}-${backupTimestamp(now)}.json`;
      await this.writeAtomicNow(`${backupDir}/${name}`, bytes);
      for (const stale of [name, ...existing].slice(keep)) {
        await this.ops.remove(`${backupDir}/${stale}`);
      }
      return name;
    });
  }

  /** 從備份還原。還原前會把目前的檔案另存為 corrupt-*，所以損毀內容仍可人工救回。 */
  restore(path: string, backupDir: string, backupName: string, prefix: string, now = new Date()): Promise<void> {
    return this.enqueue(path, async () => {
      const backupBytes = await this.ops.read(`${backupDir}/${backupName}`);
      if (!backupBytes) {
        throw new Error(`找不到備份：${backupName}`);
      }
      parseJson(backupBytes);

      const currentBytes = await this.ops.read(path);
      if (currentBytes) {
        await this.writeAtomicNow(`${backupDir}/corrupt-${prefix}-${backupTimestamp(now)}.json`, currentBytes);
      }
      await this.writeAtomicNow(path, backupBytes);
    });
  }
}
