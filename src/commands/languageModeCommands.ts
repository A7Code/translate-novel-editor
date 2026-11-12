import * as vscode from "vscode";
import { TRANSLATION_LANGUAGE_ID } from "../constants";

export async function toggleAutocompleteMode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("請先開啟一個編輯器分頁。");
    return;
  }

  const nextLanguageId = editor.document.languageId === TRANSLATION_LANGUAGE_ID ? "plaintext" : TRANSLATION_LANGUAGE_ID;
  await vscode.languages.setTextDocumentLanguage(editor.document, nextLanguageId);
  vscode.window.showInformationMessage(
    nextLanguageId === TRANSLATION_LANGUAGE_ID
      ? "已切換為詞彙表自動完成模式，一般自動完成已暫時停用。"
      : "已切換回一般自動完成模式。"
  );
}
