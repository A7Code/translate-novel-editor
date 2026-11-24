import * as vscode from "vscode";
import { ProjectStore } from "../core/projectStore";
import { categoryOf, isCategoryEnabled, isWorkGlossaryAutocompleteEnabled } from "./glossaryCategories";
import { findGlossaryTermMatchAt } from "./glossaryHighlight";

/** 懸停在原文裡已標示底線的詞彙表詞條時，顯示譯名、分類、備註（1.5）。 */
export class GlossaryHoverProvider implements vscode.HoverProvider {
  constructor(private readonly store: ProjectStore | undefined) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    if (!this.store) {
      return undefined;
    }

    const found = await this.store.findChapterForDocumentUri(document.uri);
    if (!found || found.relativePath !== found.chapter.originalPath) {
      return undefined;
    }

    const config = await this.store.load();
    const work = config.works.find((candidate) => candidate.id === found.workId);
    if (!work || !isWorkGlossaryAutocompleteEnabled(work)) {
      return undefined;
    }
    const glossary = work.glossary.filter((entry) => isCategoryEnabled(work, categoryOf(entry)));

    const lineText = document.lineAt(position.line).text;
    const match = findGlossaryTermMatchAt(lineText, glossary, position.character);
    if (!match) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${match.entry.term}** → ${match.entry.translation}`);
    if (match.entry.category) {
      markdown.appendMarkdown(`\n\n分類：${match.entry.category}`);
    }
    if (match.entry.note) {
      markdown.appendMarkdown(`\n\n${match.entry.note}`);
    }

    const range = new vscode.Range(position.line, match.start, position.line, match.start + match.length);
    return new vscode.Hover(markdown, range);
  }
}
