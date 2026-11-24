import assert from "node:assert/strict";
import test from "node:test";
import { describeTextChange, shiftLineRange } from "../comments/commentRangeTracking";

test("變更完全在範圍之前時整體平移：在上方插入一行", () => {
  const range = { startLine: 10, endLine: 10 };
  // 在第 5 行末按 Enter：取代第 5 行（1 行）變成 2 行。
  const change = describeTextChange(5, 5, "\n");
  assert.deepEqual(shiftLineRange(range, change), { startLine: 11, endLine: 11 });
});

test("變更完全在範圍之前時整體平移：刪掉上方整行", () => {
  const range = { startLine: 10, endLine: 10 };
  // 選取第 3～4 行（2 行）整段刪除，取代成 1 行。
  const change = describeTextChange(3, 4, "");
  assert.deepEqual(shiftLineRange(range, change), { startLine: 9, endLine: 9 });
});

test("變更完全在範圍之後時不受影響", () => {
  const range = { startLine: 2, endLine: 2 };
  const change = describeTextChange(10, 10, "\n");
  assert.deepEqual(shiftLineRange(range, change), { startLine: 2, endLine: 2 });
});

test("在範圍所在行內打字（不跨行）不受影響", () => {
  const range = { startLine: 5, endLine: 5 };
  const change = describeTextChange(5, 5, "a");
  assert.deepEqual(shiftLineRange(range, change), { startLine: 5, endLine: 5 });
});

test("範圍所在行被直接取代時收斂到變更起點", () => {
  const range = { startLine: 5, endLine: 5 };
  // 選取第 4～6 行整段取代成 1 行。
  const change = describeTextChange(4, 6, "新內容");
  assert.deepEqual(shiftLineRange(range, change), { startLine: 4, endLine: 4 });
});

test("多行範圍：起點落在變更內、終點在變更之後", () => {
  const range = { startLine: 5, endLine: 8 };
  const change = describeTextChange(4, 6, "新內容");
  // 4~6 行（3 行）變成 1 行，delta = -2；終點 8 > 變更終點 6，平移 -2。
  assert.deepEqual(shiftLineRange(range, change), { startLine: 4, endLine: 6 });
});
