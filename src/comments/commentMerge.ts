import { CommentThreadData } from "../core/types";

export function isCommentThreadList(value: unknown): value is CommentThreadData[] {
  return Array.isArray(value);
}

/**
 * 把記憶體中開啟的討論串合併回檔案內容。以討論串 id 為單位更新，只有明確刪除的才移除，
 * 所以目前沒開啟那一側（或尚未載入）的註解都會保留。
 */
export function mergeCommentThreads(
  stored: CommentThreadData[],
  live: CommentThreadData[],
  deletedIds: ReadonlySet<string>
): CommentThreadData[] {
  const liveById = new Map(live.map((thread) => [thread.id, thread]));
  const merged = stored
    .filter((thread) => !deletedIds.has(thread.id))
    .map((thread) => liveById.get(thread.id) ?? thread);
  const storedIds = new Set(stored.map((thread) => thread.id));
  for (const thread of live) {
    if (!storedIds.has(thread.id) && !deletedIds.has(thread.id)) {
      merged.push(thread);
    }
  }
  return merged;
}
