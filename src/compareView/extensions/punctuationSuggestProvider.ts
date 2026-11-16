import * as vscode from "vscode";
import { CompareView } from "../compareView";
import {
  PUNCTUATION_SUGGEST_ENABLED_SETTING_KEY,
  PUNCTUATION_SUGGEST_TRIGGER_TEXT_SETTING_KEY
} from "../../core/constants";

// 預設觸發文字：反引號在小說正文裡幾乎不會用到，且單一按鍵就能輸入，不容易跟
// 使用者實際翻譯的內容搞混。使用者可以在設定裡改成其他文字。
const DEFAULT_TRIGGER_TEXT = "`";

export function getPunctuationSuggestTriggerText(): string {
  const configured = vscode.workspace
    .getConfiguration()
    .get<string>(PUNCTUATION_SUGGEST_TRIGGER_TEXT_SETTING_KEY, DEFAULT_TRIGGER_TEXT);
  return configured.length > 0 ? configured : DEFAULT_TRIGGER_TEXT;
}

// 取出一行文字裡全部的標點符號，去除重複後依字元碼位做簡單排序，
// 讓同一組標點符號每次顯示的順序都一致。
export function extractUniquePunctuation(lineText: string): string[] {
  const matches = lineText.match(/\p{P}/gu) ?? [];
  return Array.from(new Set(matches)).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}

// 在「譯文」工作區某一行輸入設定好的觸發文字時，到目前比對中「原文」工作區的同一行
// 找出全部標點符號，去重、簡單排序後透過自動完成清單推薦出來，方便使用者直接選用跟
// 原文一致的標點，不必自己對照原文逐字尋找。
export class PunctuationSuggestCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly compareView: CompareView) {}

  // VS Code 在編輯器還沒就緒、分頁正在開啟／還原的過渡狀態下也會呼叫 provider（這不是我們
  // 自己的 EventEmitter，是 VS Code 自己觸發的），跟 CompareView.runSafely() 與
  // cursorSyncExtension／scrollSyncExtension 裡對 TextEditor/TextDocument 的操作一樣，
  // 都要接住例外，不能讓它直接從這裡往外丟，波及 Extension Host 的穩定性。
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionList {
    try {
      return this.doProvideCompletionItems(document, position);
    } catch (error) {
      console.error("[novelTranslate] 推薦原文標點符號時發生未預期的錯誤：", error);
      return new vscode.CompletionList([], false);
    }
  }

  private doProvideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionList {
    const enabled = vscode.workspace.getConfiguration().get<boolean>(PUNCTUATION_SUGGEST_ENABLED_SETTING_KEY, true);
    if (!enabled || this.compareView.sideOf(document.uri) !== "translation") {
      return new vscode.CompletionList([], false);
    }

    const triggerText = getPunctuationSuggestTriggerText();
    const lineStart = new vscode.Position(position.line, 0);
    const linePrefix = document.getText(new vscode.Range(lineStart, position));
    if (triggerText.length === 0 || !linePrefix.endsWith(triggerText)) {
      return new vscode.CompletionList([], false);
    }

    const punctuations = this.punctuationOnCorrespondingOriginalLine(position.line);
    if (punctuations.length === 0) {
      return new vscode.CompletionList([], false);
    }

    // 補完項目要把剛才打的觸發文字整段替換成選到的標點符號，而不是接在後面。
    const range = new vscode.Range(position.translate(0, -triggerText.length), position);
    const items = punctuations.map((mark, index) => {
      const item = new vscode.CompletionItem(mark, vscode.CompletionItemKind.Operator);
      item.detail = "原文同一行的標點符號";
      item.insertText = mark;
      item.range = range;
      item.filterText = triggerText;
      item.sortText = String(index).padStart(3, "0");
      return item;
    });

    return new vscode.CompletionList(items, true);
  }

  private punctuationOnCorrespondingOriginalLine(line: number): string[] {
    const pair = this.compareView.currentPair;
    if (!pair) {
      return [];
    }
    const originalDocument = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === pair.originalUri.toString()
    );
    if (!originalDocument) {
      return [];
    }
    const clampedLine = Math.min(line, Math.max(originalDocument.lineCount - 1, 0));
    return extractUniquePunctuation(originalDocument.lineAt(clampedLine).text);
  }
}
