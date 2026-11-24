import assert from "node:assert/strict";
import test from "node:test";
import { GlossaryEntry } from "../core/types";
import { consistencyIssueKey, findConsistencyIssues } from "../glossary/consistencyCheck";

const entry = (id: string, term: string, translation: string): GlossaryEntry => ({ id, term, translation });

test("原文出現詞條但譯文沒有對應譯名時提示", () => {
  const glossary = [entry("term-1", "リリア", "莉莉亞")];
  const issues = findConsistencyIssues("リリアは笑った", "她笑了", glossary);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    line: 0,
    entryId: "term-1",
    term: "リリア",
    translation: "莉莉亞",
    message: "原文出現詞條「リリア」，但這行譯文沒有找到對應的譯名「莉莉亞」。"
  });
});

test("譯文有對應譯名時不提示", () => {
  const glossary = [entry("term-1", "リリア", "莉莉亞")];
  assert.deepEqual(findConsistencyIssues("リリアは笑った", "莉莉亞笑了", glossary), []);
});

test("譯文該行還是空白時不檢查（還沒翻到這裡）", () => {
  const glossary = [entry("term-1", "リリア", "莉莉亞")];
  assert.deepEqual(findConsistencyIssues("リリアは笑った", "", glossary), []);
  assert.deepEqual(findConsistencyIssues("リリアは笑った", "　", glossary), []);
});

test("同一行同一詞條出現兩次只回報一次", () => {
  const glossary = [entry("term-1", "リリア", "莉莉亞")];
  const issues = findConsistencyIssues("リリアとリリアが話した", "她們說話了", glossary);
  assert.equal(issues.length, 1);
});

test("已忽略的 (line, entryId) 不再回報", () => {
  const glossary = [entry("term-1", "リリア", "莉莉亞")];
  const ignored = new Set([consistencyIssueKey(0, "term-1")]);
  assert.deepEqual(findConsistencyIssues("リリアは笑った", "她笑了", glossary, ignored), []);
});

test("沒有詞彙表時直接回傳空陣列", () => {
  assert.deepEqual(findConsistencyIssues("リリアは笑った", "她笑了", []), []);
});

test("詞條沒有填譯名時不檢查", () => {
  const glossary = [entry("term-1", "リリア", "")];
  assert.deepEqual(findConsistencyIssues("リリアは笑った", "她笑了", glossary), []);
});
