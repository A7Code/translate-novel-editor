import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";

export class GlossaryCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly store: ProjectStore | undefined) {}

  async provideCompletionItems(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
    if (!this.store) {
      return [];
    }

    const found = await this.store.findChapterByTranslationUri(document.uri);
    if (!found) {
      return [];
    }

    const config = await this.store.load();
    const work = config.works.find((candidate) => candidate.id === found.workId);
    if (!work) {
      return [];
    }

    return work.glossary.map((entry) => {
      const item = new vscode.CompletionItem(entry.translation, vscode.CompletionItemKind.Text);
      item.detail = entry.category ? `${entry.term}（${entry.category}）` : entry.term;
      item.documentation = entry.note ? new vscode.MarkdownString(entry.note) : undefined;
      item.filterText = `${entry.term} ${entry.translation}`;
      item.sortText = entry.term;
      return item;
    });
  }
}
