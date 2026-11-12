import * as vscode from "vscode";

export class CompareScrollSync implements vscode.Disposable {
  private originalUri: string | undefined;
  private translationUri: string | undefined;
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.subscription = vscode.window.onDidChangeTextEditorVisibleRanges((event) => this.handleChange(event));
  }

  setPair(originalUri: vscode.Uri, translationUri: vscode.Uri): void {
    this.originalUri = originalUri.toString();
    this.translationUri = translationUri.toString();
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private handleChange(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    if (!this.originalUri || !this.translationUri) {
      return;
    }

    const sourceUri = event.textEditor.document.uri.toString();
    const targetUri =
      sourceUri === this.originalUri
        ? this.translationUri
        : sourceUri === this.translationUri
          ? this.originalUri
          : undefined;
    if (!targetUri) {
      return;
    }

    const topLine = event.visibleRanges[0]?.start.line;
    if (topLine === undefined) {
      return;
    }

    const targetEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === targetUri
    );
    if (!targetEditor) {
      return;
    }

    if (targetEditor.visibleRanges[0]?.start.line === topLine) {
      return;
    }

    const clampedLine = Math.min(topLine, Math.max(targetEditor.document.lineCount - 1, 0));
    targetEditor.revealRange(new vscode.Range(clampedLine, 0, clampedLine, 0), vscode.TextEditorRevealType.AtTop);
  }
}
