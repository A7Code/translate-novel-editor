import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { CommentThreadData } from "../core/types";
import { collectV2Segments, extractV1ParagraphElements, segmentText } from "./epubService";

export interface MovedTranslation {
  oldLine: number;
  newLine: number;
  text: string;
}

export interface UnplacedTranslation {
  oldLine: number;
  text: string;
}

export type ChapterMigrationPlan =
  | { status: "blocked"; reason: string }
  | {
      status: "unchanged" | "changed";
      newOriginal: string;
      newTranslation: string;
      /** 舊行號（索引）→ 新行號，供註解位置轉換。 */
      lineMap: number[];
      /** 整段譯文被放到第一個子段落，需要人工拆分。 */
      needsReview: MovedTranslation[];
      /** 子段落已有不同譯文，無法自動放置；內容保留在備份與報告中。 */
      unplaced: UnplacedTranslation[];
    };

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines;
}

function isInside(node: AnyNode, ancestor: Element): boolean {
  for (let current: AnyNode | null = node; current; current = current.parent as AnyNode | null) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

/** 計算章節從 v1 升級到 v2 的結果。純函式，不寫入任何檔案。 */
export function planChapterMigration(html: string, originalText: string, translationText: string): ChapterMigrationPlan {
  const $ = cheerio.load(html, { xmlMode: true });
  const v1Elements = extractV1ParagraphElements($);
  const v1Texts = v1Elements.map((el) => $(el).text().trim().replace(/\s+/g, " "));

  // 原文若被手動改過，舊行號就不再對應 EPUB 段落，自動搬移可能把譯文放錯位置。
  const originalLines = splitLines(originalText);
  if (originalLines.length !== v1Texts.length || originalLines.some((line, index) => line !== v1Texts[index])) {
    return { status: "blocked", reason: "原文與 EPUB 內容不一致（可能曾手動修改原文）" };
  }

  const segments = collectV2Segments($);
  const newTexts = segments.map(segmentText);
  const translationLines = splitLines(translationText);
  const output = new Array<string>(segments.length).fill("");
  const leafIndex = new Map<AnyNode, number>();
  segments.forEach((segment, index) => {
    if (!segment.isInlineRun) {
      leafIndex.set(segment.nodes[0], index);
    }
  });

  const segmentsInside = (el: Element): number[] =>
    segments.flatMap((segment, index) => (isInside(segment.nodes[0], el) ? [index] : []));

  v1Elements.forEach((el, line) => {
    const index = leafIndex.get(el);
    if (index !== undefined) {
      output[index] = translationLines[line] ?? "";
    }
  });

  const needsReview: MovedTranslation[] = [];
  const unplaced: UnplacedTranslation[] = [];

  // 由內往外處理容器，外層才能看到內層已放入的譯文。
  for (let line = v1Elements.length - 1; line >= 0; line--) {
    const el = v1Elements[line];
    const text = translationLines[line]?.trim();
    if (!text || leafIndex.has(el)) {
      continue;
    }
    const inside = segmentsInside(el);
    if (inside.length === 0) {
      unplaced.push({ oldLine: line, text });
    } else if (inside.every((index) => !output[index].trim())) {
      output[inside[0]] = text;
      if (inside.length > 1) {
        needsReview.push({ oldLine: line, newLine: inside[0], text });
      }
    } else if (compact(inside.map((index) => output[index]).join("")) !== compact(text)) {
      unplaced.push({ oldLine: line, text });
    }
  }
  needsReview.reverse();
  unplaced.reverse();

  const lineMap: number[] = [];
  let previous = 0;
  v1Elements.forEach((el, line) => {
    const direct = leafIndex.get(el);
    const mapped = direct ?? segmentsInside(el)[0] ?? previous;
    lineMap[line] = mapped;
    previous = mapped;
  });

  // 超出原文行數的譯文從未被匯出，但仍是使用者的內容，接在最後保留。
  const finalLines = [...output];
  for (let line = v1Elements.length; line < translationLines.length; line++) {
    if (translationLines[line].trim()) {
      lineMap[line] = finalLines.length;
      finalLines.push(translationLines[line]);
    } else {
      lineMap[line] = Math.max(finalLines.length - 1, 0);
    }
  }

  const newOriginal = newTexts.join("\n");
  const newTranslation = splitLines(finalLines.join("\n")).join("\n");
  const isIdentity =
    newTexts.length === v1Texts.length &&
    newTexts.every((text, index) => text === v1Texts[index]) &&
    lineMap.every((mapped, index) => mapped === index);

  return {
    status: isIdentity ? "unchanged" : "changed",
    newOriginal,
    newTranslation,
    lineMap,
    needsReview,
    unplaced
  };
}

/** 依行號對應表更新註解位置，超出範圍的行會對應到最後一行。 */
export function remapCommentThreads(threads: CommentThreadData[], lineMap: number[]): CommentThreadData[] {
  const lastMapped = lineMap.length > 0 ? Math.max(...lineMap) : 0;
  const mapLine = (line: number): number => lineMap[line] ?? lastMapped;
  return threads.map((thread) => {
    const startLine = mapLine(thread.startLine);
    return { ...thread, startLine, endLine: Math.max(startLine, mapLine(thread.endLine)) };
  });
}
