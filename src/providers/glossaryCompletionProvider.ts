import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";

export class GlossaryCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly store: ProjectStore | undefined) {}

  async provideCompletionItems(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
    if (!this.store) {
      return [];
    }

    const workId = await this.store.findWorkIdForDocumentUri(document.uri);
    if (!workId) {
      return [];
    }

    const config = await this.store.load();
    const work = config.works.find((candidate) => candidate.id === workId);
    if (!work) {
      return [];
    }

    const items: vscode.CompletionItem[] = [];
    for (const entry of work.glossary) {
      const categorySuffix = entry.category ? `（${entry.category}）` : "";
      const documentation = entry.note ? new vscode.MarkdownString(entry.note) : undefined;

      const termItem = new vscode.CompletionItem(entry.term, vscode.CompletionItemKind.Text);
      termItem.detail = `原文 → ${entry.translation}${categorySuffix}`;
      termItem.documentation = documentation;
      termItem.filterText = `${entry.term} ${entry.translation}`;
      termItem.sortText = entry.term;
      items.push(termItem);

      const translationItem = new vscode.CompletionItem(entry.translation, vscode.CompletionItemKind.Text);
      translationItem.detail = `譯文 → ${entry.term}${categorySuffix}`;
      translationItem.documentation = documentation;
      translationItem.filterText = `${entry.term} ${entry.translation}`;
      translationItem.sortText = entry.translation;
      items.push(translationItem);
    }
    return items;
  }
}
