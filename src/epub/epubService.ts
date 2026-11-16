import * as cheerio from "cheerio";
import JSZip from "jszip";
import { posix as posixPath } from "node:path";

const PARAGRAPH_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, li";

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

export function extractParagraphTexts(html: string): string[] {
  const $ = cheerio.load(html, { xmlMode: true });
  return extractParagraphElements($).map((el) => $(el).text().trim().replace(/\s+/g, " "));
}

/** 用譯文純文字（一行對一段）取代 html 裡每個段落的文字內容，其餘標籤結構原樣保留。 */
export function applyTranslationToChapterHtml(html: string, translationText: string): string {
  const $ = cheerio.load(html, { xmlMode: true });
  const paragraphs = extractParagraphElements($);
  const lines = translationText.split(/\r?\n/);

  paragraphs.forEach((el, index) => {
    const line = lines[index]?.trim();
    if (line) {
      $(el).text(line);
    }
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

function extractParagraphElements($: cheerio.CheerioAPI) {
  return $.root()
    .find(PARAGRAPH_SELECTOR)
    .filter((_, el) => $(el).text().trim().length > 0)
    .toArray();
}

function extractChapterTitle(html: string): string | undefined {
  const $ = cheerio.load(html, { xmlMode: true });
  const fromTitleTag = $("title").first().text().trim();
  if (fromTitleTag) {
    return fromTitleTag;
  }
  const fromHeading = $("h1, h2, h3").first().text().trim();
  return fromHeading || undefined;
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
