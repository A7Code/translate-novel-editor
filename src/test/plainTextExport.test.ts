import assert from "node:assert/strict";
import test from "node:test";
import { buildPlainTextExport } from "../export/plainTextExport";

test("只有譯文：輸出標題與譯文內容，章節間以空白行分隔", () => {
  const output = buildPlainTextExport(
    [
      { title: "第一章", original: "一\n二", translation: "A\nB" },
      { title: "第二章", original: "三", translation: "C" }
    ],
    "translationOnly"
  );
  assert.equal(output, "第一章\n\nA\nB\n\n\n第二章\n\nC\n");
});

test("雙語逐行對照：原文與譯文逐行交錯", () => {
  const output = buildPlainTextExport([{ title: "第一章", original: "一\n二", translation: "A\nB" }], "bilingual");
  assert.equal(output, "第一章\n\n一\nA\n二\nB\n");
});

test("雙語逐行對照：原文與譯文行數不一致時取較長的一側，缺的一側補空字串", () => {
  const output = buildPlainTextExport(
    [{ title: "第一章", original: "一\n二\n三", translation: "A" }],
    "bilingual"
  );
  assert.equal(output, "第一章\n\n一\nA\n二\n\n三\n\n");
});

test("沒有章節時只輸出結尾換行", () => {
  assert.equal(buildPlainTextExport([], "translationOnly"), "\n");
});
