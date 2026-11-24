import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { searchChapterLines } from "./search";

const READ_CONCURRENCY = 8;

export interface WorkSearchMatch {
  workId: string;
  workTitle: string;
  chapterId: string;
  chapterTitle: string;
  /** 0-indexed，原文與譯文的同一行號。 */
  line: number;
  original: string;
  translation: string;
}

interface SearchTask {
  workId: string;
  workTitle: string;
  chapterId: string;
  chapterTitle: string;
  originalPath: string;
  translationPath: string;
}

/**
 * 依序讀取所有作品、所有章節的原文與譯文，逐行比對是否包含關鍵字。
 * 開啟中的文件優先讀編輯器內容，未存檔的輸入也會被搜尋到。
 */
export async function searchAllWorks(store: ProjectStore, query: string): Promise<WorkSearchMatch[]> {
  if (!query.trim()) {
    return [];
  }

  const config = await store.load();
  const tasks: SearchTask[] = [];
  for (const work of config.works) {
    for (const chapter of work.chapters) {
      tasks.push({
        workId: work.id,
        workTitle: work.title,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        originalPath: chapter.originalPath,
        translationPath: chapter.translationPath
      });
    }
  }

  const results: WorkSearchMatch[][] = new Array(tasks.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      const task = tasks[index];
      try {
        const [original, translation] = await Promise.all([
          readText(store, task.originalPath),
          readText(store, task.translationPath)
        ]);
        results[index] = searchChapterLines(original, translation, query).map((match) => ({
          workId: task.workId,
          workTitle: task.workTitle,
          chapterId: task.chapterId,
          chapterTitle: task.chapterTitle,
          ...match
        }));
      } catch (error) {
        results[index] = [];
        console.error(`[novelTranslate] 搜尋章節 ${task.chapterId} 時發生錯誤：`, error);
      }
    }
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
  return results.flat();
}

async function readText(store: ProjectStore, relativePath: string): Promise<string> {
  const uri = store.resolveUri(relativePath);
  const target = uri.toString();
  const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === target);
  if (document) {
    return document.getText();
  }

  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return "";
    }
    throw error;
  }
}
