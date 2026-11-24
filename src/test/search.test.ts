import assert from "node:assert/strict";
import test from "node:test";
import { searchChapterLines } from "../search/search";

test("原文命中時回傳該行的原文與譯文", () => {
  const matches = searchChapterLines("リリアは笑った\n彼は頷いた", "莉莉亞笑了\n他點頭", "リリア");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0], { line: 0, original: "リリアは笑った", translation: "莉莉亞笑了" });
});

test("譯文命中也算這一行命中", () => {
  const matches = searchChapterLines("一\n二", "A\n莉莉亞", "莉莉亞");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].line, 1);
});

test("不分大小寫", () => {
  const matches = searchChapterLines("Hello world", "你好世界", "HELLO");
  assert.equal(matches.length, 1);
});

test("關鍵字前後空白會被忽略，空白關鍵字不回傳任何結果", () => {
  const matches = searchChapterLines("リリア", "莉莉亞", "  リリア  ");
  assert.equal(matches.length, 1);
  assert.deepEqual(searchChapterLines("一", "A", "   "), []);
});

test("原文與譯文行數不一致時仍依最長一側逐行比對", () => {
  const matches = searchChapterLines("一", "A\nB\n莉莉亞", "莉莉亞");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0], { line: 2, original: "", translation: "莉莉亞" });
});

test("沒有任何一行命中時回傳空陣列", () => {
  assert.deepEqual(searchChapterLines("一\n二", "A\nB", "不存在"), []);
});
