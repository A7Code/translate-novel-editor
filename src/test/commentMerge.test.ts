import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCommentThreads } from "../comments/commentMerge";
import { CommentThreadData } from "../core/types";

function thread(id: string, relativePath: string, startLine = 0): CommentThreadData {
  return { id, relativePath, startLine, endLine: startLine, resolved: false, comments: [] };
}

test("只開啟一側時留言，不會遺失另一側的註解", () => {
  const stored = [thread("o1", "originals/w/ch01.txt"), thread("t1", "translations/w/ch01.txt")];
  const live = [thread("t1", "translations/w/ch01.txt", 3), thread("t2", "translations/w/ch01.txt", 5)];
  const merged = mergeCommentThreads(stored, live, new Set());
  assert.deepEqual(merged.map((item) => item.id), ["o1", "t1", "t2"]);
  assert.equal(merged[1].startLine, 3);
});

test("只移除明確刪除的討論串", () => {
  const stored = [thread("o1", "originals/w/ch01.txt"), thread("t1", "translations/w/ch01.txt")];
  const merged = mergeCommentThreads(stored, [], new Set(["t1"]));
  assert.deepEqual(merged.map((item) => item.id), ["o1"]);
});
