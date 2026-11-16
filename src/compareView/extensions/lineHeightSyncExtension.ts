import * as vscode from "vscode";
import {
  CompareEditorPair,
  CompareFocusEvent,
  CompareIndexMoveEvent,
  CompareScrollEvent,
  CompareVisibilityEvent,
  CompareView,
  otherCompareSide
} from "../compareView";

// 行高同步（目前刻意不在 extension.ts 註冊，先留著當資料）：
// 原本想靠 ::after decoration 在某一行後面補一段固定高度，去補償兩側換行造成的視覺行數落差，
// 但 after/before 終究只是掛在「那一行」尾端的 inline 元素，撐高的高度算在那一行自己身上，
// 不是插入一個獨立的新視覺行；真正等效於 Monaco view zone 的那種「插入一整行空白」能力，
// extension API 沒有開放。對齊游標相對位置這個目標後來改走 scrollSyncExtension 的
// topLine 同步機制解決（見 ScrollSyncExtension.handleCursorMove），不需要這裡的 decoration。
// 如果未來 VSCode 開放了對應的插入空白行 API，這裡的骨架可以直接拿來改。
export class LineHeightSyncExtension implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[];

  // 測試用：在指定行尾端加一個 16px 高的 ::after 偽元素，背景色只是方便肉眼確認位置，
  // 確認效果後可以拿掉。「直接插入一個新的 div 當成獨立一行」這個做法沒有對應的
  // extension API（那是 Monaco 內部 view zone 的機制，沒有開放給擴充功能），所以只做了這一種。
  private readonly afterSpacerDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: {
      contentText: "​",
      height: "16px",
      width: "100%",
      backgroundColor: "rgba(255, 0, 0, 0.15)"
    }
  });

  constructor(private readonly compareView: CompareView) {
    this.registrations = [
      this.compareView.onDidSetPair((pair) => this.handleSetPair(pair)),
      this.compareView.onDidFocusEditor((event) => this.handleFocusEditor(event)),
      this.compareView.onDidBlurEditor((event) => this.handleBlurEditor(event)),
      this.compareView.onDidMoveIndex((event) => this.handleMoveIndex(event)),
      this.compareView.onDidScroll((event) => this.handleScroll(event)),
      this.compareView.onDidChangeVisibility((event) => this.handleVisibilityChange(event))
    ];
  }

  dispose(): void {
    for (const registration of this.registrations) {
      registration.dispose();
    }
    this.afterSpacerDecorationType.dispose();
  }

  private handleSetPair(pair: CompareEditorPair): void {
    console.log("[LineHeightSync] onDidSetPair", pair);
  }

  private handleFocusEditor(event: CompareFocusEvent): void {
    console.log("[LineHeightSync] onDidFocusEditor", event);
  }

  private handleBlurEditor(event: CompareFocusEvent): void {
    console.log("[LineHeightSync] onDidBlurEditor", event);
  }

  private handleMoveIndex(event: CompareIndexMoveEvent): void {
    // console.log("[LineHeightSync] onDidMoveIndex", event);

    // console.log(
    //   `[LineHeightSync] source line (${event.side} #${event.line})`,
    //   this.describeLine(event.editor, event.line)
    // );
    this.applySpacerDecoration(event.editor, event.line);

    // 同一個行號在「另一側」編輯器裡的情況，方便直接比對兩側同一行的文字長度／換行差異。
    const targetSide = otherCompareSide(event.side);
    const targetEditor = this.compareView.editorFor(targetSide);
    if (targetEditor) {
      // console.log(
      //   `[LineHeightSync] target line (${targetSide} #${event.line})`,
      //   this.describeLine(targetEditor, event.line)
      // );
      this.applySpacerDecoration(targetEditor, event.line);
    }
  }

  // 在指定行下方套用 16px 高的 ::after 空間（isWholeLine，所以不用自己算這一行文字的實際結尾位置）。
  private applySpacerDecoration(editor: vscode.TextEditor, lineNumber: number): void {
    const document = editor.document;
    const maxLine = Math.max(document.lineCount - 1, 0);
    const clampedLine = Math.min(Math.max(lineNumber, 0), maxLine);
    const line = document.lineAt(clampedLine);
    editor.setDecorations(this.afterSpacerDecorationType, [line.range]);
  }

  // 彙整跟「這一行」相關、之後判斷換行/行高落差時可能用到的各種資訊。
  private describeLine(editor: vscode.TextEditor, lineNumber: number): Record<string, unknown> {
    const document = editor.document;
    const maxLine = Math.max(document.lineCount - 1, 0);
    const clampedLine = Math.min(Math.max(lineNumber, 0), maxLine);
    const line = document.lineAt(clampedLine);
    const visibleRange = editor.visibleRanges[0];

    return {
      lineNumber: clampedLine,
      documentLineCount: document.lineCount,
      text: line.text,
      textLength: line.text.length,
      isEmptyOrWhitespace: line.isEmptyOrWhitespace,
      firstNonWhitespaceCharacterIndex: line.firstNonWhitespaceCharacterIndex,
      range: line.range,
      rangeIncludingLineBreak: line.rangeIncludingLineBreak,
      viewColumn: editor.viewColumn,
      tabSize: editor.options.tabSize,
      insertSpaces: editor.options.insertSpaces,
      visibleRangeStartLine: visibleRange?.start.line,
      visibleRangeEndLine: visibleRange?.end.line
    };
  }

  private handleScroll(event: CompareScrollEvent): void {
    console.log("[LineHeightSync] onDidScroll", event);
  }

  private handleVisibilityChange(event: CompareVisibilityEvent): void {
    console.log("[LineHeightSync] onDidChangeVisibility", event);
  }
}
