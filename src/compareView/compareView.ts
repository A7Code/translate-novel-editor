import * as vscode from "vscode";
import { COMPARE_TRANSLATION_ON_LEFT_SETTING_KEY } from "../core/constants";

// 開發除錯用：開啟後每次任何 CompareView 事件觸發時，都會在 console 印出事件名稱、
// payload 跟目前程式碼庫裡實際訂閱該事件的功能清單。預設關閉，不要常駐開啟。
const DEBUG_LOG_EVENTS = false;

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

  // 目前程式碼庫裡實際訂閱各事件的功能清單（手動維護，供 DEBUG_LOG_EVENTS 開啟時的 console 輸出對照）。
  private static readonly REGISTERED_FEATURES: Record<string, string[]> = {
    onDidSetPair: [
      "cursorSyncExtension.syncFromActiveEditor",
      "scrollSyncExtension.resetAndCalibrate",
      "glossaryLanguageModeExtension (registration handler)"
    ],
    onDidFocusEditor: [],
    onDidBlurEditor: [],
    onDidMoveIndex: ["cursorSyncExtension.syncTarget", "scrollSyncExtension.handleCursorMove"],
    onDidScroll: ["scrollSyncExtension.handleScroll"],
    onDidChangeVisibility: [
      "cursorSyncExtension.syncFromActiveEditor",
      "scrollSyncExtension (visibilitySubscription handler)"
    ]
  };

  private logFire(eventName: keyof typeof CompareView.REGISTERED_FEATURES, payload: unknown): void {
    if (!DEBUG_LOG_EVENTS) {
      return;
    }
    const features = CompareView.REGISTERED_FEATURES[eventName];
    console.log(`[CompareView] fired "${eventName}"`, {
      payload,
      registeredFeatures: features.length > 0 ? features : "(none)"
    });
  }

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

  // 供啟動時掃描「其實已經開著」的原文／譯文分頁使用（例如 VS Code 自動還原上次開啟的分頁）。
  // 跟 open() 不同，這裡不會再開一次分頁或重新套用唯讀設定，只是把現有分頁登記成目前的比對配對，
  // 讓同步相關的擴充功能能夠接手。若已經是同一組配對就不重複觸發事件。
  adoptPair(originalUri: vscode.Uri, translationUri: vscode.Uri): void {
    if (
      this.pair &&
      this.pair.originalUri.toString() === originalUri.toString() &&
      this.pair.translationUri.toString() === translationUri.toString()
    ) {
      return;
    }
    this.setPair(originalUri, translationUri);
  }

  private setPair(originalUri: vscode.Uri, translationUri: vscode.Uri): void {
    this.pair = { originalUri, translationUri };
    this.logFire("onDidSetPair", this.pair);
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
      const blurEvent = { side: this.focusedSide, editor: this.editorFor(this.focusedSide) };
      this.logFire("onDidBlurEditor", blurEvent);
      this._onDidBlurEditor.fire(blurEvent);
    }
    this.focusedSide = newSide;
    if (newSide && editor) {
      const focusEvent = { side: newSide, editor };
      this.logFire("onDidFocusEditor", focusEvent);
      this._onDidFocusEditor.fire(focusEvent);
    }
  }

  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    const side = this.sideOf(event.textEditor.document.uri);
    if (!side) {
      return;
    }
    // 只有「目前真正 focus 的那一側」的 selection 變動才算使用者的動作。
    // 游標同步功能會把目前焦點那一側的行數寫到另一側（非 focus）的 editor.selection，
    // 這個寫入動作本身也會觸發這裡的事件，若不過濾掉，等於同一次使用者操作會讓
    // onDidMoveIndex 多餘地觸發第二次（而且是「同步結果」而非「使用者動作」），
    // 多耗一次所有訂閱者的運算，也是潛在的來回觸發風險。
    // 在源頭直接擋掉非 focus 側，之後任何新訂閱這個事件的功能都不用再自己處理回音問題。
    if (event.textEditor !== vscode.window.activeTextEditor) {
      return;
    }
    const moveEvent = { side, editor: event.textEditor, line: event.textEditor.selection.active.line };
    this.logFire("onDidMoveIndex", moveEvent);
    this._onDidMoveIndex.fire(moveEvent);
  }

  private handleVisibleRangesChange(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    // 跟 handleSelectionChange 不同，這裡刻意不過濾掉非 focus 側：捲動同步功能需要
    // 「非 focus 側實際捲到哪一行」這個回音資料來學習 revealRange 的落點偏差，
    // 並藉此判斷同步是否已經完成；它已經自己用 inFlight／容差比對擋掉回音造成的
    // 再次往回同步，不會形成無窮迴圈。
    const side = this.sideOf(event.textEditor.document.uri);
    if (!side) {
      return;
    }
    const topLine = event.visibleRanges[0]?.start.line;
    if (topLine === undefined) {
      return;
    }
    const scrollEvent = { side, editor: event.textEditor, topLine, visibleRanges: event.visibleRanges };
    this.logFire("onDidScroll", scrollEvent);
    this._onDidScroll.fire(scrollEvent);
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
    const visibilityEvent = { originalVisible, translationVisible };
    this.logFire("onDidChangeVisibility", visibilityEvent);
    this._onDidChangeVisibility.fire(visibilityEvent);
  }
}
