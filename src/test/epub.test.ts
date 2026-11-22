import * as cheerio from "cheerio";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CommentThreadData } from "../core/types";
import { planChapterMigration, remapCommentThreads } from "../epub/epubMigration";
import { applyTranslationToChapterHtml, extractParagraphTexts } from "../epub/epubService";

const page = (body: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`;

function changedPlan(html: string, translation: string) {
  const original = extractParagraphTexts(html, 1).join("\n");
  const plan = planChapterMigration(html, original, translation);
  assert.notEqual(plan.status, "blocked");
  if (plan.status === "blocked") {
    throw new Error("unexpected");
  }
  return plan;
}

test("v2 只抽取最內層段落", () => {
  const html = page("<blockquote><p>A</p><p>B</p></blockquote><p>C</p>");
  assert.deepEqual(extractParagraphTexts(html, 1), ["AB", "A", "B", "C"]);
  assert.deepEqual(extractParagraphTexts(html, 2), ["A", "B", "C"]);
});

test("v2 排除振假名", () => {
  const html = page("<p><ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>を読む</p>");
  assert.deepEqual(extractParagraphTexts(html, 1), ["漢字(かんじ)を読む"]);
  assert.deepEqual(extractParagraphTexts(html, 2), ["漢字を読む"]);
});

test("v2 保留容器的直屬文字，回填時不破壞子清單", () => {
  const html = page("<ul><li>項目<ul><li>子項</li></ul>結尾</li></ul>");
  assert.deepEqual(extractParagraphTexts(html, 2), ["項目", "子項", "結尾"]);
  const output = applyTranslationToChapterHtml(html, "Item <1>\nChild\nEnd", 2);
  assert.deepEqual(extractParagraphTexts(output, 2), ["Item <1>", "Child", "End"]);
  assert.match(output, /Item &lt;1&gt;/);
});

test("v2 匯出時每段譯文都存在，未翻的行保留原文", () => {
  const html = page("<blockquote><p>A</p><p>B</p></blockquote><ol><li>C</li></ol><p><ruby>漢<rt>かん</rt></ruby>D</p>");
  const output = applyTranslationToChapterHtml(html, "甲\n\n丙\n丁", 2);
  assert.deepEqual(extractParagraphTexts(output, 2), ["甲", "B", "丙", "丁"]);
});

test("v1 回填行為維持不變", () => {
  const html = page("<blockquote><p>A</p></blockquote>");
  const output = applyTranslationToChapterHtml(html, "外層\n內層", 1);
  const $ = cheerio.load(output, { xmlMode: true });
  assert.equal($("blockquote").text(), "外層");
  assert.equal($("p").length, 0);
});

test("遷移會把子段落的譯文對到新行號", () => {
  const html = page("<p>前</p><blockquote><p>A</p><p>B</p></blockquote><p>後</p>");
  const plan = changedPlan(html, "譯前\n\n譯A\n譯B\n譯後");
  assert.equal(plan.status, "changed");
  assert.equal(plan.newOriginal, "前\nA\nB\n後");
  assert.equal(plan.newTranslation, "譯前\n譯A\n譯B\n譯後");
  assert.deepEqual(plan.lineMap, [0, 1, 1, 2, 3]);
  assert.equal(plan.unplaced.length, 0);
});

test("只翻在容器行的譯文會保留並標記需要拆分", () => {
  const html = page("<blockquote><p>A</p><p>B</p></blockquote>");
  const plan = changedPlan(html, "整段譯文");
  assert.equal(plan.newTranslation, "整段譯文");
  assert.equal(plan.needsReview.length, 1);
});

test("容器與子段落譯文衝突時列為未放置，相同內容則不報告", () => {
  const html = page("<blockquote><p>A</p><p>B</p></blockquote>");
  assert.equal(changedPlan(html, "不同的譯文\n譯A\n譯B").unplaced.length, 1);
  assert.equal(changedPlan(html, "譯A譯B\n譯A\n譯B").unplaced.length, 0);
});

test("超出原文行數的譯文不會遺失", () => {
  const html = page("<blockquote><p>A</p></blockquote>");
  const plan = changedPlan(html, "\n譯A\n多出來的行");
  assert.equal(plan.newTranslation, "譯A\n多出來的行");
});

test("原文被手動修改時拒絕遷移", () => {
  const html = page("<p>A</p><p>B</p>");
  assert.equal(planChapterMigration(html, "A\n改過", "").status, "blocked");
});

test("沒有結構差異的章節標記為不變", () => {
  const html = page("<p>A</p><p>B</p>");
  assert.equal(changedPlan(html, "甲\n乙").status, "unchanged");
});

test("註解位置跟著行號對應表移動", () => {
  const threads: CommentThreadData[] = [
    { id: "x", relativePath: "translations/w/ch01.txt", startLine: 2, endLine: 4, resolved: false, comments: [] }
  ];
  assert.deepEqual(remapCommentThreads(threads, [0, 1, 1, 2, 3]).map((t) => [t.startLine, t.endLine]), [[1, 3]]);
});
