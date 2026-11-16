import * as vscode from "vscode";
import { COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY } from "../../constants";

export type CompareSide = "original" | "translation";

export function otherCompareSide(side: CompareSide): CompareSide {
  return side === "original" ? "translation" : "original";
}

export interface CompareEditorPair {
  originalUri: vscode.Uri;
  translationUri: vscode.Uri;
}

export interface CompareFocusEvent {
  side: CompareSide;
  editor: vscode.TextEditor | undefined;
}

export interface CompareIndexMoveEvent {
  side: CompareSide;
  editor: vscode.TextEditor;
  line: number;
}

export interface CompareScrollEvent {
  side: CompareSide;
  editor: vscode.TextEditor;
  topLine: number;
  visibleRanges: readonly vscode.Range[];
}

export interface CompareVisibilityEvent {
  originalVisible: boolean;
  translationVisible: boolean;
}

// 比對功能的核心：只負責「開啟原文／譯文兩個視窗」這件簡單的事（套用左右配置設定、
// 把原文設為唯讀），並把目前配對記住。其他所有行為（游標同步、捲動同步……）都不在這裡實作，
// 而是透過下面這些事件註冊口，交給各自獨立檔案裡的擴充功能依照設定決定要不要訂閱。
export class CompareView implements vscode.Disposable {
  private pair: CompareEditorPair | undefined;
  private focusedSide: CompareSide | undefined;

  private readonly _onDidSetPair = new vscode.EventEmitter<CompareEditorPair>();
  private readonly _onDidFocusEditor = new vscode.EventEmitter<CompareFocusEvent>();
  private readonly _onDidBlurEditor = new vscode.EventEmitter<CompareFocusEvent>();
  private readonly _onDidMoveIndex = new vscode.EventEmitter<CompareIndexMoveEvent>();
  private readonly _onDidScroll = new vscode.EventEmitter<CompareScrollEvent>();
  private readonly _onDidChangeVisibility = new vscode.EventEmitter<CompareVisibilityEvent>();

  /** 開啟新的一對原文／譯文視窗時觸發。 */
  readonly onDidSetPair = this._onDidSetPair.event;
  /** 配對中其中一側的編輯器變成焦點編輯器時觸發。 */
  readonly onDidFocusEditor = this._onDidFocusEditor.event;
  /** 配對中原本有焦點的那一側失去焦點時觸發。 */
  readonly onDidBlurEditor = this._onDidBlurEditor.event;
  /** 配對中其中一側的游標（選取範圍）移動時觸發。 */
  readonly onDidMoveIndex = this._onDidMoveIndex.event;
  /** 配對中其中一側的可視範圍（捲動位置）改變時觸發。 */
  readonly onDidScroll = this._onDidScroll.event;
  /** 配對中任一側編輯器的顯示／隱藏狀態改變時觸發。 */
  readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

  private readonly subscriptions: vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor((editor) => this.handleActiveEditorChange(editor)),
      vscode.window.onDidChangeTextEditorSelection((event) => this.handleSelectionChange(event)),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => this.handleVisibleRangesChange(event)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.handleVisibleEditorsChange())
    ];
  }

  get currentPair(): CompareEditorPair | undefined {
    return this.pair;
  }

  sideOf(uri: vscode.Uri): CompareSide | undefined {
    if (!this.pair) {
      return undefined;
    }
    const target = uri.toString();
    if (target === this.pair.originalUri.toString()) {
      return "original";
    }
    if (target === this.pair.translationUri.toString()) {
      return "translation";
    }
    return undefined;
  }

  editorFor(side: CompareSide): vscode.TextEditor | undefined {
    if (!this.pair) {
      return undefined;
    }
    const uri = side === "original" ? this.pair.originalUri : this.pair.translationUri;
    return vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString());
  }

  // 依照設定把原文／譯文開到左右兩側，原文開成唯讀。開啟完成後記住這對視窗，
  // 讓外部擴充功能可以透過上面的事件知道「現在在比對這一對」並開始同步。
  async open(originalUri: vscode.Uri, translationUri: vscode.Uri): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const translationOnLeft = config.get<boolean>(COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY, true);
    const originalColumn = translationOnLeft ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
    const translationColumn = translationOnLeft ? vscode.ViewColumn.One : vscode.ViewColumn.Two;

    const originalDocument = await vscode.workspace.openTextDocument(originalUri);
    await vscode.window.showTextDocument(originalDocument, {
      viewColumn: originalColumn,
      preview: false
    });
    await vscode.commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");

    const translationDocument = await vscode.workspace.openTextDocument(translationUri);
    await vscode.window.showTextDocument(translationDocument, {
      viewColumn: translationColumn,
      preview: false
    });

    this.setPair(originalUri, translationUri);
  }

  private setPair(originalUri: vscode.Uri, translationUri: vscode.Uri): void {
    this.pair = { originalUri, translationUri };
    this._onDidSetPair.fire(this.pair);
    this.fireVisibilitySnapshot();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this._onDidSetPair.dispose();
    this._onDidFocusEditor.dispose();
    this._onDidBlurEditor.dispose();
    this._onDidMoveIndex.dispose();
    this._onDidScroll.dispose();
    this._onDidChangeVisibility.dispose();
  }

  private handleActiveEditorChange(editor: vscode.TextEditor | undefined): void {
    const newSide = editor ? this.sideOf(editor.document.uri) : undefined;
    if (this.focusedSide && this.focusedSide !== newSide) {
      this._onDidBlurEditor.fire({ side: this.focusedSide, editor: this.editorFor(this.focusedSide) });
    }
    this.focusedSide = newSide;
    if (newSide && editor) {
      this._onDidFocusEditor.fire({ side: newSide, editor });
    }
  }

  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    const side = this.sideOf(event.textEditor.document.uri);
    if (!side) {
      return;
    }
    this._onDidMoveIndex.fire({ side, editor: event.textEditor, line: event.textEditor.selection.active.line });
  }

  private handleVisibleRangesChange(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    const side = this.sideOf(event.textEditor.document.uri);
    if (!side) {
      return;
    }
    const topLine = event.visibleRanges[0]?.start.line;
    if (topLine === undefined) {
      return;
    }
    this._onDidScroll.fire({ side, editor: event.textEditor, topLine, visibleRanges: event.visibleRanges });
  }

  private handleVisibleEditorsChange(): void {
    this.fireVisibilitySnapshot();
  }

  private fireVisibilitySnapshot(): void {
    if (!this.pair) {
      return;
    }
    const editors = vscode.window.visibleTextEditors;
    const originalVisible = editors.some(
      (editor) => editor.document.uri.toString() === this.pair!.originalUri.toString()
    );
    const translationVisible = editors.some(
      (editor) => editor.document.uri.toString() === this.pair!.translationUri.toString()
    );
    this._onDidChangeVisibility.fire({ originalVisible, translationVisible });
  }
}
