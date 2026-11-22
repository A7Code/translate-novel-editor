import * as cheerio from "cheerio";
import JSZip from "jszip";
import { posix as posixPath } from "node:path";
import type { AnyNode, Element, Text } from "domhandler";
import type { EpubExtractVersion } from "../core/types";

const PARAGRAPH_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, li";
const PARAGRAPH_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li"]);
const RUBY_ANNOTATION_TAGS = new Set(["rt", "rp", "rtc"]);

export const CURRENT_EPUB_EXTRACT_VERSION: EpubExtractVersion = 2;

/** v2 的一個可翻譯片段，對應譯文的一行。 */
export interface EpubSegment {
  nodes: AnyNode[];
  /** true 表示這是容器內的直屬文字，回填時替換這些節點，而不是整個元素。 */
  isInlineRun: boolean;
}

export interface ParsedEpubChapter {
  title: string;
  /** 在解壓後的 package 目錄底下的相對路徑，對應 ChapterConfig.epubContentPath。 */
  contentPath: string;
  html: string;
}

export interface ParsedEpub {
  title?: string;
  author?: string;
  language?: string;
  /** package 目錄底下的相對路徑。 */
  opfPath: string;
  chapters: ParsedEpubChapter[];
  /** EPUB 內所有檔案（含章節 XHTML），相對路徑 → 原始位元組，供原封不動存檔與之後重新打包。 */
  files: Map<string, Uint8Array>;
}

export async function parseEpub(bytes: Uint8Array): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(bytes);
  const files = new Map<string, Uint8Array>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      continue;
    }
    files.set(entry.name, await entry.async("uint8array"));
  }

  const containerXml = readText(files, "META-INF/container.xml");
  const $container = cheerio.load(containerXml, { xmlMode: true });
  const opfPath = $container("rootfile").attr("full-path");
  if (!opfPath) {
    throw new Error("找不到 content.opf（META-INF/container.xml 格式不正確）");
  }

  const opfXml = readText(files, opfPath);
  const $opf = cheerio.load(opfXml, { xmlMode: true });
  const opfDir = posixPath.dirname(opfPath);

  const manifest = new Map<string, { href: string; mediaType: string }>();
  $opf("manifest > item").each((_, el) => {
    const id = $opf(el).attr("id");
    const href = $opf(el).attr("href");
    const mediaType = $opf(el).attr("media-type") ?? "";
    if (id && href) {
      manifest.set(id, { href: decodeURIComponent(href), mediaType });
    }
  });

  const spineIds: string[] = [];
  $opf("spine > itemref").each((_, el) => {
    const idref = $opf(el).attr("idref");
    if (idref) {
      spineIds.push(idref);
    }
  });

  const chapters: ParsedEpubChapter[] = [];
  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item || !/html/i.test(item.mediaType)) {
      continue;
    }
    const contentPath = posixPath.join(opfDir, item.href);
    const html = readText(files, contentPath);
    const title = extractChapterTitle(html) ?? `第 ${chapters.length + 1} 章`;
    chapters.push({ title, contentPath, html });
  }

  if (chapters.length === 0) {
    throw new Error("在 EPUB 的 spine 裡找不到任何 HTML 章節內容");
  }

  return {
    title: firstMetaText($opf, "title"),
    author: firstMetaText($opf, "creator"),
    language: firstMetaText($opf, "language"),
    opfPath,
    chapters,
    files
  };
}

/**
 * 依抽取規則版本取出段落文字。
 * - v1：舊規則，巢狀段落會重複、振假名會混入。只留給尚未升級的章節，確保行號不變。
 * - v2：只取最內層區塊，排除振假名；容器的直屬文字會成為獨立段落。
 */
export function extractParagraphTexts(html: string, version: EpubExtractVersion): string[] {
  const $ = cheerio.load(html, { xmlMode: true });
  if (version === 1) {
    return extractV1ParagraphElements($).map((el) => normalizeText($(el).text()));
  }
  return collectV2Segments($).map(segmentText);
}

/** 用譯文純文字（一行對一段）取代 html 裡每個段落的文字內容，其餘標籤結構原樣保留。 */
export function applyTranslationToChapterHtml(
  html: string,
  translationText: string,
  version: EpubExtractVersion
): string {
  const $ = cheerio.load(html, { xmlMode: true });
  const lines = translationText.split(/\r?\n/);

  if (version === 1) {
    extractV1ParagraphElements($).forEach((el, index) => {
      const line = lines[index]?.trim();
      if (line) {
        $(el).text(line);
      }
    });
    return $.html();
  }

  collectV2Segments($).forEach((segment, index) => {
    const line = lines[index]?.trim();
    if (!line) {
      return;
    }
    if (!segment.isInlineRun) {
      $(segment.nodes[0]).text(line);
      return;
    }
    const [first, ...rest] = segment.nodes;
    $(first).replaceWith($("<span/>").text(line).contents());
    rest.forEach((node) => $(node).remove());
  });
  return $.html();
}

/** 以 baseFiles 為底，用 overrides 覆寫指定路徑的內容，重新打包成 .epub 位元組。 */
export async function buildEpubZip(
  baseFiles: Map<string, Uint8Array>,
  overrides: Map<string, string>
): Promise<Uint8Array> {
  const zip = new JSZip();

  const mimetypeBytes = baseFiles.get("mimetype");
  if (mimetypeBytes) {
    zip.file("mimetype", mimetypeBytes, { compression: "STORE" });
  }

  for (const [path, bytes] of baseFiles) {
    if (path === "mimetype" || overrides.has(path)) {
      continue;
    }
    zip.file(path, bytes);
  }
  for (const [path, content] of overrides) {
    zip.file(path, content);
  }

  return zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip" });
}

export function extractV1ParagraphElements($: cheerio.CheerioAPI): Element[] {
  return $.root()
    .find(PARAGRAPH_SELECTOR)
    .filter((_, el) => $(el).text().trim().length > 0)
    .toArray();
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function isParagraphElement(node: AnyNode): node is Element {
  return isElement(node) && PARAGRAPH_TAGS.has(node.name.toLowerCase());
}

/** 取得讀者看到的本文，排除 ruby 的讀音標註與註解節點。 */
function visibleText(node: AnyNode): string {
  if (node.type === "text") {
    return (node as Text).data;
  }
  if (isElement(node) && RUBY_ANNOTATION_TAGS.has(node.name.toLowerCase())) {
    return "";
  }
  if (isElement(node) || node.type === "cdata") {
    return (node as Element).children.map(visibleText).join("");
  }
  return "";
}

export function segmentText(segment: EpubSegment): string {
  return normalizeText(segment.nodes.map(visibleText).join(""));
}

/**
 * 依文件順序收集可翻譯片段。內含其他段落的容器不直接抽取，但容器的直屬文字
 * （例如 <li>項目<ul>…</ul></li> 的「項目」）會成為獨立片段，避免只取最內層時漏翻。
 */
export function collectV2Segments($: cheerio.CheerioAPI): EpubSegment[] {
  const containsParagraph = new Map<AnyNode, boolean>();
  const hasParagraphDescendant = (node: AnyNode): boolean => {
    if (!isElement(node)) {
      return false;
    }
    let result = containsParagraph.get(node);
    if (result === undefined) {
      result = node.children.some((child) => isParagraphElement(child) || hasParagraphDescendant(child));
      containsParagraph.set(node, result);
    }
    return result;
  };

  const segments: EpubSegment[] = [];
  const walk = (children: AnyNode[], insideParagraph: boolean): void => {
    let run: AnyNode[] = [];
    const flushRun = (): void => {
      const start = run.findIndex((node) => visibleText(node).trim().length > 0);
      if (insideParagraph && start >= 0) {
        const end = run.length - [...run].reverse().findIndex((node) => visibleText(node).trim().length > 0);
        segments.push({ nodes: run.slice(start, end), isInlineRun: true });
      }
      run = [];
    };

    for (const child of children) {
      if (hasParagraphDescendant(child)) {
        flushRun();
        walk((child as Element).children, insideParagraph || isParagraphElement(child));
      } else if (isParagraphElement(child)) {
        flushRun();
        const segment: EpubSegment = { nodes: [child], isInlineRun: false };
        if (segmentText(segment)) {
          segments.push(segment);
        }
      } else {
        run.push(child);
      }
    }
    flushRun();
  };

  walk($.root()[0].children as AnyNode[], false);
  return segments;
}

function extractChapterTitle(html: string): string | undefined {
  const $ = cheerio.load(html, { xmlMode: true });
  const fromTitleTag = $("title").first().text().trim();
  if (fromTitleTag) {
    return fromTitleTag;
  }
  const heading = $("h1, h2, h3").first()[0];
  return heading ? normalizeText(visibleText(heading)) || undefined : undefined;
}

function firstMetaText($opf: cheerio.CheerioAPI, localName: string): string | undefined {
  let result: string | undefined;
  $opf("metadata")
    .children()
    .each((_, el) => {
      if (result) {
        return;
      }
      const tagName = el.tagName?.toLowerCase() ?? "";
      if (tagName === localName || tagName.endsWith(`:${localName}`)) {
        const text = $opf(el).text().trim();
        if (text) {
          result = text;
        }
      }
    });
  return result;
}

function readText(files: Map<string, Uint8Array>, relativePath: string): string {
  const bytes = files.get(relativePath) ?? files.get(relativePath.replace(/^\//, ""));
  if (!bytes) {
    throw new Error(`EPUB 裡找不到檔案：${relativePath}`);
  }
  return Buffer.from(bytes).toString("utf8");
}
