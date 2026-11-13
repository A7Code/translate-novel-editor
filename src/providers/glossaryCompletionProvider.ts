import * as vscode from "vscode";
import { ProjectStore } from "../services/projectStore";

export class GlossaryCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly store: ProjectStore | undefined) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionList> {
    if (!this.store) {
      return new vscode.CompletionList([], false);
    }

    const workId = await this.store.findWorkIdForDocumentUri(document.uri);
    if (!workId) {
      return new vscode.CompletionList([], false);
    }

    const config = await this.store.load();
    const work = config.works.find((candidate) => candidate.id === workId);
    if (!work) {
      return new vscode.CompletionList([], false);
    }

    // VS Code 預設的單字邊界判定不會把連續中文切開，導致候選詞的比對前綴
    // 動輒變成一整段文字而永遠比對不到。這裡改用「游標前最後幾個字」自行比對，
    // 不依賴編輯器的單字邊界，每個 CompletionItem 也附上明確的 range/filterText。
    const maxLookback = work.glossary.reduce(
      (max, entry) => Math.max(max, entry.term.length, entry.translation.length),
      0
    );
    if (maxLookback === 0) {
      return new vscode.CompletionList([], false);
    }

    const lineStart = new vscode.Position(position.line, 0);
    const linePrefix = document.getText(new vscode.Range(lineStart, position));
    const lookback = linePrefix.slice(-maxLookback);

    const items: vscode.CompletionItem[] = [];
    const addItem = (candidate: string, directionLabel: string, counterpart: string, categorySuffix: string, documentation?: vscode.MarkdownString) => {
      const overlap = GlossaryCompletionProvider.longestMatchingSuffix(lookback, candidate);
      if (overlap === 0) {
        return;
      }
      const item = new vscode.CompletionItem(candidate, vscode.CompletionItemKind.Text);
      item.detail = `${directionLabel} → ${counterpart}${categorySuffix}`;
      item.documentation = documentation;
      item.range = new vscode.Range(position.translate(0, -overlap), position);
      item.filterText = lookback.slice(-overlap);
      item.sortText = candidate;
      items.push(item);
    };

    for (const entry of work.glossary) {
      const categorySuffix = entry.category ? `（${entry.category}）` : "";
      const documentation = entry.note ? new vscode.MarkdownString(entry.note) : undefined;
      addItem(entry.term, "原文", entry.translation, categorySuffix, documentation);
      addItem(entry.translation, "譯文", entry.term, categorySuffix, documentation);
    }

    // isIncomplete = true：強制編輯器每次按鍵都重新呼叫這個 provider，
    // 而不是用上一次回傳的（可能已經過期的）清單在本地端重新篩選。
    return new vscode.CompletionList(items, true);
  }

  private static longestMatchingSuffix(lookback: string, candidate: string): number {
    const maxLen = Math.min(lookback.length, candidate.length);
    for (let len = maxLen; len >= 1; len--) {
      if (candidate.startsWith(lookback.slice(-len))) {
        return len;
      }
    }
    return 0;
  }
}
