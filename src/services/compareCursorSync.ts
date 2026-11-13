import * as vscode from "vscode";

// 控制比對畫面是否要把其中一側的游標行同步到另一側的設定鍵，預設開啟。
export const CURSOR_SYNC_ENABLED_SETTING_KEY = "novelTranslate.compareCursorSync.enabled";

// VS Code 本身就會把非焦點編輯器的目前行用較淡的樣式標示，即使該編輯器已失焦也會保留，
// 所以這裡不需要自己畫高光，只要把另一側的游標實際移到對應行，就能借用編輯器原生的樣式呈現。
export class CompareCursorSync implements vscode.Disposable {
  private originalUri: string | undefined;
  private translationUri: string | undefined;
  private enabled: boolean;
  private readonly selectionSubscription: vscode.Disposable;
  private readonly visibilitySubscription: vscode.Disposable;
  private readonly configSubscription: vscode.Disposable;

  constructor() {
    this.enabled = this.readEnabledSetting();

    this.selectionSubscription = vscode.window.onDidChangeTextEditorSelection((event) =>
      this.handleSelectionChange(event)
    );
    this.visibilitySubscription = vscode.window.onDidChangeVisibleTextEditors(() => this.syncFromActiveEditor());
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CURSOR_SYNC_ENABLED_SETTING_KEY)) {
        this.enabled = this.readEnabledSetting();
        if (this.enabled) {
          this.syncFromActiveEditor();
        }
      }
    });
  }

  setPair(originalUri: vscode.Uri, translationUri: vscode.Uri): void {
    this.originalUri = originalUri.toString();
    this.translationUri = translationUri.toString();
    this.syncFromActiveEditor();
  }

  dispose(): void {
    this.selectionSubscription.dispose();
    this.visibilitySubscription.dispose();
    this.configSubscription.dispose();
  }

  private readEnabledSetting(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(CURSOR_SYNC_ENABLED_SETTING_KEY, true);
  }

  // 只有真正擁有焦點的那一側移動游標時才往另一側同步；我們自己改動目標編輯器 selection
  // 所觸發的事件，因為目標行號早已一致，會被 syncTarget 內的比較擋下，不會形成回饋迴圈。
  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!this.enabled || !this.originalUri || !this.translationUri) {
      return;
    }

    const sourceUri = event.textEditor.document.uri.toString();
    if (sourceUri !== this.originalUri && sourceUri !== this.translationUri) {
      return;
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    if (activeUri !== sourceUri) {
      return;
    }

    this.syncTarget(sourceUri, event.textEditor.selection.active.line);
  }

  // 開啟比對畫面、切換焦點編輯器、或重新開啟設定時，立即用目前焦點編輯器的游標行校正一次，
  // 不用等使用者先移動一次游標才會同步。
  private syncFromActiveEditor(): void {
    if (!this.enabled || !this.originalUri || !this.translationUri) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }

    const activeUri = activeEditor.document.uri.toString();
    if (activeUri !== this.originalUri && activeUri !== this.translationUri) {
      return;
    }

    this.syncTarget(activeUri, activeEditor.selection.active.line);
  }

  private syncTarget(sourceUri: string, line: number): void {
    const targetUri = sourceUri === this.originalUri ? this.translationUri : this.originalUri;
    if (!targetUri) {
      return;
    }

    const targetEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === targetUri
    );
    if (!targetEditor) {
      return;
    }

    const clampedLine = Math.min(Math.max(line, 0), Math.max(targetEditor.document.lineCount - 1, 0));
    if (targetEditor.selection.isEmpty && targetEditor.selection.active.line === clampedLine) {
      return;
    }

    const position = new vscode.Position(clampedLine, 0);
    targetEditor.selection = new vscode.Selection(position, position);
  }
}
