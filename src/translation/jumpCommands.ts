import * as vscode from "vscode";
import { CompareView } from "../compareView/compareView";
import { findNextUntranslatedLine } from "./progress";

/**
 * 跳到下一個未翻譯行，到結尾後從頭繼續找，並同步定位原文與譯文兩側。
 * fromStart 用於剛開啟章節時，從第一行開始找。
 */
export async function jumpToNextUntranslated(compareView: CompareView, fromStart = false): Promise<void> {
  const pair = compareView.currentPair;
  if (!pair) {
    vscode.window.showInformationMessage("請先開啟原文／譯文比對畫面。");
    return;
  }

  // 其中一側被關掉時重新開啟，才能同時定位兩邊。
  if (!compareView.editorFor("original") || !compareView.editorFor("translation")) {
    await compareView.open(pair.originalUri, pair.translationUri);
  }
  const translationEditor = compareView.editorFor("translation");
  const originalEditor = compareView.editorFor("original");
  if (!translationEditor || !originalEditor) {
    return;
  }

  const active = vscode.window.activeTextEditor;
  const cursorEditor = active && compareView.sideOf(active.document.uri) ? active : translationEditor;
  const fromLine = fromStart ? -1 : cursorEditor.selection.active.line;
  const target = findNextUntranslatedLine(
    originalEditor.document.getText(),
    translationEditor.document.getText(),
    fromLine
  );
  if (target === undefined) {
    vscode.window.showInformationMessage("本章已沒有未翻譯的行。");
    return;
  }

  // 譯文行數不足時補上空行，游標才能停在與原文相同的行號。
  const missingLines = target - translationEditor.document.lineCount + 1;
  if (missingLines > 0) {
    const eol = translationEditor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const end = translationEditor.document.lineAt(translationEditor.document.lineCount - 1).range.end;
    const applied = await translationEditor.edit((edit) => edit.insert(end, eol.repeat(missingLines)));
    if (!applied) {
      vscode.window.showErrorMessage("無法在譯文補上空行，請確認檔案可以編輯。");
      return;
    }
  }

  const position = translationEditor.document.lineAt(target).range.end;
  const range = new vscode.Range(position, position);
  const editor = await vscode.window.showTextDocument(translationEditor.document, {
    viewColumn: translationEditor.viewColumn,
    selection: range,
    preview: false
  });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  const originalLine = Math.min(target, originalEditor.document.lineCount - 1);
  originalEditor.revealRange(
    originalEditor.document.lineAt(originalLine).range,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}
