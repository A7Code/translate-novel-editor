import assert from "node:assert/strict";
import test from "node:test";
import { findGlossaryTermMatchAt, findGlossaryTermMatches } from "../glossary/glossaryHighlight";
import { GlossaryEntry } from "../core/types";

const entry = (term: string, translation: string): GlossaryEntry => ({
  id: term,
  term,
  translation
});

test("找出一行中所有命中詞彙表的區段", () => {
  const glossary = [entry("リリア", "莉莉亞"), entry("剣", "劍")];
  const matches = findGlossaryTermMatches("リリアは剣を抜いた", glossary);
  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((match) => [match.entry.term, match.start, match.length]),
    [
      ["リリア", 0, 3],
      ["剣", 4, 1]
    ]
  );
});

test("重疊詞條時優先取同起點最長的命中", () => {
  const glossary = [entry("リリア", "莉莉亞"), entry("リリアナ", "莉莉亞娜")];
  const matches = findGlossaryTermMatches("リリアナが来た", glossary);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entry.term, "リリアナ");
});

test("已命中的區段不會再被後面的詞條重複標示", () => {
  const glossary = [entry("剣士", "劍士"), entry("士", "士")];
  const matches = findGlossaryTermMatches("剣士として", glossary);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entry.term, "剣士");
});

test("沒有命中時回傳空陣列", () => {
  assert.deepEqual(findGlossaryTermMatches("何もない文章", [entry("リリア", "莉莉亞")]), []);
});

test("findGlossaryTermMatchAt 找出覆蓋指定字元位置的命中", () => {
  const glossary = [entry("リリア", "莉莉亞"), entry("剣", "劍")];
  const lineText = "リリアは剣を抜いた";
  assert.equal(findGlossaryTermMatchAt(lineText, glossary, 1)?.entry.term, "リリア");
  assert.equal(findGlossaryTermMatchAt(lineText, glossary, 4)?.entry.term, "剣");
  assert.equal(findGlossaryTermMatchAt(lineText, glossary, 3), undefined);
});
