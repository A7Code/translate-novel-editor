import assert from "node:assert/strict";
import test from "node:test";
import {
  computeChapterProgress,
  findFirstIncompleteChapter,
  summarizeWorkProgress
} from "../translation/progress";

const lines = (count: number, text = "字") => Array.from({ length: count }, () => text).join("\n");

test("空白行與全形空白不計入，只有標點的行要翻譯", () => {
  const progress = computeChapterProgress("一\n\n　\n  \n……", "A\n\n\n\n");
  assert.equal(progress.totalLines, 2);
  assert.equal(progress.translatedLines, 1);
  assert.equal(progress.percent, 50);
  assert.equal(progress.status, "inProgress");
});

test("譯文只有全形空白不算已翻", () => {
  const progress = computeChapterProgress("一", "　");
  assert.equal(progress.translatedLines, 0);
  assert.equal(progress.status, "notStarted");
});

test("百分比無條件捨去，全部翻完才是 100%", () => {
  const almost = computeChapterProgress(lines(320), `${lines(319, "譯")}\n`);
  assert.equal(almost.translatedLines, 319);
  assert.equal(almost.percent, 99);
  assert.equal(almost.status, "inProgress");

  const done = computeChapterProgress(lines(320), lines(320, "譯"));
  assert.equal(done.percent, 100);
  assert.equal(done.status, "done");
});

test("多餘譯文行不會讓進度超過 100%", () => {
  const progress = computeChapterProgress("一\n\n二", "A\nB\nC\nD");
  assert.equal(progress.translatedLines, 2);
  assert.equal(progress.extraTranslationLines, 2);
  assert.equal(progress.percent, 100);
  assert.equal(progress.status, "done");
});

test("支援 CRLF 與 CR 換行，原文和譯文可混用", () => {
  const progress = computeChapterProgress("一\r\n二\r\n三", "A\nB\rC");
  assert.equal(progress.totalLines, 3);
  assert.equal(progress.translatedLines, 3);
  assert.equal(progress.extraTranslationLines, 0);
});

test("沒有原文時狀態為 empty，百分比為 null", () => {
  const progress = computeChapterProgress("\n　\n", "多的譯文");
  assert.equal(progress.status, "empty");
  assert.equal(progress.percent, null);
  assert.equal(progress.extraTranslationLines, 1);
});

test("作品進度以行數加總，不平均各章百分比，且排除無原文章節", () => {
  const short = computeChapterProgress("一", "A");
  const long = computeChapterProgress(lines(99), "");
  const empty = computeChapterProgress("", "");
  const summary = summarizeWorkProgress([short, long, empty]);
  assert.equal(summary.totalLines, 100);
  assert.equal(summary.translatedLines, 1);
  assert.equal(summary.percent, 1);
  assert.equal(summary.doneChapters, 1);
  assert.equal(summary.countedChapters, 2);
});

test("沒有章節的作品百分比為 null", () => {
  assert.equal(summarizeWorkProgress([]).percent, null);
});

test("繼續翻譯會略過已完成與無原文的章節", () => {
  const progressById = {
    a: computeChapterProgress("一", "A"),
    b: computeChapterProgress("", ""),
    c: computeChapterProgress("一\n二", "A"),
    d: computeChapterProgress("一", "")
  };
  assert.equal(findFirstIncompleteChapter(["a", "b", "c", "d"], progressById), "c");
  assert.equal(findFirstIncompleteChapter(["a", "b"], progressById), undefined);
});
